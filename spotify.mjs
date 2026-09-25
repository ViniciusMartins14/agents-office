import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function spotifyTrack(value) {
  if (typeof value !== 'string') throw new Error('Escolha uma música do Spotify.');
  let uri=value.trim();
  if(uri.startsWith('https://open.spotify.com/')) {
    const url=new URL(uri), match=url.pathname.match(/^\/(?:intl-[a-z]{2}\/)?track\/([A-Za-z0-9]{22})\/?$/);
    if(match) uri=`spotify:track:${match[1]}`;
  }
  if(!/^spotify:track:[A-Za-z0-9]{22}$/.test(uri)) throw new Error('Use uma música ou link de faixa do Spotify.');
  return uri;
}
export function spotifyPlaylist(value) {
  if(typeof value!=='string'||!/^spotify:playlist:[A-Za-z0-9]{22}$/.test(value.trim()))throw new Error('Escolha uma playlist válida do Spotify.');
  return value.trim();
}
export function trackSummary(item) {
  if(!item || item.type!=='track') return null;
  return {uri:item.uri,name:item.name,artists:(item.artists||[]).map(a=>a.name).join(', '),url:item.external_urls?.spotify||null,durationMs:item.duration_ms||0};
}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const scopes=['user-read-playback-state','user-read-currently-playing','user-modify-playback-state','playlist-read-private'];
export class Spotify {
  constructor({dataDir,port,fetchImpl=fetch,clientId=process.env.SPOTIFY_CLIENT_ID||''}) {
    this.file=path.join(dataDir,'spotify.json');this.port=port;this.fetch=fetchImpl;this.clientId=clientId;
    this.credentials=null;this.pending=null;this.refreshing=null;this.generation=0;this.cooldown=0;this.cached=null;this.controls=Promise.resolve();
  }
  get redirectUri(){return `http://127.0.0.1:${this.port}/spotify/callback`;}
  async init(){try{this.credentials=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  info(){return {connected:!!this.credentials?.refreshToken,clientId:this.credentials?.clientId||this.clientId,redirectUri:this.redirectUri,playlistAccess:scopes.every(scope=>(this.credentials?.scopes||[]).includes(scope))};}
  async save(credentials){
    await fs.mkdir(path.dirname(this.file),{recursive:true,mode:0o700});
    await fs.writeFile(this.file+'.tmp',JSON.stringify(credentials),{mode:0o600});
    await fs.chmod(this.file+'.tmp',0o600);await fs.rename(this.file+'.tmp',this.file);
  }
  startAuth(input){
    const clientId=(input||this.info().clientId).trim();
    if(!/^[a-f0-9]{32}$/i.test(clientId))throw new Error('Informe o Client ID do seu aplicativo Spotify (32 caracteres).');
    const state=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url'),cookie=randomBytes(32).toString('hex');
    this.pending={state,verifier,cookie,clientId,expires:Date.now()+10*60_000};
    const url=new URL('https://accounts.spotify.com/authorize');
    url.search=new URLSearchParams({client_id:clientId,response_type:'code',redirect_uri:this.redirectUri,state,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),scope:scopes.join(' ')}).toString();
    return {url:url.href,cookie};
  }
  async tokenRequest(params){
    let response;
    try{response=await this.fetch('https://accounts.spotify.com/api/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(15000)});}catch{throw new Error('Não foi possível conectar ao Spotify. Verifique a internet e tente novamente.');}
    if(!response.ok)throw new Error('O Spotify não autorizou a conexão. Confira o Client ID e o endereço de retorno e conecte novamente.');
    const data=await response.json();
    if(!data.access_token || !Number.isFinite(data.expires_in))throw new Error('Resposta inválida do Spotify. Conecte novamente.');
    return data;
  }
  async callback(query,cookie){
    const p=this.pending;
    if(!p||p.expires<Date.now()||!equal(p.state,query.get('state'))||!equal(p.cookie,cookie))throw new Error('Esta tentativa de conexão expirou. Abra o rádio e conecte novamente.');
    this.pending=null;
    if(query.has('error'))throw new Error('Conexão cancelada no Spotify.');
    const code=query.get('code');if(!code||code.length>3000)throw new Error('Código de autorização ausente.');
    const generation=this.generation;
    const result=await this.tokenRequest({grant_type:'authorization_code',code,redirect_uri:this.redirectUri,client_id:p.clientId,code_verifier:p.verifier});
    if(generation!==this.generation)throw new Error('Conexão cancelada.');
    if(!result.refresh_token)throw new Error('O Spotify não forneceu uma sessão renovável. Conecte novamente.');
    this.credentials={clientId:p.clientId,accessToken:result.access_token,refreshToken:result.refresh_token,expires:Date.now()+result.expires_in*1000,scopes:String(result.scope||scopes.join(' ')).split(/\s+/).filter(Boolean)};
    await this.save(this.credentials);this.cached=null;
  }
  async accessToken(force=false){
    if(!this.credentials?.refreshToken)throw new Error('Conecte sua conta Spotify no rádio do escritório.');
    if(!force&&this.credentials.expires>Date.now()+60_000)return this.credentials.accessToken;
    if(!this.refreshing){
      const generation=this.generation,previous={...this.credentials};
      this.refreshing=(async()=>{
        const r=await this.tokenRequest({grant_type:'refresh_token',refresh_token:previous.refreshToken,client_id:previous.clientId});
        if(generation!==this.generation)throw new Error('Spotify desconectado.');
        this.credentials={...previous,accessToken:r.access_token,refreshToken:r.refresh_token||previous.refreshToken,expires:Date.now()+r.expires_in*1000};
        await this.save(this.credentials);return this.credentials.accessToken;
      })().finally(()=>{this.refreshing=null;});
    }
    return this.refreshing;
  }
  async request(route,{method='GET',body}={},retry=true){
    if(Date.now()<this.cooldown)throw new Error('O Spotify pediu uma pausa nas consultas. Aguarde um pouco.');
    const bearer=await this.accessToken();
    let response;
    try{response=await this.fetch('https://api.spotify.com/v1'+route,{method,headers:{Authorization:`Bearer ${bearer}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{throw new Error('Não foi possível acessar o Spotify agora. Verifique a internet.');}
    if(response.status===401&&retry){await this.accessToken(true);return this.request(route,{method,body},false);}
    if(response.status===429){this.cooldown=Date.now()+Math.max(5,Number(response.headers.get('retry-after'))||30)*1000;throw new Error('Limite temporário do Spotify. Aguarde antes de tentar novamente.');}
    if(response.status===403)throw new Error('O Spotify negou o controle. Confira o Premium e se sua conta está autorizada no aplicativo do Spotify Developers.');
    if(response.status===404)throw new Error('Nenhum dispositivo Spotify disponível. Abra o Spotify no computador e inicie uma música uma vez.');
    if(!response.ok)throw new Error(response.status===401?'Sessão Spotify expirada. Desconecte e conecte novamente.':'O Spotify não conseguiu executar essa ação.');
    return response.status===204?null:response.json();
  }
  async status(){
    if(!this.info().connected)return {...this.info(),playing:false,track:null,device:null};
    if(this.cached&&Date.now()-this.cached.at<4500)return this.cached.value;
    const data=await this.request('/me/player');
    const value={...this.info(),playing:!!data?.is_playing,track:trackSummary(data?.item),progressMs:data?.progress_ms||0,device:data?.device?{id:data.device.id,name:data.device.name,type:data.device.type,volume:data.device.volume_percent,restricted:data.device.is_restricted}:null};
    this.cached={at:Date.now(),value};return value;
  }
  async devices(){const r=await this.request('/me/player/devices');return (r?.devices||[]).map(d=>({id:d.id,name:d.name,type:d.type,active:d.is_active,restricted:d.is_restricted,volume:d.volume_percent}));}
  async playlists(){
    if(!this.info().playlistAccess)throw new Error('Reconecte o Spotify para liberar o acesso às suas playlists.');
    const r=await this.request('/me/playlists?limit=50');
    return (r?.items||[]).filter(p=>p?.uri&&p?.name).map(p=>({uri:spotifyPlaylist(p.uri),name:p.name,owner:p.owner?.display_name||'',tracks:p.items?.total??p.tracks?.total??0,url:p.external_urls?.spotify||null}));
  }
  async search(query){
    if(typeof query!=='string'||query.trim().length<2||query.length>200)throw new Error('Digite de 2 a 200 caracteres para buscar uma música.');
    const r=await this.request('/search?'+new URLSearchParams({q:query.trim(),type:'track',limit:'8'}));
    return (r?.tracks?.items||[]).filter(t=>t&&t.is_playable!==false&&!t.is_local).map(trackSummary).filter(Boolean);
  }
  control(action,data={}) {
    const work=this.controls.catch(()=>{}).then(()=>this.performControl(action,data));
    this.controls=work;return work;
  }
  async performControl(action,{uri,contextUri,deviceId,volume}={}){
    if(deviceId&& (typeof deviceId!=='string'||!/^[\w-]{1,160}$/.test(deviceId)))throw new Error('Dispositivo inválido.');
    const params=new URLSearchParams(deviceId?{device_id:deviceId}:{});
    const suffix=()=>params.size?'?'+params.toString():'';
    if(action==='play'){
      if(uri&&contextUri)throw new Error('Escolha uma música ou uma playlist.');
      const body=uri?{uris:[spotifyTrack(uri)]}:contextUri?{context_uri:spotifyPlaylist(contextUri)}:{};
      await this.request('/me/player/play'+suffix(),{method:'PUT',body});
    }
    else if(action==='pause')await this.request('/me/player/pause'+suffix(),{method:'PUT'});
    else if(['next','previous'].includes(action))await this.request('/me/player/'+action+suffix(),{method:'POST'});
    else if(action==='volume'){
      if(!Number.isInteger(volume)||volume<0||volume>100)throw new Error('Volume precisa estar entre 0 e 100.');
      params.set('volume_percent',String(volume));await this.request('/me/player/volume'+suffix(),{method:'PUT'});
    }else if(action==='transfer'){
      if(!deviceId)throw new Error('Selecione onde tocar.');
      await this.request('/me/player',{method:'PUT',body:{device_ids:[deviceId],play:false}});
    }else throw new Error('Controle de música inválido.');
    this.cached=null;return {ok:true};
  }
  async disconnect(){
    this.generation++;this.credentials=null;this.pending=null;this.cached=null;
    if(this.refreshing)await this.refreshing.catch(()=>{});
    await fs.rm(this.file,{force:true});
  }
}
