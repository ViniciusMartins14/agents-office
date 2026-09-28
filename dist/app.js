import { createSpotifyRadio } from './spotify-radio.js';
const $ = id => document.getElementById(id);
const labels = { claude: 'Claude', codex: 'Codex', bob: 'IBM Bob' };
const statuses = { queued: 'Na fila', running: 'Trabalhando', done: 'Concluída', failed: 'Falhou', blocked: 'Atenção necessária', interrupted: 'Interrompida', cancelled: 'Cancelada', timedout: 'Tempo esgotado' };
const presence = { running: 'Trabalhando', queued: 'Na fila', attention: 'Atenção', resting: 'Descansando', configure: 'Configurar', available: 'Disponível' };
const bubbles = { running: 'Trabalhando…', queued: 'Na fila', attention: 'Precisa de atenção', resting: 'Zzz… limite de tokens', configure: 'Terminal a configurar', available: '' };
let state = { employees: [], tasks: [], assignments: {}, binaries: {}, workspace: '' };
let token;
let selectedEmployee;
let selectedTask;
let pendingAttachments = [];
let connected = false;
let toastTimer;
let office3d = null;
let spotifyPlayback = {on:false,dj:'Spotify',title:'Abrir rádio'};
let spotifyBooted=false;
let agentUsage=null,usageLoading=false;
let dependenciesLoading=false;
let mcpApplying='';
let mcpEditing='',mcpPendingDelete='',mcpMode='form';
let planDraft=null,planMission=null,planEmployee=null,planBackground='',planSkills=[];
let pendingDelete=null,pendingDeleteTimer;
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function markdownInline(text) {
  const code = [];
  let value = esc(text).replace(/`([^`\n]+)`/g, (_, content) => `\u0000CODE${code.push(content) - 1}\u0000`);
  const links = [];
  value = value.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) => `\u0000LINK${links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`) - 1}\u0000`);
  value = value.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (_, before, url) => `${before}\u0000LINK${links.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`) - 1}\u0000`);
  value = value
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  return value
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => `<code>${code[Number(index)]}</code>`)
    .replace(/\u0000LINK(\d+)\u0000/g, (_, index) => links[Number(index)]);
}
function markdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let paragraph = [], list = null, quote = [], fence = null;
  const flushParagraph = () => { if (paragraph.length) { html.push(`<p>${paragraph.map(markdownInline).join('<br>')}</p>`); paragraph = []; } };
  const flushList = () => { if (list) { html.push(`<${list.type}>${list.items.map(item => `<li>${markdownInline(item)}</li>`).join('')}</${list.type}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { html.push(`<blockquote>${quote.map(markdownInline).join('<br>')}</blockquote>`); quote = []; } };
  const flushText = () => { flushParagraph(); flushList(); flushQuote(); };
  for (const line of lines) {
    if (fence) {
      if (/^\s*```/.test(line)) { html.push(`<pre><code${fence.lang ? ` data-language="${esc(fence.lang)}"` : ''}>${esc(fence.lines.join('\n'))}</code></pre>`); fence = null; }
      else fence.lines.push(line);
      continue;
    }
    const fenceStart = line.match(/^\s*```\s*([\w.+-]*)\s*$/);
    if (fenceStart) { flushText(); fence = { lang: fenceStart[1], lines: [] }; continue; }
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) { flushText(); const level = heading[1].length; html.push(`<h${level}>${markdownInline(heading[2])}</h${level}>`); continue; }
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) { flushText(); html.push('<hr>'); continue; }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/), ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph(); flushQuote();
      const type = ordered ? 'ol' : 'ul';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push((ordered || unordered)[1]); continue;
    }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue; }
    if (!line.trim()) { flushText(); continue; }
    flushList(); flushQuote(); paragraph.push(line);
  }
  if (fence) html.push(`<pre><code>${esc(fence.lines.join('\n'))}</code></pre>`);
  flushText();
  return html.join('');
}
const date = value => value ? new Date(value).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
const avatar = e => `<span class="avatar" style="--employee-color:${e.color}">${e.initials}</span>`;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
function activeFor(id) { return state.tasks.find(t => t.employee === id && t.status === 'running'); }
/* Etapa na fila com dependência aberta está esperando alguém, não esperando a vez. */
function waitingFor(task) {
  if (task.status !== 'queued' || !task.depends?.length) return '';
  const pending = task.depends.filter(id => state.tasks.find(t => t.id === id)?.status !== 'done');
  if (!pending.length) return '';
  const names = [...new Set(pending.map(id => state.tasks.find(t => t.id === id)?.name).filter(Boolean))];
  return names.length ? `Aguarda ${names.join(' e ')}` : 'Aguardando etapa anterior';
}
const providerLimit = provider => state.limits?.[provider] || null;
function limitResetText(limit) {
  if (limit?.resetsText) return limit.resetsText;
  if (limit?.resetsAt) return new Date(limit.resetsAt * 1000).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return '';
}
/* A leitura da conta (/usage do Claude, limites do Codex) é a palavra final sobre quem está sem tokens.
   Só quando o terminal não informa saldo é que vale o último aviso de limite registrado nas tarefas. */
function providerExhausted(provider) {
  const limit = providerLimit(provider);
  if (limit?.known) return !!limit.exhausted;
  const latest = [...state.tasks].reverse().find(task => task.provider === provider && (task.exhausted || task.status === 'done'));
  return !!latest?.exhausted;
}
function bubbleFor(id, key) {
  if (key !== 'resting') return bubbles[key];
  const reset = limitResetText(providerLimit(state.assignments[id]));
  return reset ? `Zzz… sem tokens até ${reset}` : bubbles.resting;
}
function statusKeyFor(id) {
  if (activeFor(id)) return 'running';
  const provider = state.assignments[id];
  if (providerExhausted(provider)) return 'resting';
  if (!state.binaries[provider] || (provider === 'bob' && !state.readiness?.bob)) return 'configure';
  /* Atenção é sobre a ÚLTIMA coisa que a pessoa fez. Procurar a última tarefa ruim do histórico
     inteiro deixava o funcionário marcado para sempre por uma falha que um trabalho novo já resolveu. */
  const latest = [...state.tasks].reverse().find(t => t.employee === id && t.status !== 'queued');
  if (latest && ['failed', 'blocked', 'interrupted', 'timedout'].includes(latest.status)) return 'attention';
  return state.tasks.some(t => t.employee === id && t.status === 'queued') ? 'queued' : 'available';
}
const statusFor = id => presence[statusKeyFor(id)];
function radioState() { return spotifyPlayback; }
const spotifyRadio=createSpotifyRadio({
  getToken:()=>token,
  getEmployees:()=>state.employees,
  toast,
  onChange:value=>{spotifyPlayback=value;office3d?.update(sceneData());}
});
function toggleOfficeRadio() { return spotifyRadio.open(); }
async function api(endpoint, data) {
  if (!connected) throw new Error('O escritório está desconectado. Verifique se o servidor local está aberto.');
  const response = await fetch(`/api/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': token }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível completar a ação.');
  state = result; render(); return result;
}
function switchView(view) {
  document.body.classList.toggle('office-mode',view==='office');
  for (const name of ['office', 'tasks', 'team', 'tools']) $(`${name}-view`).hidden = name !== view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('page-heading').hidden = view === 'office';
  $('page-heading').querySelector('[data-action="mission"]').hidden = view === 'tools';
  $('breadcrumb').textContent = { office: 'Escritório', tasks: 'Missões', team: 'Equipe', tools: 'Ferramentas' }[view];
  $('page-title').textContent = { office: 'Seu time, no mesmo lugar.', tasks: 'Da ideia à entrega.', team: 'Um time feito para construir.', tools: 'Seu ambiente, sem pontos cegos.' }[view];
  $('page-description').textContent = { office: 'Dê uma missão. Acompanhe cada etapa. Construa com a sua equipe.', tasks: 'Planejamento, implementação e validação em uma única sequência.', team: 'Seis especialidades, conectadas aos seus terminais.', tools: 'Instalação, autenticação e compatibilidade de cada serviço usado pelo escritório.' }[view];
  office3d?.setActive(view === 'office');
}

const dependencyStatus = {
  ready: ['Pronto', 'ready'], auth_required: ['Autenticação pendente', 'attention'],
  missing: ['Não instalado', 'missing'], unsupported: ['Requer ambiente compatível', 'unsupported']
};
function renderDependencies(){
  const report=state.dependencies||{items:[]};
  const items=Array.isArray(report.items)?report.items:[];
  const ready=items.filter(item=>item.status==='ready').length;
  const attention=items.length-ready;
  $('dependencies-summary').innerHTML=dependenciesLoading
    ? '<span>Consultando ferramentas instaladas…</span>'
    : `<span><strong>${ready}</strong> disponíveis</span><span><strong>${attention}</strong> precisam de atenção</span><span>${esc(report.platform||'sistema')} · ${esc(report.arch||'')}</span>`;
  $('dependencies-list').innerHTML=items.length?items.map(item=>{
    const [label,tone]=dependencyStatus[item.status]||[item.status,'missing'];
    const active=item.id==='ai-memory'&&state.memory?.active?' <small>em uso pelo Office</small>':'';
    const version=item.version?`<small class="dependency-version">${esc(item.version)}</small>`:'';
    const command=item.actionCommand?`<div class="dependency-command"><code>${esc(item.actionCommand)}</code><button class="text-button" data-dependency-command="${esc(item.id)}">Copiar comando</button></div>`:'';
    return `<article class="dependency-card"><header><div><h3>${esc(item.name)}${item.required?' <small>obrigatório</small>':''}${active}</h3><p>${esc(item.description)}</p></div><span class="dependency-status ${tone}">${label}</span></header>${version}<p class="dependency-note">${esc(item.note)}</p>${item.path?`<p class="dependency-path" title="${esc(item.path)}">${esc(item.path)}</p>`:''}${command}<a href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">Documentação oficial ↗</a></article>`;
  }).join(''):'<div class="empty-state"><h3>Diagnóstico ainda não carregado</h3><p>Atualize para verificar as ferramentas deste computador.</p></div>';
}
async function loadDependencies(){
  if(dependenciesLoading)return;dependenciesLoading=true;renderDependencies();
  try{
    const response=await fetch('/api/dependencies',{method:'POST',headers:{'Content-Type':'application/json','X-Office-Token':token},body:'{}'});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível atualizar o diagnóstico.');
    state={...state,dependencies:result};
  }catch(error){toast(error.message);}finally{dependenciesLoading=false;renderDependencies();}
}
const mcpTargetLabel={claude:'Claude',codex:'Codex',bob:'IBM Bob'};
function renderMcps(){
  const target=$('mcp-list');if(!target)return;
  const servers=state.mcps?.servers||[],allResults=state.mcps?.results||{},appliedAt=state.mcps?.appliedAt||{};
  target.innerHTML=servers.length?servers.map(server=>{
    const endpoint=server.transport==='http'?server.url:[server.command,...(server.args||[])].join(' ');
    const results=allResults[server.name]||{};
    const statuses=server.targets.map(provider=>{
      const result=results[provider];
      return `<span class="mcp-target ${result?result.ok?'ready':'failed':''}" title="${esc(result?.message||'Ainda não aplicado nesta sessão')}">${esc(mcpTargetLabel[provider])}${result?result.ok?' ✓':' !':''}</span>`;
    }).join('');
    const applied=appliedAt[server.name]?`Última aplicação: ${date(appliedAt[server.name])}`:'Ainda não aplicado pelo Office.';
    const config=server.config||{},extra=[];
    if(config.env)extra.push(`${Object.keys(config.env).length} env`);if(config.headers||config.http_headers)extra.push(`${Object.keys(config.headers||config.http_headers).length} header(s)`);if(config.cwd)extra.push('cwd');if(config.bearer_token_env_var)extra.push('token por variável');
    return `<article class="mcp-card"><header><div><span class="eyebrow">${esc(server.transport.toUpperCase())}${extra.length?' · JSON AVANÇADO':''}</span><h3>${esc(server.name)}</h3></div><button class="button primary" data-mcp-apply="${esc(server.name)}" ${mcpApplying===server.name?'disabled':''}>${mcpApplying===server.name?'Aplicando…':'Aplicar nas IAs'}</button></header><code title="${esc(endpoint)}">${esc(endpoint)}</code>${extra.length?`<p class="mcp-config-summary">${esc(extra.join(' · '))}</p>`:''}<div class="mcp-target-list">${statuses}</div><p>${server.transport==='http'&&server.url.includes('127.0.0.1')?'Este servidor depende do Office estar aberto.':'A configuração é gravada no perfil do usuário de cada ferramenta.'}</p><footer><small>${esc(applied)}</small><span><button class="text-button" data-mcp-edit="${esc(server.name)}">Editar</button>${mcpPendingDelete===server.name?`<button class="text-button confirm-delete" data-mcp-confirm-remove="${esc(server.name)}">Confirmar remoção</button>`:`<button class="text-button" data-mcp-remove="${esc(server.name)}">Remover do catálogo</button>`}</span></footer></article>`;
  }).join(''):'<div class="empty-state"><h3>Nenhum MCP cadastrado</h3><p>Adicione um servidor para compartilhá-lo entre as ferramentas.</p></div>';
}
function openMcpEditor(name=''){
  const server=(state.mcps?.servers||[]).find(item=>item.name===name);mcpEditing=server?.name||'';$('mcp-form').reset();$('mcp-error').textContent='';
  $('mcp-dialog-title').textContent=server?'Editar MCP':'Adicionar MCP';$('mcp-save').textContent=server?'Salvar alterações':'Salvar no catálogo';$('mcp-name').readOnly=!!server;
  if(server){$('mcp-name').value=server.name;$('mcp-transport').value=server.transport;$('mcp-url').value=server.url||'';$('mcp-command').value=server.command||'';$('mcp-args').value=(server.args||[]).join('\n');$('mcp-json').value=JSON.stringify({name:server.name,...(server.config||{})},null,2);for(const input of document.querySelectorAll('input[name="mcp-target"]'))input.checked=server.targets.includes(input.value);}
  else $('mcp-json').value='';
  const basic=server?Object.keys(server.config||{}).every(key=>['type','url','command','args'].includes(key)):true;
  setMcpMode(basic?'form':'json');toggleMcpFields();validateMcpJson();$('mcp-dialog').showModal();
}
async function mcpRequest(action,data){
  if(!connected)throw new Error('O escritório está desconectado.');
  const response=await fetch(`/api/mcps/${action}`,{method:'POST',headers:{'Content-Type':'application/json','X-Office-Token':token},body:JSON.stringify(data)});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Não foi possível configurar o MCP.');
  state={...state,mcps:result.mcps};renderMcps();return result;
}
function toggleMcpFields(){
  const http=$('mcp-transport').value==='http';$('mcp-http-fields').hidden=!http;$('mcp-stdio-fields').hidden=http;
  $('mcp-name').required=mcpMode==='form';$('mcp-url').required=mcpMode==='form'&&http;$('mcp-command').required=mcpMode==='form'&&!http;$('mcp-json').required=mcpMode==='json';
}
function setMcpMode(mode){
  mcpMode=mode==='json'?'json':'form';$('mcp-form-fields').hidden=mcpMode!=='form';$('mcp-json-fields').hidden=mcpMode!=='json';
  for(const button of document.querySelectorAll('[data-mcp-mode]')){const active=button.dataset.mcpMode===mcpMode;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}
  $('mcp-save').textContent=mcpMode==='json'?(mcpEditing?'Salvar JSON':'Importar JSON'):(mcpEditing?'Salvar alterações':'Salvar no catálogo');toggleMcpFields();
}
function mcpJsonNames(document){
  if(!document||typeof document!=='object'||Array.isArray(document))throw new Error('O JSON precisa ser um objeto.');
  const group=document.mcpServers&&typeof document.mcpServers==='object'?document.mcpServers:document.servers&&typeof document.servers==='object'?document.servers:null;
  const names=group?Object.keys(group):document.name?[document.name]:[];if(!names.length)throw new Error('Informe "name" ou um bloco "mcpServers".');return names;
}
function validateMcpJson(){
  if(mcpMode!=='json')return;const status=$('mcp-json-status'),value=$('mcp-json').value.trim();if(!value){status.className='mcp-json-status';status.textContent='Cole um JSON para validar.';return;}
  try{const names=mcpJsonNames(JSON.parse(value));if(names.length>20)throw new Error('Importe no máximo 20 servidores por vez.');status.className='mcp-json-status valid';status.textContent=`JSON válido · ${names.length} servidor${names.length===1?'':'es'}: ${names.join(', ')}`;}
  catch(error){status.className='mcp-json-status invalid';status.textContent=error.message;}
}
const skillStageLabels={intake:'Entrada',resolution:'Resolução',verification:'Verificação',release:'Entrega',improvement:'Melhoria',general:'Geral'};
function skillOptions(name){
  return (state.skills||[]).map(skill=>`<label class="skill-option compact"><input type="checkbox" name="${name}" value="${esc(skill.id)}"><span><strong>${esc(skill.name)} <em>${esc(skillStageLabels[skill.stage]||'Geral')}</em></strong><small>${esc(skill.description)}</small></span></label>`).join('');
}
function renderCapabilities(){
  const overview=$('capability-overview');if(!overview)return;
  const deps=state.dependencies?.items||[],ready=deps.filter(item=>item.status==='ready').length,total=deps.length;
  const mcpCount=state.mcps?.servers?.length||0,skillCount=state.skills?.length||0,memory=state.memory?.active;
  overview.innerHTML=`<article class="capability-card ${memory?'ready':'attention'}"><span>MEMÓRIA</span><strong>${memory?'Ativa':'Indisponível'}</strong><small>${esc(state.memory?.endpoint||'ai-memory não iniciado')}</small></article><article class="capability-card"><span>MCPS</span><strong>${mcpCount}</strong><small>servidor${mcpCount===1?'':'es'} no catálogo</small></article><article class="capability-card"><span>SKILLS</span><strong>${skillCount}</strong><small>disponíveis para todos os agentes</small></article><article class="capability-card ${total&&ready===total?'ready':''}"><span>AMBIENTE</span><strong>${ready}/${total}</strong><small>ferramentas prontas</small></article>`;
  $('skills-count').textContent=`${skillCount} disponíveis`;
  $('skills-catalog').innerHTML=skillCount?(state.skills||[]).map(skill=>`<article class="skill-card"><span>${esc(skillStageLabels[skill.stage]||'Geral')}</span><h3>${esc(skill.name)}</h3><code>${esc(skill.id)}</code><p>${esc(skill.description)}</p></article>`).join(''):'<div class="empty-state"><h3>Nenhuma skill carregada</h3><p>Confira a pasta de skills configurada no servidor.</p></div>';
}
function usageWindowLabel(minutes){
  if(minutes===300)return 'Janela de 5 horas';
  if(minutes===10080)return 'Janela semanal';
  if(!minutes)return 'Janela de uso';
  if(minutes<1440)return `Janela de ${Math.round(minutes/60)} horas`;
  return `Janela de ${Math.round(minutes/1440)} dias`;
}
function usageBanner(employee,provider){
  if(!providerExhausted(provider))return '';
  /* Dormindo pela leitura da conta ou pelo histórico: o texto diz de onde veio a informação. */
  if(providerLimit(provider)?.known){
    const reset=limitResetText(providerLimit(provider));
    return `<p class="usage-message exhausted">Sem saldo agora — ${esc(employee.name)} está dormindo${reset?` até ${esc(reset)}`:''}.</p>`;
  }
  return '<p class="usage-message exhausted">O terminal registrou limite atingido em uma tarefa recente e a conta não informa o saldo.</p>';
}
function renderAgentUsage(){
  const target=$('agent-usage');if(!target)return;
  const reading=usageLoading?'<p class="form-hint">Consultando o /usage do Claude e os limites do Codex…</p>':'';
  if(!agentUsage){target.innerHTML=reading||'<p class="form-hint">Abra as configurações para consultar os limites.</p>';return;}
  const counts=Object.fromEntries(agentUsage.agents.map(item=>[item.id,item.consumedTokens]));
  target.innerHTML=reading+state.employees.map(employee=>{
    const provider=$(`assignment-${employee.id}`)?.value||state.assignments[employee.id];
    const info=agentUsage.providers[provider]||{available:false,message:'Limite indisponível.'};
    let limit;
    if(info.available&&info.buckets?.length){
      const bucket=info.buckets.find(item=>item.id===provider)||info.buckets[0];
      limit=`${usageBanner(employee,provider)}${bucket?.windows.length?bucket.windows.map(window=>{
        const reset=window.resetsText|| (window.resetsAt?new Date(window.resetsAt*1000).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'horário não informado');
        return `<div class="usage-window"><span>${esc(window.label||usageWindowLabel(window.windowDurationMins))}</span><strong>${window.remainingPercent}% restante</strong><div class="usage-bar"><i style="width:${window.remainingPercent}%"></i></div><small>Renova em ${esc(reset)}</small></div>`;
      }).join(''):'<p class="usage-message">O terminal não informou as janelas desta conta.</p>'}`;
    }else{
      limit=`${usageBanner(employee,provider)}<p class="usage-message">${esc(info.message)}</p>`;
    }
    const consumed=counts[employee.id]||0;
    return `<article class="agent-usage-card" style="--employee-color:${employee.color}"><header><span>${employee.initials}</span><div><strong>${esc(employee.name)}</strong><small>${esc(labels[provider]||provider)}</small></div></header>${limit}<footer>${consumed?`${consumed.toLocaleString('pt-BR')} tokens registrados nas tarefas`:'Sem consumo registrado pelo escritório'}</footer></article>`;
  }).join('');
}
/* O servidor sempre refaz a consulta: cada abertura das configurações traz a leitura do momento. */
async function loadAgentUsage(){
  if(usageLoading)return;usageLoading=true;renderAgentUsage();
  try{
    const response=await fetch('/api/usage',{method:'POST',headers:{'Content-Type':'application/json','X-Office-Token':token},body:'{}'});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Consulta indisponível.');
    agentUsage=result;
    if(result.limits)state={...state,limits:result.limits};
  }catch(error){agentUsage={providers:{claude:{available:false,message:error.message},codex:{available:false,message:error.message},bob:{available:false,message:error.message}},agents:state.employees.map(e=>({id:e.id,consumedTokens:0}))};}
  finally{usageLoading=false;render();}
}
function openSettings() {
  $('workspace-path').value = state.workspace;
  $('settings-error').textContent = state.binaries.bob && !state.readiness?.bob ? 'IBM Bob: defina BOB_API_KEY no seu terminal e reinicie o escritório. Você também pode selecionar Claude ou Codex para os funcionários abaixo.' : '';
  $('assignment-fields').innerHTML = state.employees.map(e => `<div class="assignment-row"><label for="assignment-${e.id}">${e.name}<small>${e.role}</small></label><select id="assignment-${e.id}">${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${state.assignments[e.id] === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`).join('');
  $('standup-toggle').checked = state.standup !== false;
  renderAgentUsage();void loadAgentUsage();
  $('settings-dialog').showModal();
}
function openMission(employee = 'team') {
  if (!state.workspace) { openSettings(); toast('Escolha primeiro a pasta onde a equipe vai trabalhar.'); return; }
  $('mission-error').textContent = '';
  $('mission-employee').innerHTML = '<option value="team">Toda a equipe · planejamento até entrega</option>' + state.employees.map(e => `<option value="${e.id}">${e.name} · ${e.role}</option>`).join('');
  $('mission-employee').value = employee;
  $('mission-folder').textContent = `Pasta de trabalho: ${state.workspace}`;
  const skills = Array.isArray(state.skills) ? state.skills : [];
  $('mission-skills').hidden = !skills.length;
  $('mission-skill-options').innerHTML = skillOptions('mission-skill');
  document.querySelector('.workflow-preview').innerHTML='AUDITAR <span>→</span> PLANEJAR <span>→</span> IMPLEMENTAR <span>→</span> VERIFICAR <span>→</span> ENTREGAR <span>→</span> MELHORAR';
  $('mission-dialog').showModal();
}
function latestMeetingTasks() {
  /* A mesa mostra a reunião mais recente. Encerrada, ela fica livre — não volta para uma conversa antiga. */
  const last = [...state.tasks].reverse().find(task => task.meeting);
  if (!last || last.closed) return [];
  const round = last.round || last.mission;
  return state.tasks.filter(task => task.meeting && (task.round || task.mission) === round);
}
function renderMeetingHistory(forceBottom = false) {
  const panel = $('meeting-history'), tasks = latestMeetingTasks();
  const nearBottom = forceBottom || panel.scrollHeight - panel.scrollTop - panel.clientHeight < 100;
  if (!tasks.length) {
    panel.innerHTML = '<div class="meeting-empty"><span>◎</span><strong>A mesa está livre.</strong><p>Defina uma pauta e reúna dois ou mais funcionários.</p></div>';
    return;
  }
  panel.innerHTML = `<div class="meeting-agenda"><small>PAUTA</small>${tasks[0].standup ? '<p>Alinhamento automático: o que mudou, o que ficou pendente e o que o resto do escritório precisa saber.</p>' : markdown(tasks[0].prompt)}</div>` + tasks.map(task => {
    const employee = state.employees.find(e => e.id === task.employee);
    return `<article class="meeting-turn ${task.status}"><div class="chat-avatar" style="--employee-color:${employee?.color || '#9fb3c6'}">${employee?.initials || '?'}</div><div><header><strong>${employee?.name || task.name}</strong><span>${statuses[task.status]}</span></header><div class="markdown-body">${markdown(employeeReply(task))}${task.status === 'running' ? '<span class="typing"><i></i><i></i><i></i></span>' : ''}</div><button type="button" class="chat-details" data-task="${task.id}">Ver detalhes</button></div></article>`;
  }).join('');
  if (nearBottom) requestAnimationFrame(() => { panel.scrollTop = panel.scrollHeight; });
}
function openMeeting() {
  const current = latestMeetingTasks();
  const selected = new Set(current.length ? current.map(task => task.employee) : state.employees.map(e => e.id));
  $('meeting-participants').innerHTML = state.employees.map(e => `<label style="--employee-color:${e.color}"><input type="checkbox" name="meeting-participant" value="${e.id}" ${selected.has(e.id) ? 'checked' : ''}><span>${e.initials}</span><b>${e.name}<small>${e.role}</small></b></label>`).join('');
  $('meeting-error').textContent = '';
  $('meeting-skill-options').innerHTML=skillOptions('meeting-skill');
  renderMeetingHistory(true);
  $('meeting-dialog').showModal();
}
function employeeReply(task) {
  const raw = (task.result || task.output || '').trim();
  if (raw) return raw.length > 30000 ? `…\n${raw.slice(-30000)}` : raw;
  if (task.status === 'queued') return 'Sua mensagem está na fila. Vou começar assim que o terminal estiver livre.';
  if (task.status === 'running') return 'Estou trabalhando nisso agora…';
  if (task.status === 'cancelled') return 'Esta tarefa foi encerrada.';
  if (task.status === 'interrupted') return 'O terminal foi interrompido antes de eu concluir.';
  return 'Não consegui produzir uma resposta. Abra os detalhes para verificar o terminal.';
}
const fileSize = value => value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${(value / 1024).toFixed(1)} KB` : `${(value / 1024 / 1024).toFixed(1)} MB`;
function attachmentIcon(file) {
  const type = file.type || '';
  if (type.startsWith('image/')) return '▧';
  if (/spreadsheet|excel|csv/.test(type) || /\.(xlsx?|csv|tsv)$/i.test(file.name)) return '▦';
  if (/pdf/.test(type) || /\.pdf$/i.test(file.name)) return '▤';
  return '◇';
}
function sentAttachments(files) {
  if (!Array.isArray(files) || !files.length) return '';
  return `<div class="sent-attachments">${files.map(file => `<span><b>${attachmentIcon(file)}</b><span>${esc(file.name)}<small>${fileSize(file.size || 0)}</small></span></span>`).join('')}</div>`;
}
function renderAttachmentDrafts() {
  $('attachment-drafts').innerHTML = pendingAttachments.map((file, index) => `<span class="attachment-draft"><b>${attachmentIcon(file)}</b><span>${esc(file.name)}<small>${fileSize(file.size)}</small></span><button type="button" data-remove-attachment="${index}" aria-label="Remover ${esc(file.name)}">×</button></span>`).join('');
}
function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: String(reader.result).split(',')[1] || '' });
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
function renderEmployeeChat(forceBottom = false) {
  const employee = state.employees.find(e => e.id === selectedEmployee);
  if (!employee) return;
  $('employee-title').innerHTML = `<span class="eyebrow"><i class="chat-presence ${statusKeyFor(employee.id)}"></i>${employee.role} · ${labels[state.assignments[employee.id]]} · ${statusFor(employee.id)}</span><h2>${employee.name}</h2>`;
  const chat = $('employee-chat');
  const nearBottom = forceBottom || chat.scrollHeight - chat.scrollTop - chat.clientHeight < 100;
  const tasks = state.tasks.filter(t => t.employee === employee.id);
  const intro = `<div class="chat-row agent"><div class="chat-avatar" style="--employee-color:${employee.color}">${employee.initials}</div><div><div class="chat-bubble agent-bubble">${esc(employee.greeting || `Olá! Eu sou ${employee.name}.`)}</div><span class="chat-meta">${esc(employee.role)}</span></div></div>`;
  chat.innerHTML = intro + tasks.map(t => {
    const live = ['queued', 'running'].includes(t.status) ? ' live' : '';
    return `<div class="chat-row user"><div><div class="chat-bubble user-bubble markdown-body">${markdown(t.prompt)}${sentAttachments(t.attachments)}</div><span class="chat-meta">Você · ${date(t.createdAt)}</span></div></div>
      <div class="chat-row agent${live}"><div class="chat-avatar" style="--employee-color:${employee.color}">${employee.initials}</div><div><div class="chat-bubble agent-bubble markdown-body">${markdown(employeeReply(t))}${t.status === 'running' ? '<span class="typing"><i></i><i></i><i></i></span>' : ''}</div><span class="chat-meta">${employee.name} · ${statuses[t.status]}${t.endedAt ? ` · ${date(t.endedAt)}` : ''} <button type="button" class="chat-details" data-task="${t.id}">Detalhes</button></span></div></div>`;
  }).join('');
  if (nearBottom) requestAnimationFrame(() => { chat.scrollTop = chat.scrollHeight; });
}
function openEmployee(id) {
  selectedEmployee = id;
  if (!state.employees.some(e => e.id === id)) return;
  $('employee-chat-error').textContent = '';
  pendingAttachments = [];
  $('employee-files').value = '';
  renderAttachmentDrafts();
  $('chat-skill-options').innerHTML=skillOptions('chat-skill');
  renderEmployeeChat(true);
  $('employee-dialog').showModal();
  requestAnimationFrame(() => $('employee-message').focus());
}
function openTask(id) { selectedTask = id; renderTask(); if (!$('task-dialog').open) $('task-dialog').showModal(); }
/* O que o funcionário fez com as ferramentas fica visualmente separado do que ele escreveu. */
function logLine(line) {
  if (line.startsWith('\u2699 ')) return `<span class="log-tool">${esc(line)}</span>`;
  if (line.startsWith('  \u21b3 ')) return `<span class="log-result">${esc(line)}</span>`;
  return esc(line);
}
function renderTask() {
  const task = state.tasks.find(t => t.id === selectedTask); if (!task) return;
  $('task-title').textContent = `${task.name} · ${task.role}`;
  $('task-provider').textContent = `${labels[task.provider]} / ${statuses[task.status]}${task.denied ? ' · uma ferramenta foi negada' : ''}`;
  $('task-meta').innerHTML = `${esc(date(task.createdAt))} · ${esc(task.workspace)}${task.skills?.length?`<span class="task-skill-tags">${task.skills.map(skill=>`<small>${esc(skill)}</small>`).join('')}</span>`:''}`;
  $('task-brief').textContent = task.prompt;
  const terminal = $('task-output');
  const nearBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight < 70;
  const log = task.output || (task.status === 'queued' ? 'Aguardando a etapa anterior e a liberação da fila.' : task.status === 'running' ? 'Terminal iniciado. Aguardando a primeira resposta…' : 'Nenhuma saída registrada.');
  terminal.innerHTML = log.split('\n').map(logLine).join('\n');
  if (nearBottom) terminal.scrollTop = terminal.scrollHeight;
  $('task-actions').innerHTML = ['running', 'queued'].includes(task.status) ? `<button class="button danger" data-cancel="${task.id}">Encerrar missão</button>` : ['failed', 'blocked', 'interrupted', 'cancelled', 'timedout'].includes(task.status) ? `<button class="button primary" data-retry="${task.id}">Retomar a partir desta etapa</button>` : '<span class="form-hint">Processo encerrado. Consulte a saída para conferir as validações.</span>';
}
function sceneData() {
  const meetingTasks = latestMeetingTasks();
  return {
    employees: state.employees.map(e => { const key = statusKeyFor(e.id); return { id: e.id, name: e.name, role: e.role, color: e.color, statusKey: key, statusLabel: presence[key], bubble: bubbleFor(e.id, key) }; }),
    meeting: meetingTasks.length ? { mission: meetingTasks[0].mission, title: meetingTasks[0].prompt, participants: meetingTasks.map(task => task.employee), active: meetingTasks.some(task => ['queued', 'running'].includes(task.status)) } : null,
    music: radioState()
  };
}
/* O mural é a memória compartilhada: aparece na tela de missões para você ver o mesmo que os funcionários leem. */
function renderBriefing() {
  const panel = $('office-briefing'); if (!panel) return;
  const entries = [...(state.briefing || [])].reverse().slice(0, 12);
  const heading = `<div class="section-heading"><div><h2>Mural do escritório</h2><span>${entries.length ? 'Cada funcionário lê isto antes de começar, mesmo em missão que não foi dele.' : 'Ainda sem registros. Entregas e alinhamentos entram aqui e viram contexto para todo o time.'}</span></div></div>`;
  panel.innerHTML = heading + entries.map(entry => {
    const employee = state.employees.find(e => e.id === entry.employee);
    return `<article class="briefing-item" style="--employee-color:${employee?.color || '#9fb3c6'}"><header>${employee ? avatar(employee) : ''}<div><strong>${esc(entry.name)}</strong><small>${esc(entry.role)} \u00b7 ${entry.kind === 'conversa' ? 'alinhamento' : 'entrega'} \u00b7 ${date(entry.at)}</small></div></header><p>${esc(entry.text)}</p></article>`;
  }).join('');
}
const planItem = id => planDraft && (planDraft.etapas.find(item => item.id === id) || planDraft.alinhamentos.find(item => item.id === id));
function planLabel(id) {
  const item = planItem(id); if (!item) return id;
  const name = employeeId => state.employees.find(e => e.id === employeeId)?.name || employeeId;
  return item.participantes ? `alinhamento ${item.participantes.map(name).join(' + ')}` : `etapa de ${name(item.employee)}`;
}
function renderPlan() {
  if (!planDraft) return;
  $('plan-summary').textContent = planDraft.resumo || 'Confira quem fica com cada parte antes de distribuir.';
  const order = planDraft.ordem.filter(planItem);
  $('plan-items').innerHTML = order.map((id, index) => {
    const item = planItem(id);
    const waits = item.depende.length
      ? `<small class="plan-waits">espera: ${item.depende.map(dep => esc(planLabel(dep))).join(' \u00b7 ')}</small>`
      : '<small class="plan-waits">pode começar já</small>';
    const remove = `<button type="button" class="text-button" data-plan-remove="${id}">remover</button>`;
    /* Escalar quem está sem saldo garante uma etapa falhando lá na frente: melhor avisar agora. */
    const asleep = (item.participantes || [item.employee]).filter(who => providerExhausted(state.assignments[who]));
    const warning = asleep.length
      ? `<small class="plan-asleep">${asleep.map(who => esc(state.employees.find(e => e.id === who)?.name || who)).join(' e ')} ${asleep.length > 1 ? 'estão' : 'está'} sem saldo no terminal: troque o responsável ou o terminal antes de distribuir.</small>`
      : '';
    if (item.participantes) {
      const names = item.participantes.map(p => esc(state.employees.find(e => e.id === p)?.name || p)).join(' + ');
      return `<article class="plan-item alignment"><header><span class="plan-index">\u25ce</span><strong>Alinhamento: ${names}</strong>${remove}</header><textarea data-plan-text="${id}" rows="2">${esc(item.pauta)}</textarea>${waits}${warning}</article>`;
    }
    const employee = state.employees.find(e => e.id === item.employee);
    return `<article class="plan-item" style="--employee-color:${employee?.color || '#9fb3c6'}"><header><span class="plan-index">${index + 1}</span><select data-plan-employee="${id}">${state.employees.map(e => `<option value="${e.id}" ${e.id === item.employee ? 'selected' : ''}>${esc(e.name)} \u00b7 ${esc(e.role)}</option>`).join('')}</select>${remove}</header><textarea data-plan-text="${id}" rows="3">${esc(item.tarefa)}</textarea>${waits}${warning}</article>`;
  }).join('');
}
function planRemove(id) {
  planDraft.etapas = planDraft.etapas.filter(item => item.id !== id);
  planDraft.alinhamentos = planDraft.alinhamentos.filter(item => item.id !== id);
  planDraft.ordem = planDraft.ordem.filter(item => item !== id);
  /* Quem esperava o item removido deixa de esperar, senão a fila trava em uma dependência que não existe mais. */
  for (const item of [...planDraft.etapas, ...planDraft.alinhamentos]) item.depende = item.depende.filter(dep => dep !== id);
  renderPlan();
}
function planCollect() {
  for (const field of document.querySelectorAll('[data-plan-text]')) {
    const item = planItem(field.dataset.planText); if (!item) continue;
    if (item.participantes) item.pauta = field.value; else item.tarefa = field.value;
  }
}
/* Encerrar a reunião sem plano: a conversa fica no histórico e cada um volta para a mesa de trabalho. */
async function leaveMeeting() {
  const tasks = latestMeetingTasks();
  if (!tasks.length) { $('meeting-error').textContent = 'Nenhuma reunião aberta para encerrar.'; return; }
  $('meeting-error').textContent = '';
  try { await api('meeting/close', { round: tasks[0].round || tasks[0].mission }); $('meeting-dialog').close(); toast('Reunião encerrada. Cada um voltou para a mesa.'); }
  catch (error) { $('meeting-error').textContent = error.message; }
}
function armDelete(mission) {
  clearTimeout(pendingDeleteTimer);
  pendingDelete = mission;
  /* Apagar não tem volta: o segundo clique precisa ser deliberado, e a oferta expira sozinha. */
  pendingDeleteTimer = setTimeout(() => { pendingDelete = null; render(); }, 6000);
  render();
}
/* Encerrar a reunião não encerra a demanda: o gerente distribui o combinado e cada um vai para a mesa dele. */
async function buildPlanFrom(origin, { button, errorField, label, dialog }) {
  button.disabled = true; const original = button.textContent; button.textContent = 'Montando o plano…'; $(errorField).textContent = '';
  try {
    const response = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': token }, body: JSON.stringify(origin) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível montar o plano.');
    planDraft = result.plan; planMission = result.mission; planEmployee = result.employee; planBackground = result.background || ''; planSkills = result.skills || [];
    $(dialog).close(); $('plan-error').textContent = ''; renderPlan(); $('plan-dialog').showModal();
  } catch (error) { $(errorField).textContent = error.message; }
  finally { button.disabled = false; button.textContent = label || original; }
}
async function closeMeeting() {
  const tasks = latestMeetingTasks();
  if (!tasks.length) { $('meeting-error').textContent = 'Nenhuma reunião para encerrar.'; return; }
  if (tasks.some(t => ['queued', 'running'].includes(t.status))) { $('meeting-error').textContent = 'Aguarde a reunião terminar antes de encerrar.'; return; }
  await buildPlanFrom({ mission: tasks[0].mission }, { button: $('close-meeting'), errorField: 'meeting-error', label: 'Encerrar e montar o plano', dialog: 'meeting-dialog' });
}
/* O alinhamento também acontece na conversa direta: o Felipe lê o que vocês combinaram e distribui daí. */
async function delegateFromChat() {
  if (!selectedEmployee) return;
  await buildPlanFrom({ employee: selectedEmployee }, { button: $('delegate-chat'), errorField: 'employee-chat-error', label: 'Montar plano com o time', dialog: 'employee-dialog' });
}
async function confirmPlan() {
  planCollect(); $('plan-error').textContent = '';
  const button = $('plan-confirm'); button.disabled = true;
  try { await api('plan/confirm', { mission: planMission, employee: planEmployee, background: planBackground, skills: planSkills, plan: planDraft }); $('plan-dialog').close(); planDraft = null; planSkills = []; switchView('tasks'); toast('Plano distribuído. Cada funcionário foi para a mesa dele.'); }
  catch (error) { $('plan-error').textContent = error.message; }
  finally { button.disabled = false; }
}
/* Colunas do mural: o mesmo vocabulário de estado que o resto do escritório usa. */
const MURAL_COLUNAS = [
  { chave: 'running', titulo: 'Em execução', estados: ['running'] },
  { chave: 'queued', titulo: 'Na fila', estados: ['queued'] },
  { chave: 'attention', titulo: 'Precisa de atenção', estados: ['failed', 'blocked', 'interrupted', 'timedout'] },
  { chave: 'done', titulo: 'Concluídas', estados: ['done'] },
  { chave: 'cancelled', titulo: 'Canceladas', estados: ['cancelled'] }
];
/* O que cada etapa aceita. Concluída não é destino: ninguém decide por fora que o agente entregou. */
function muralAcoes(task) {
  const acoes = [];
  if (task.status === 'queued') acoes.push({ chave: 'up', rotulo: '↑', titulo: 'Subir na fila' }, { chave: 'down', rotulo: '↓', titulo: 'Descer na fila' });
  if (['failed', 'blocked', 'interrupted', 'cancelled', 'timedout'].includes(task.status)) acoes.push({ chave: 'retry', rotulo: 'Retomar', titulo: 'Devolver esta etapa para a fila' });
  if (['running', 'queued', 'blocked', 'failed', 'interrupted', 'timedout'].includes(task.status)) acoes.push({ chave: 'cancel', rotulo: 'Cancelar', titulo: 'Encerrar esta etapa sem retomar' });
  return acoes;
}
const muralAceita = (task, coluna) =>
  coluna === 'queued' ? ['queued', 'failed', 'blocked', 'interrupted', 'cancelled', 'timedout'].includes(task.status)
    : coluna === 'cancelled' ? ['running', 'queued', 'blocked', 'failed', 'interrupted', 'timedout'].includes(task.status)
      : false;
function muralCard(task) {
  const employee = state.employees.find(e => e.id === task.employee);
  const titulo = task.standup ? 'Alinhamento de fim de missão' : task.prompt.trim().slice(0, 96) + (task.prompt.trim().length > 96 ? '…' : '');
  const espera = waitingFor(task);
  const marcas = [task.meeting ? 'reunião' : '', task.plan ? 'plano' : '', task.denied ? 'ferramenta negada' : ''].filter(Boolean);
  const acoes = muralAcoes(task);
  return `<article class="mural-card" data-card="${task.id}" ${acoes.length ? 'draggable="true"' : ''} style="--employee-color:${employee?.color || '#8c98a7'}">
    <button type="button" class="mural-abrir" data-task="${task.id}">
      <header>${employee ? avatar(employee) : ''}<div><strong>${esc(task.name)}</strong><small>${esc(task.role)}</small></div></header>
      <p>${esc(titulo)}</p>
      <footer>${espera ? `<span class="mural-espera">${esc(espera)}</span>` : ''}${marcas.map(m => `<span class="mural-marca">${esc(m)}</span>`).join('')}<time>${date(task.endedAt || task.startedAt || task.createdAt)}</time></footer>
    </button>
    ${acoes.length ? `<div class="mural-acoes">${acoes.map(a => `<button type="button" data-mural-acao="${a.chave}" data-mural-id="${task.id}" title="${esc(a.titulo)}">${a.rotulo}</button>`).join('')}</div>` : ''}
  </article>`;
}
/* O mural do escritório em 3D abre aqui: todas as tarefas, agrupadas pelo estado em que estão. */
let muralArrastando = null;
function renderMural() {
  const alvo = $('mural-board'); if (!alvo) return;
  if (muralArrastando) return;
  const tarefas = [...state.tasks].reverse();
  const total = tarefas.length;
  $('mural-resumo').textContent = total
    ? `${total} ${total === 1 ? 'tarefa registrada' : 'tarefas registradas'} · clique em qualquer cartão para abrir o terminal daquela etapa.`
    : 'Nenhuma tarefa ainda. O que a equipe fizer aparece aqui.';
  alvo.innerHTML = MURAL_COLUNAS.map(coluna => {
    /* A fila aparece na ordem de execução (quem roda primeiro em cima); o resto vem do mais
       recente para o mais antigo, que é como se olha histórico. */
    const itens = coluna.chave === 'queued'
      ? state.tasks.filter(t => coluna.estados.includes(t.status))
      : tarefas.filter(t => coluna.estados.includes(t.status));
    return `<section class="mural-coluna ${coluna.chave}" data-coluna="${coluna.chave}"><h3>${coluna.titulo}<span>${itens.length}</span></h3>${
      itens.length ? itens.map(muralCard).join('') : '<p class="mural-vazia">—</p>'
    }</section>`;
  }).join('');
}
/* Mover um cartão executa a ação real da coluna. Nada aqui é só visual: o quadro continua
   sendo o espelho do que o escritório fez. */
async function muralMover(id, coluna, beforeId) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (!muralAceita(task, coluna)) {
    toast(coluna === 'done' ? 'Concluída é o agente quem marca: ela aparece aqui quando a etapa entrega.' : 'Esse cartão não pode ir para essa coluna.');
    return;
  }
  try {
    if (coluna === 'cancelled') { await api('task/cancel', { id }); toast('Etapa cancelada.'); }
    else if (task.status === 'queued') await api('task/move', { id, beforeId: beforeId || null });
    else { await api('task/retry', { id }); toast('Etapa de volta para a fila.'); }
  } catch (error) { toast(error.message); }
}
async function muralAcao(chave, id) {
  if (chave === 'retry') return muralMover(id, 'queued');
  if (chave === 'cancel') return muralMover(id, 'cancelled');
  const fila = state.tasks.filter(t => t.status === 'queued');
  const posicao = fila.findIndex(t => t.id === id);
  if (posicao < 0) return;
  /* Subir é entrar antes do anterior; descer é passar para depois do próximo. */
  const destino = chave === 'up' ? fila[posicao - 1]?.id : fila[posicao + 2]?.id || null;
  if (chave === 'up' && !destino) return;
  if (chave === 'down' && posicao === fila.length - 1) return;
  try { await api('task/move', { id, beforeId: destino || null }); } catch (error) { toast(error.message); }
}
function openMural() {
  renderMural();
  $('mural-dialog').showModal();
}
function render() {
  $('working-stat').textContent = state.tasks.filter(t => t.status === 'running').length;
  $('queue-stat').textContent = state.tasks.filter(t => t.status === 'queued').length;
  $('done-stat').textContent = state.tasks.filter(t => t.status === 'done').length;
  $('mission-count').textContent = new Set(state.tasks.map(t => t.mission)).size;
  $('pause').textContent = state.paused ? '▶ Retomar fila' : 'Ⅱ Pausar fila';
  $('workspace-footer').textContent = state.workspace || 'Escolha uma pasta de projeto para começar.';
  $('workspace-chip').textContent = state.workspace || 'Escolha uma pasta de projeto para começar.';
  $('notice').hidden = !!state.workspace && !state.paused;
  $('notice').innerHTML = state.paused ? 'Fila pausada. A etapa em execução continua; as próximas aguardam você retomar.' : 'Seu time está pronto. <button data-action="settings">Escolha a pasta do projeto</button> para começar a construir.';
  $('provider-list').innerHTML = Object.entries(labels).map(([id, label]) => `<div class="provider"><span class="provider-icon">${id === 'claude' ? '✳' : id === 'codex' ? '›_' : 'b'}</span>${label}<small>${!state.binaries[id] ? 'Ausente' : id === 'bob' && !state.readiness?.bob ? 'Falta chave' : 'Instalado'}</small></div>`).join('');
  $('employee-roster').innerHTML = state.employees.map(e => `<button class="roster-item" data-employee="${e.id}" data-status="${statusKeyFor(e.id)}" style="--employee-color:${e.color}" aria-label="${e.name}, ${e.role}, ${statusFor(e.id)}"><i class="roster-dot"></i><span><strong>${e.name}</strong><small>${statusFor(e.id)}</small></span></button>`).join('');
  $('employee-cards').innerHTML = state.employees.map(e => `<button class="employee-card" data-employee="${e.id}"><div class="employee-card-top">${avatar(e)}<span class="status-dot ${activeFor(e.id) ? 'running' : ''}"></span></div><h3>${e.name}</h3><p>${e.role}</p><span class="provider-tag">${labels[state.assignments[e.id]]}</span></button>`).join('');
  $('team-details').innerHTML = state.employees.map(e => `<article class="team-detail" style="--employee-color:${e.color}">${avatar(e)}<h3>${e.name}</h3><h4>${e.role}</h4><p>${esc(e.summary || e.instruction)}</p><button class="button" data-employee="${e.id}">Conversar com ${e.name} ↗</button></article>`).join('');
  const recent = [...state.tasks].filter(t => t.status !== 'queued').sort((a,b) => new Date(b.endedAt || b.startedAt || b.createdAt) - new Date(a.endedAt || a.startedAt || a.createdAt)).slice(0, 12);
  $('activity-list').innerHTML = recent.length ? recent.map(t => { const e = state.employees.find(e => e.id === t.employee); return `<button class="activity-item" data-task="${t.id}">${avatar(e)}<div><p><strong>${e.name}</strong> · ${statuses[t.status]}<br>${esc(t.prompt.slice(0, 68))}${t.prompt.length > 68 ? '…' : ''}</p><small>${date(t.endedAt || t.startedAt || t.createdAt)}</small></div></button>`; }).join('') : '<div class="activity-empty"><span>⌁</span><strong>O próximo projeto começa aqui.</strong><p>Quando uma missão começar, você verá o trabalho de cada funcionário em tempo real.</p><button class="text-button" data-action="mission">Criar primeira missão ↗</button></div>';
  const missions = [...new Set(state.tasks.map(t => t.mission))].reverse();
  $('mission-list').innerHTML = missions.length ? missions.map(id => {
    const tasks = state.tasks.filter(t => t.mission === id), first = tasks[0];
    const unfinished = tasks.some(t => ['queued', 'running'].includes(t.status));
    const closed = (state.finished || []).includes(id);
    const skills=[...new Set(tasks.flatMap(task=>task.skills||[]))];
    return `<article class="mission-card"><h3>${first.standup ? 'Alinhamento automático de fim de missão' : esc(first.prompt.slice(0, 240))}</h3><div class="mission-info">${date(first.createdAt)} · ${tasks.filter(t => t.status === 'done').length}/${tasks.length} etapas concluídas${closed ? ' · encerrada' : ''} · ${esc(first.workspace)}</div>${skills.length?`<div class="mission-skill-tags">${skills.map(skill=>`<span>${esc(skill)}</span>`).join('')}</div>`:''}<div class="stages">${tasks.map((t, i) => `<button class="stage ${t.status}" data-task="${t.id}"><strong>${t.meeting ? '\u25ce' : `${i + 1}.`} ${t.name}</strong><small>${waitingFor(t) || statuses[t.status]}${t.denied ? ' ⚠' : ''}</small></button>`).join('')}</div><div class="mission-controls"><button class="text-button" data-export="${id}">↓ Exportar</button>${closed ? '' : `<button class="text-button" data-finish="${id}">Encerrar demanda</button>`}${unfinished ? '' : `<button class="text-button" data-archive="${id}">Arquivar</button>`}${unfinished ? '' : pendingDelete === id ? `<button class="text-button confirm-delete" data-delete="${id}">Confirmar exclusão</button>` : `<button class="text-button" data-arm-delete="${id}">Apagar</button>`}</div></article>`;
  }).join('') : '<div class="empty-state"><h3>O que vamos construir?</h3><p>Conte a ideia ao time ou atribua uma tarefa a um funcionário.<br>As etapas e os resultados ficam registrados aqui.</p><button class="button primary" data-action="mission">＋ Nova missão</button></div>';
  try { office3d?.update(sceneData()); }
  catch (error) { office3d = null; sceneAvailability(false, `A cena 3D parou por um erro (${error.message || error}). ${fallbackHelp}`); }
  if ($('employee-dialog').open) renderEmployeeChat();
  if ($('meeting-dialog').open) renderMeetingHistory();
  if ($('task-dialog').open) renderTask();
  renderBriefing();
  if ($('settings-dialog').open) renderAgentUsage();
  if ($('mural-dialog').open) renderMural();
  renderDependencies();
  renderMcps();
  renderCapabilities();
}
function download(tasks, filename) {
  const text = tasks.map(t => `# ${t.name} — ${t.role}\n\nTerminal: ${labels[t.provider]}\nStatus: ${statuses[t.status]}\nPasta: ${t.workspace}\n\n## Pedido\n${t.prompt}\n\n## Resultado / saída\n${t.output || '(sem saída)'}\n`).join('\n---\n\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/* Cena 3D: carregada sob demanda. Se o WebGL não estiver disponível, a lista da equipe
   continua sendo o caminho completo de uso — nada aqui depende da cena para funcionar. */
const fallbackHelp = 'A lista da equipe continua funcionando: escolha um funcionário para abrir o histórico e atribuir tarefas.';
function sceneAvailability(available, message) {
  $('stage').classList.toggle('no-3d', !available);
  $('office-fallback').hidden = available;
  if (!available && message) $('fallback-reason').textContent = message;
}
async function startScene() {
  try {
    const { createOffice3D } = await import('/office3d.js');
    office3d = createOffice3D({
      canvas: $('office-canvas'),
      overlay: $('office-overlay'),
      onSelect: openEmployee,
      onMeeting: openMeeting,
      onMusic: toggleOfficeRadio,
      onMural: openMural,
      onHover: id => document.querySelectorAll('.roster-item').forEach(item => item.classList.toggle('is-active', item.dataset.employee === id)),
      onAvailability: (ok, reason) => sceneAvailability(ok, ok ? '' : `${reason}. ${fallbackHelp}`)
    });
    office3d.setActive(!$('office-view').hidden);
    office3d.update(sceneData());
  } catch (error) {
    office3d = null;
    sceneAvailability(false, `Não foi possível iniciar o WebGL neste navegador (${error.message || error}). ${fallbackHelp}`);
  }
}
document.addEventListener('click', async event => {
  const button = event.target.closest('button'); if (!button) return;
  if (button.id === 'attach-files') $('employee-files').click();
  if (button.dataset.removeAttachment !== undefined) { pendingAttachments.splice(Number(button.dataset.removeAttachment), 1); renderAttachmentDrafts(); }
  if (button.dataset.close) $(button.dataset.close).close();
  if (button.dataset.view) { switchView(button.dataset.view); if(button.dataset.view==='tools') void loadDependencies(); }
  if (button.dataset.camera) office3d?.camera(button.dataset.camera);
  if (button.dataset.employee) openEmployee(button.dataset.employee);
  if (button.dataset.task) openTask(button.dataset.task);
  if (button.dataset.action === 'settings') openSettings();
  if (button.id === 'usage-refresh') await loadAgentUsage();
  if (button.id === 'dependencies-refresh') await loadDependencies();
  if(button.id==='mcp-add')openMcpEditor();
  if(button.dataset.mcpEdit)openMcpEditor(button.dataset.mcpEdit);
  if(button.dataset.mcpRemove){mcpPendingDelete=button.dataset.mcpRemove;renderMcps();}
  if(button.dataset.mcpConfirmRemove){
    try{await mcpRequest('remove',{name:button.dataset.mcpConfirmRemove});mcpPendingDelete='';toast('MCP removido do catálogo. Configurações já aplicadas nas IAs foram preservadas.');}
    catch(error){toast(error.message);}
  }
  if(button.dataset.mcpApply){
    mcpApplying=button.dataset.mcpApply;renderMcps();
    try{const result=await mcpRequest('apply',{name:mcpApplying});const failed=Object.values(result.results||{}).filter(item=>!item.ok);toast(failed.length?`MCP aplicado com ${failed.length} pendência(s). Consulte os indicadores.`:'MCP configurado. Reinicie os terminais que já estavam abertos.');}
    catch(error){toast(error.message);}finally{mcpApplying='';renderMcps();}
  }
  if (button.dataset.dependencyCommand) {
    const item=state.dependencies?.items?.find(entry=>entry.id===button.dataset.dependencyCommand);
    if(item?.actionCommand){try{await navigator.clipboard.writeText(item.actionCommand);toast('Comando copiado. Revise antes de executar.');}catch{toast('Não foi possível copiar automaticamente. Selecione o comando exibido.');}}
  }
  if (button.id === 'close-meeting') await closeMeeting();
  if (button.id === 'leave-meeting') await leaveMeeting();
  if (button.id === 'delegate-chat') await delegateFromChat();
  if (button.dataset.armDelete) armDelete(button.dataset.armDelete);
  if (button.id === 'plan-confirm') await confirmPlan();
  if (button.dataset.planRemove) planRemove(button.dataset.planRemove);
  if (button.dataset.muralAcao) { await muralAcao(button.dataset.muralAcao, button.dataset.muralId); return; }
  if (button.dataset.action === 'mission') openMission();
  if (button.dataset.action === 'meeting') openMeeting();
  if (button.id === 'export-all') download(state.tasks, 'dev-office-historico.md');
  if (button.id === 'download-task') download(state.tasks.filter(t => t.id === selectedTask), 'dev-office-etapa.md');
  if (button.dataset.export) download(state.tasks.filter(t => t.mission === button.dataset.export), 'dev-office-missao.md');
  try {
    if (button.id === 'pause') await api('pause', { paused: !state.paused });
    if (button.dataset.cancel) { await api('cancel', { id: button.dataset.cancel }); toast('Missão encerrada. As alterações já feitas foram preservadas.'); }
    if (button.dataset.retry) { await api('retry', { id: button.dataset.retry }); toast('Etapa retomada.'); }
    if (button.dataset.archive) { await api('archive', { mission: button.dataset.archive }); toast('Demanda arquivada. A cópia ficou em .office/archive.'); }
    if (button.dataset.finish) {
      const mission = button.dataset.finish;
      await api('finish', { mission });
      /* Demanda de uma etapa só não tem com quem alinhar: o aviso não promete uma conversa que não vai acontecer. */
      toast(state.tasks.some(t => t.standup && t.about === mission) ? 'Demanda encerrada. O time está registrando onde parou.' : 'Demanda encerrada.');
    }
    if (button.dataset.delete) { clearTimeout(pendingDeleteTimer); pendingDelete = null; await api('delete', { mission: button.dataset.delete }); toast('Demanda apagada. Não ficou nada no histórico nem no mural.'); }
  } catch (error) { toast(error.message); }
});
$('settings-form').addEventListener('change',event=>{if(event.target.id?.startsWith('assignment-'))renderAgentUsage();});
$('mural-board').addEventListener('dragstart', event => {
  const card = event.target.closest?.('.mural-card'); if (!card) return;
  muralArrastando = card.dataset.card;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', card.dataset.card);
  card.classList.add('arrastando');
  /* Marcar os destinos já no começo do arraste evita o usuário descobrir que não podia
     só depois de soltar — que era o caso da coluna Concluídas. */
  const task = state.tasks.find(t => t.id === card.dataset.card);
  document.querySelectorAll('.mural-coluna').forEach(c => {
    c.classList.toggle('aceita', !!task && muralAceita(task, c.dataset.coluna));
    c.classList.toggle('recusa', !!task && !muralAceita(task, c.dataset.coluna));
  });
});
$('mural-board').addEventListener('dragend', event => {
  muralArrastando = null;
  event.target.closest?.('.mural-card')?.classList.remove('arrastando');
  document.querySelectorAll('.mural-coluna').forEach(c => c.classList.remove('alvo', 'aceita', 'recusa'));
  renderMural();
});
$('mural-board').addEventListener('dragover', event => {
  const coluna = event.target.closest?.('.mural-coluna'); if (!coluna || !muralArrastando || coluna.classList.contains('recusa')) return;
  event.preventDefault();
  document.querySelectorAll('.mural-coluna.alvo').forEach(c => c !== coluna && c.classList.remove('alvo'));
  coluna.classList.add('alvo');
});
$('mural-board').addEventListener('drop', async event => {
  const coluna = event.target.closest?.('.mural-coluna'); if (!coluna) return;
  event.preventDefault();
  const id = event.dataTransfer.getData('text/plain') || muralArrastando;
  /* Soltar em cima de outro cartão da fila quer dizer "entre antes deste". */
  const sobre = event.target.closest?.('.mural-card');
  muralArrastando = null;
  document.querySelectorAll('.mural-coluna').forEach(c => c.classList.remove('alvo', 'aceita', 'recusa'));
  if (id) await muralMover(id, coluna.dataset.coluna, sobre && sobre.dataset.card !== id ? sobre.dataset.card : null);
  renderMural();
});
$('plan-items').addEventListener('change', event => {
  const id = event.target.dataset?.planEmployee; if (!id) return;
  const item = planItem(id); if (item) { planCollect(); item.employee = event.target.value; renderPlan(); }
});
for (const type of ['pointerover', 'focusin']) $('employee-roster').addEventListener(type, event => {
  const item = event.target.closest('.roster-item');
  office3d?.highlight(item ? item.dataset.employee : null);
});
for (const type of ['pointerout', 'focusout']) $('employee-roster').addEventListener(type, event => {
  if (!event.relatedTarget || !$('employee-roster').contains(event.relatedTarget)) office3d?.highlight(null);
});
for (const id of ['mission-form', 'settings-form']) $(id).addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const errorId = id === 'mission-form' ? 'mission-error' : 'settings-error'; $(errorId).textContent = '';
  try {
    if (id === 'settings-form') {
      const assignments = Object.fromEntries(state.employees.map(e => [e.id, $(`assignment-${e.id}`).value]));
      await api('config', { workspace: $('workspace-path').value.trim(), assignments, standup: $('standup-toggle').checked }); $('settings-dialog').close(); toast('Escritório configurado. Seu time está pronto.');
    } else {
      const skills = [...document.querySelectorAll('input[name="mission-skill"]:checked')].map(input => input.value);
      await api('missions', { employee: $('mission-employee').value, prompt: $('mission-prompt').value, skills }); $('mission-dialog').close(); $('mission-prompt').value = ''; toast('Missão enviada para a equipe.');
    }
  } catch (error) { $(errorId).textContent = error.message; }
  finally { button.disabled = false; }
});
$('employee-chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  const input = $('employee-message'), button = event.submitter || event.currentTarget.querySelector('[type="submit"]');
  const prompt = input.value.trim();
  $('employee-chat-error').textContent = '';
  if (!prompt && !pendingAttachments.length) { $('employee-chat-error').textContent = 'Escreva uma mensagem ou adicione pelo menos um arquivo.'; return; }
  if (prompt && prompt.length < 5) { $('employee-chat-error').textContent = 'Escreva pelo menos 5 caracteres.'; return; }
  if (!state.workspace) {
    $('employee-dialog').close(); openSettings(); toast('Escolha primeiro a pasta onde a equipe vai trabalhar.'); return;
  }
  button.disabled = true;
  try {
    const attachments = await Promise.all(pendingAttachments.map(encodeFile));
    const skills=[...document.querySelectorAll('input[name="chat-skill"]:checked')].map(item=>item.value);
    await api('missions', { employee: selectedEmployee, prompt: prompt || 'Analise os arquivos anexados e use-os como contexto.', attachments, skills });
    input.value = '';
    pendingAttachments = [];
    $('employee-files').value = '';
    renderAttachmentDrafts();
    renderEmployeeChat(true);
    input.focus();
  } catch (error) { $('employee-chat-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('employee-files').addEventListener('change', event => {
  const incoming = [...event.target.files];
  const combined = [...pendingAttachments, ...incoming];
  if (combined.length > 5) { $('employee-chat-error').textContent = 'Você pode enviar no máximo 5 arquivos por mensagem.'; event.target.value = ''; return; }
  if (incoming.some(file => file.size > 8 * 1024 * 1024)) { $('employee-chat-error').textContent = 'Cada arquivo pode ter no máximo 8 MB.'; event.target.value = ''; return; }
  if (combined.reduce((sum, file) => sum + file.size, 0) > 20 * 1024 * 1024) { $('employee-chat-error').textContent = 'Os arquivos podem somar no máximo 20 MB.'; event.target.value = ''; return; }
  pendingAttachments = combined;
  $('employee-chat-error').textContent = '';
  event.target.value = '';
  renderAttachmentDrafts();
});
$('employee-message').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    $('employee-chat-form').requestSubmit();
  }
});
$('meeting-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  const participants = [...document.querySelectorAll('input[name="meeting-participant"]:checked')].map(input => input.value);
  const prompt = $('meeting-prompt').value.trim();
  $('meeting-error').textContent = '';
  if (participants.length < 2) { $('meeting-error').textContent = 'Escolha pelo menos dois funcionários.'; return; }
  if (!state.workspace) { $('meeting-dialog').close(); openSettings(); toast('Escolha primeiro a pasta do projeto.'); return; }
  button.disabled = true;
  try {
    const skills=[...document.querySelectorAll('input[name="meeting-skill"]:checked')].map(item=>item.value);
    await api('missions', { participants, prompt, skills });
    $('meeting-prompt').value = '';
    renderMeetingHistory(true);
    toast('A reunião começou. Os participantes já estão na mesa.');
  } catch (error) { $('meeting-error').textContent = error.message; }
  finally { button.disabled = false; }
});
$('mcp-transport').addEventListener('change',toggleMcpFields);
for(const button of document.querySelectorAll('[data-mcp-mode]'))button.addEventListener('click',()=>setMcpMode(button.dataset.mcpMode));
$('mcp-json').addEventListener('input',validateMcpJson);
$('mcp-json-example').addEventListener('click',()=>{
  $('mcp-json').value=JSON.stringify({mcpServers:{opensearch:{type:'stdio',command:'uvx',args:['opensearch-mcp-server-py'],env:{OPENSEARCH_URL:'${OPENSEARCH_URL}',OPENSEARCH_USERNAME:'${OPENSEARCH_USERNAME}',OPENSEARCH_PASSWORD:'${OPENSEARCH_PASSWORD}'}}}},null,2);validateMcpJson();
});
document.addEventListener('change',event=>{
  if(!['mission-skill','meeting-skill','chat-skill'].includes(event.target?.name)||!event.target.checked)return;
  const selected=[...document.querySelectorAll(`input[name="${event.target.name}"]:checked`)];
  if(selected.length>4){event.target.checked=false;toast('Escolha no máximo 4 skills por missão.');}
});
$('mcp-form').addEventListener('submit',async event=>{
  event.preventDefault();const button=event.submitter;$('mcp-error').textContent='';button.disabled=true;
  const targets=[...document.querySelectorAll('input[name="mcp-target"]:checked')].map(input=>input.value);
  try{
    if(mcpMode==='json'){
      const json=$('mcp-json').value.trim(),names=mcpJsonNames(JSON.parse(json));
      if(mcpEditing&&(names.length!==1||names[0]!==mcpEditing))throw new Error(`Ao editar, mantenha o nome "${mcpEditing}". Para importar outro servidor, abra um novo cadastro.`);
      const result=await mcpRequest('import',{json,targets});$('mcp-dialog').close();mcpEditing='';toast(`${result.imported.length} MCP${result.imported.length===1?'':'s'} salvo${result.imported.length===1?'':'s'} no catálogo.`);
    }else{
      const transport=$('mcp-transport').value,server={name:$('mcp-name').value.trim(),transport,targets};
      if(transport==='http')server.url=$('mcp-url').value.trim();else{server.command=$('mcp-command').value.trim();server.args=$('mcp-args').value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);}
      await mcpRequest('save',{server});$('mcp-dialog').close();mcpEditing='';toast('MCP salvo. Use “Aplicar nas IAs” para configurar os perfis selecionados.');
    }
  }
  catch(error){$('mcp-error').textContent=error.message;}finally{button.disabled=false;}
});
function connectionStatus(ok) { connected = ok; $('connection').textContent = ok ? '● Conectado localmente' : '○ Escritório desconectado'; $('connection').style.color = ok ? '#a7cdb1' : '#efb3a7'; }
async function connect() {
  try {
    const response = await fetch('/api/bootstrap'); if (!response.ok) throw new Error('Servidor indisponível');
    const data = await response.json(); token = data.token; delete data.token; state = data; connectionStatus(true); render();
    if(!spotifyBooted){spotifyBooted=true;void spotifyRadio.boot();}
    const stream = await fetch('/api/events', { headers: { 'X-Office-Token': token } });
    if (!stream.ok || !stream.body) throw new Error('Conexão indisponível');
    const reader = stream.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      buffer += decoder.decode(value, { stream: true }); const blocks = buffer.split('\n\n'); buffer = blocks.pop();
      for (const block of blocks) if (block.startsWith('data: ')) { state = JSON.parse(block.slice(6)); render(); }
    }
  } catch { /* The visible connection indicator explains unavailable local service. */ }
  connectionStatus(false); setTimeout(connect, 3000);
}
startScene();
connect();
