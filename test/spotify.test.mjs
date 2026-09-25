import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Spotify,spotifyTrack,spotifyPlaylist} from '../spotify.mjs';
import {parseMusicChoice} from '../music-dj.mjs';

const id='a'.repeat(32), uri='spotify:track:'+'b'.repeat(22);
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
async function fixture(t,fetchImpl){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'spotify-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const spotify=new Spotify({dataDir:dir,port:4317,fetchImpl,clientId:id});await spotify.init();return spotify;}
async function authorize(s){const start=s.startAuth(id);await s.callback(new URLSearchParams({state:new URL(start.url).searchParams.get('state'),code:'code'}),start.cookie);}
const tokenResponse=()=>json({access_token:'access-private',refresh_token:'refresh-private',expires_in:3600,scope:'user-read-playback-state user-read-currently-playing user-modify-playback-state playlist-read-private'});

test('PKCE vincula autorização ao navegador, impede replay e não expõe credenciais',async t=>{
 let exchanged;
 const s=await fixture(t,async(url,options)=>{exchanged=options;return tokenResponse();});
 const start=s.startAuth(id),auth=new URL(start.url),params=auth.searchParams;
 assert.equal(auth.origin,'https://accounts.spotify.com');assert.equal(params.get('code_challenge_method'),'S256');assert.equal(params.get('redirect_uri'),'http://127.0.0.1:4317/spotify/callback');assert.ok(!params.has('client_secret'));
 assert.match(params.get('scope'),/playlist-read-private/);
 const query=new URLSearchParams({state:params.get('state'),code:'code'});
 await assert.rejects(s.callback(query,'wrong'),/expirou/);assert.equal(exchanged,undefined);
 await s.callback(query,start.cookie);
 assert.ok(exchanged.body.get('code_verifier'));assert.equal(s.info().connected,true);
 assert.ok(!JSON.stringify(s.info()).includes('private'));
 assert.equal((await fs.stat(s.file)).mode&0o777,0o600);
 await assert.rejects(s.callback(query,start.cookie),/expirou/);
 await s.disconnect();assert.equal(s.info().connected,false);await assert.rejects(fs.stat(s.file),{code:'ENOENT'});
});
test('Negação e autorização expirada não conectam uma conta',async t=>{
 let called=false;const s=await fixture(t,async()=>{called=true;return tokenResponse();});
 let auth=s.startAuth(id);await assert.rejects(s.callback(new URLSearchParams({state:new URL(auth.url).searchParams.get('state'),error:'access_denied'}),auth.cookie),/cancelada/);
 auth=s.startAuth(id);s.pending.expires=0;await assert.rejects(s.callback(new URLSearchParams({state:new URL(auth.url).searchParams.get('state'),code:'code'}),auth.cookie),/expirou/);assert.equal(called,false);
});
test('Renova token uma vez entre chamadas concorrentes e repete 401 só uma vez',async t=>{
 let tokens=0,players=0;
 const s=await fixture(t,async url=>{
  if(url.includes('/api/token')){tokens++;return tokenResponse();}
  players++;return players===1?json({},401):new Response(null,{status:204});
 });
 await authorize(s);s.credentials.expires=0;
 await Promise.all([s.accessToken(),s.accessToken(),s.accessToken()]);assert.equal(tokens,2);
 const state=await s.status();assert.equal(tokens,3);assert.equal(state.track,null);assert.equal(state.playing,false);
});
test('Controles usam dispositivo escolhido, validam URI e preservam ordem manual',async t=>{
 const calls=[];const s=await fixture(t,async(url,options)=>{
  if(url.includes('/api/token'))return tokenResponse();calls.push({url,options});return new Response(null,{status:204});
 });await authorize(s);
 await Promise.all([s.control('play',{uri,deviceId:'computer-1'}),s.control('pause',{deviceId:'computer-1'})]);
 assert.match(calls[0].url,/play\?device_id=computer-1/);assert.equal(JSON.parse(calls[0].options.body).uris[0],uri);assert.match(calls[1].url,/pause/);
 await assert.rejects(s.control('volume',{volume:200}),/Volume/);await assert.rejects(s.control('play',{uri:'https://evil.example/track'}),/Spotify/);
 assert.equal(spotifyTrack('https://open.spotify.com/intl-pt/track/'+'b'.repeat(22)+'?si=test'),uri);
});
test('Lista playlists privadas e toca a seleção no dispositivo escolhido',async t=>{
 const calls=[],playlistUri='spotify:playlist:'+'c'.repeat(22);
 const s=await fixture(t,async(url,options)=>{
  if(url.includes('/api/token'))return tokenResponse();
  calls.push({url,options});
  if(url.includes('/me/playlists'))return json({items:[{uri:playlistUri,name:'Foco',owner:{display_name:'Vinicius'},items:{total:18},external_urls:{spotify:'https://open.spotify.com/playlist/'+'c'.repeat(22)}}]});
  return new Response(null,{status:204});
 });
 await authorize(s);
 assert.deepEqual(await s.playlists(),[{uri:playlistUri,name:'Foco',owner:'Vinicius',tracks:18,url:'https://open.spotify.com/playlist/'+'c'.repeat(22)}]);
 await s.control('play',{contextUri:playlistUri,deviceId:'computer-1'});
 const play=calls.find(c=>c.url.includes('/me/player/play'));
 assert.equal(JSON.parse(play.options.body).context_uri,playlistUri);
 assert.equal(spotifyPlaylist(playlistUri),playlistUri);
 await assert.rejects(s.control('play',{contextUri:'spotify:album:invalid'}),/playlist/);
});
test('Dispositivo ausente e Premium necessário geram mensagens úteis sem vazar respostas remotas',async t=>{
 let code=404;const s=await fixture(t,async url=>url.includes('/api/token')?tokenResponse():json({error:{message:'private-server-details'}},code));await authorize(s);
 await assert.rejects(s.control('play',{uri}),/Abra o Spotify/);code=403;await assert.rejects(s.control('play',{uri}),/Premium/);
});
test('429 pausa consultas seguintes; não entra em laço de tentativas',async t=>{
 let apiCalls=0;const s=await fixture(t,async url=>{if(url.includes('/api/token'))return tokenResponse();apiCalls++;return new Response('{}',{status:429,headers:{'retry-after':'30'}});});await authorize(s);
 await assert.rejects(s.status(),/Limite/);await assert.rejects(s.status(),/pausa/);assert.equal(apiCalls,1);
});
test('Escolha do DJ exige artista e música reais como texto estruturado',()=>{
 assert.deepEqual(parseMusicChoice('```json\n{"song":"So What","artist":"Miles Davis","reason":"Jazz para concentrar."}\n```'),{song:'So What',artist:'Miles Davis',reason:'Jazz para concentrar.'});
 assert.throws(()=>parseMusicChoice('{"song":""}'));
 assert.throws(()=>parseMusicChoice('qualquer coisa'));
});
