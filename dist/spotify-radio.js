export function createSpotifyRadio({getToken,getEmployees,onChange,toast}) {
 const $=id=>document.getElementById(id);
 const dialog=$('spotify-dialog');
 let current={connected:false,playing:false},timer=null,polling=false,searchVersion=0,deviceSelected='',busy=false;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function request(action,data={}) {
   if(!getToken())throw new Error('Aguarde a conexão com o escritório.');
   const r=await fetch('/api/spotify/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Office-Token':getToken()},body:JSON.stringify(data)});
   const json=await r.json();if(!r.ok)throw new Error(json.error||'Não foi possível acessar o Spotify.');return json;
 }
 function error(message=''){$('spotify-error').textContent=message;}
 function render(){
   $('spotify-setup').hidden=current.connected;
   $('spotify-player').hidden=!current.connected;
   $('spotify-state').textContent=current.connected?'Spotify conectado':'Conecte sua conta Premium';
   $('spotify-return').textContent=current.redirectUri||`http://127.0.0.1:${location.port}/spotify/callback`;
   if(!$('spotify-client-id').value&&current.clientId)$('spotify-client-id').value=current.clientId;
   $('spotify-song').textContent=current.track?.name||'Nenhuma música em reprodução';
   $('spotify-artist').textContent=current.track?.artists||'Abra o Spotify no computador e escolha onde tocar abaixo.';
   const link=$('spotify-track-link');link.hidden=!current.track?.url;
   if(current.track?.url&&/^https:\/\/open\.spotify\.com\//.test(current.track.url))link.href=current.track.url;
   $('spotify-toggle').textContent=current.playing?'Pausar':'Reproduzir';
   $('spotify-device-label').textContent=current.device?.name?`Tocando em ${current.device.name}`:'Selecione um dispositivo Spotify';
   $('spotify-playlist-access').hidden=!!current.playlistAccess;
   $('spotify-playlist-picker').hidden=!current.playlistAccess;
   const choice=current.choice?.trackUri===current.track?.uri?current.choice:null;
   $('spotify-choice').textContent=choice?`${choice.employee} escolheu esta música. ${choice.reason}`:'';
   if(document.activeElement!==$('spotify-volume')&&current.device?.volume!=null)$('spotify-volume').value=current.device.volume;
   onChange({on:current.playing,dj:choice?.employee||'Spotify',title:current.track?.name||'Abrir rádio'});
 }
 async function poll(){
   if(polling||document.hidden)return;polling=true;
   try{current=await request('status');render();}catch(e){if(dialog.open)error(e.message);}finally{polling=false;}
 }
 async function devices(){
   const r=await request('devices');const usable=r.devices.filter(d=>d.id&&!d.restricted);
   if(current.device?.name&&!current.device.restricted&&!usable.some(d=>d.id&&d.id===current.device.id))usable.unshift({...current.device,id:current.device.id||'__active__',active:true});
   if(!usable.some(d=>d.id===deviceSelected))deviceSelected=usable.find(d=>d.active)?.id||'';
   $('spotify-device').innerHTML='<option value="">Selecione onde tocar</option>'+usable.map(d=>`<option value="${escape(d.id)}" ${d.id===deviceSelected?'selected':''}>${escape(d.name)} · ${escape(d.type)}</option>`).join('');
   $('spotify-device-help').textContent=usable.length?'O som sai do dispositivo selecionado.':'Abra o aplicativo Spotify no computador e toque uma faixa; depois clique em Atualizar dispositivos.';
 }
 async function playlists(){
   if(!current.playlistAccess)return;
   const select=$('spotify-playlist');select.disabled=true;$('spotify-playlist-help').textContent='Carregando suas playlists…';
   try{
     const r=await request('playlists'),selected=select.value;
     select.innerHTML='<option value="">Selecione uma playlist</option>'+r.playlists.map(p=>`<option value="${escape(p.uri)}" ${p.uri===selected?'selected':''}>${escape(p.name)}${p.owner?' · '+escape(p.owner):''} · ${Number(p.tracks)||0} faixas</option>`).join('');
     $('spotify-playlist-help').textContent=r.playlists.length?`${r.playlists.length} playlists disponíveis.`:'Nenhuma playlist foi encontrada nesta conta.';
   }finally{select.disabled=false;}
 }
 async function control(action,extra={}){
   error();const selectedDevice=$('spotify-device').value,deviceId=selectedDevice==='__active__'?'':selectedDevice;
   if(!selectedDevice&&action!=='pause')throw new Error('Selecione onde tocar antes de controlar a música.');
   await request('control',{action,deviceId,...extra});
   if(action==='pause')current.playing=false;
   if(action==='play')current.playing=true;
   current.choice=null;render();
   setTimeout(()=>void poll(),750);
 }
 async function open(){
   if(!dialog.open)dialog.showModal();error();
   const people=getEmployees();
   $('spotify-dj').innerHTML=people.map(e=>`<option value="${escape(e.id)}">${escape(e.name)} · ${escape(e.role)}</option>`).join('');
   await poll();
   if(current.connected)try{await devices();await playlists();}catch(e){error(e.message);}
   timer ||= setInterval(()=>void poll(),5000);
 }
 $('spotify-connect-form').addEventListener('submit',async event=>{
   event.preventDefault();const button=event.submitter;button.disabled=true;error();
   try{const result=await request('connect',{clientId:$('spotify-client-id').value.trim()});location.assign(result.url);}catch(e){error(e.message);button.disabled=false;}
 });
 $('spotify-search-form').addEventListener('submit',async event=>{
   event.preventDefault();const version=++searchVersion;error();
   const query=$('spotify-query').value.trim(),results=$('spotify-results');results.textContent='Buscando…';
   try{
     if(/^https:\/\/open\.spotify\.com\//.test(query)||query.startsWith('spotify:track:')){await control('play',{uri:query});results.textContent='Música enviada ao Spotify.';return;}
     const r=await request('search',{query});if(version!==searchVersion)return;
     results.innerHTML=r.tracks.length?r.tracks.map(t=>`<div class="spotify-result"><div><strong>${escape(t.name)}</strong><small>${escape(t.artists)}</small><a href="${escape(t.url||'https://open.spotify.com')}" target="_blank" rel="noopener noreferrer">Ver no Spotify ↗</a></div><button class="button" type="button" data-track-uri="${escape(t.uri)}">Tocar</button></div>`).join(''):'Nenhuma faixa encontrada. Tente o nome da música e do artista.';
   }catch(e){results.textContent='';error(e.message);}
 });
 $('spotify-results').addEventListener('click',async event=>{
   const button=event.target.closest('[data-track-uri]');if(!button)return;
   button.disabled=true;try{await control('play',{uri:button.dataset.trackUri});toast('Música enviada ao Spotify.');}catch(e){error(e.message);}finally{button.disabled=false;}
 });
 dialog.addEventListener('click',async event=>{
   const button=event.target.closest('[data-spotify-action]');if(!button)return;
   const action=button.dataset.spotifyAction;button.disabled=true;error();
   try{
     if(action==='devices')await devices();
     else if(action==='playlists')await playlists();
     else if(action==='reauthorize'){
       const result=await request('connect',{clientId:current.clientId});location.assign(result.url);return;
     }else if(action==='playlist'){
       const contextUri=$('spotify-playlist').value;if(!contextUri)throw new Error('Escolha uma playlist.');
       await control('play',{contextUri});toast('Playlist enviada ao Spotify.');
     }
     else if(action==='disconnect'){
       current=await request('disconnect');clearInterval(timer);timer=null;deviceSelected='';$('spotify-results').textContent='';render();
       toast('Spotify desconectado do escritório.');
     }else if(action==='dj'){
       if(busy)return;
       const selectedDevice=$('spotify-device').value;if(!selectedDevice)throw new Error('Selecione onde tocar.');
       const deviceId=selectedDevice==='__active__'?'':selectedDevice;
       busy=true;button.textContent='Escolhendo…';
       const result=await request('dj',{employee:$('spotify-dj').value,mood:$('spotify-mood').value,deviceId});
       current.choice=result.choice;current.track=result.track;current.playing=true;render();
       toast(`${result.choice.employee} escolheu ${result.track.name}.`);setTimeout(()=>void poll(),750);
     }else await control(action==='toggle'?(current.playing?'pause':'play'):action);
   }catch(e){error(e.message);}finally{button.disabled=false;if(action==='dj'){busy=false;button.textContent='Deixar escolher e tocar';}}
 });
 $('spotify-volume').addEventListener('change',async()=>{try{await control('volume',{volume:Number($('spotify-volume').value)});}catch(e){error(e.message);}});
 $('spotify-device').addEventListener('change',async()=>{
   deviceSelected=$('spotify-device').value;if(!deviceSelected)return;
   if(deviceSelected==='__active__'){toast('Usando o dispositivo Spotify que já está ativo.');return;}
   try{await control('transfer');toast('Dispositivo selecionado.');}catch(e){error(e.message);}
 });
 dialog.addEventListener('close',()=>error());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&current.connected)void poll();});
 async function boot(){
   await poll();if(current.connected)timer ||= setInterval(()=>void poll(),5000);
   const status=new URL(location.href).searchParams.get('spotify');
   if(status){const url=new URL(location.href);url.searchParams.delete('spotify');history.replaceState(null,'',url);await open();if(status!=='connected')error('A conexão não foi concluída. Confira o Client ID e o endereço de retorno, ou tente autorizar novamente.');else toast('Spotify conectado ao escritório.');}
 }
 return {open,boot};
}
