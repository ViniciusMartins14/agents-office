import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { employees, commandFor, buildPrompt, decodeLine, compact, briefingText, BRIEFING_LIMIT, STANDUP_AGENDA } from './adapters.mjs';
import { Spotify } from './spotify.mjs';
import { chooseMusic } from './music-dj.mjs';
import { buildPlan, parsePlan } from './planner.mjs';
import {eventUsage,limitsFromUsage,readClaudeUsage,readCodexUsage,readUsagebar} from './usage.mjs';
import {spawnTarget} from './process-spawn.mjs';
import { SkillCatalog } from './skills.mjs';
import { AiMemory } from './ai-memory.mjs';
import { inspectDependencies } from './dependencies.mjs';
import { McpRegistry } from './mcps.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.OFFICE_DATA_DIR || path.join(root, '.office');
const skillsDir = process.env.OFFICE_SKILLS_DIR ? path.resolve(process.env.OFFICE_SKILLS_DIR) : path.join(root, 'skills');
const port = Number(process.env.PORT || 4317);
const token = randomBytes(32).toString('hex');
const spotify = new Spotify({dataDir, port});
await spotify.init();
let musicRevision=0, musicChoice=null, djAbort=null;
let usageCache=null,usageReading=null,usageLimits={};
let planning=false;
const skillCatalog = new SkillCatalog(skillsDir);
const mcpRegistry = new McpRegistry(path.join(dataDir, 'mcps.json'));
let projectMemory = null;
let availableSkills = await skillCatalog.list();
let dependencyReport = { platform: process.platform, arch: process.arch, checkedAt: null, items: [] };
const running = new Map();
const clients = new Set();
let binaries = {};
let closing = false;
await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
await mcpRegistry.load();
await mcpRegistry.ensure({ name: 'ai-memory', transport: 'http', url: 'http://127.0.0.1:49375/mcp', targets: ['claude', 'codex', 'bob'] });
let state = { workspace: '', assignments: Object.fromEntries(employees.map(e => [e.id, e.provider])), tasks: [], paused: false, briefing: [], standup: true, finished: [], finishing: [] };
try { state = { ...state, ...JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8')) }; }
catch (error) { if (error.code !== 'ENOENT') throw new Error(`Não foi possível ler o histórico: ${error.message}`); }
/* Antes desta versão, o aviso de limite vinha do texto do funcionário e do evento de uso do Claude: contas
   liberadas ficavam marcadas como esgotadas. Descartamos essas marcas uma única vez; a leitura das contas e
   as próximas tarefas repõem o que for real. */
if (state.quotaDetection !== 2) { for (const task of state.tasks) delete task.exhausted; state.quotaDetection = 2; }
if (!Array.isArray(state.briefing)) state.briefing = [];
if (typeof state.standup !== 'boolean') state.standup = true;
if (!Array.isArray(state.finished)) state.finished = [];
if (!Array.isArray(state.finishing)) state.finishing = [];
/* Até aqui o escritório lia "ferramenta negada" como "etapa barrada", e entregas inteiras viraram pendência
   e ficaram fora do mural. Reclassificamos uma única vez e devolvemos essas entregas à memória do time. */
if (!state.deniedFix) {
  for (const task of state.tasks) {
    if (task.status !== 'blocked' || task.exitCode !== 0 || !String(task.result || '').trim()) continue;
    task.status = 'done'; task.denied = true;
    remember(task, task.standup ? 'conversa' : 'entrega');
  }
  state.briefing.sort((a, b) => new Date(a.at) - new Date(b.at));
  state.deniedFix = true;
}
/* Mesmo engano com o aviso de cota: entregas completas viraram falha porque o Claude avisou que a
   janela estava acabando. Quem terminou com codigo 0 e resposta entregou — reclassificamos uma vez. */
if (!state.quotaDeliveryFix) {
  for (const task of state.tasks) {
    if (!task.exhausted || task.exitCode !== 0 || !String(task.result || '').trim()) continue;
    if (!['failed', 'blocked'].includes(task.status)) continue;
    task.status = 'done';
    remember(task, task.standup ? 'conversa' : 'entrega');
  }
  state.briefing.sort((a, b) => new Date(a.at) - new Date(b.at));
  state.quotaDeliveryFix = true;
}
for (const task of state.tasks) if (['running', 'queued'].includes(task.status)) { task.status = 'interrupted'; task.endedAt = new Date().toISOString(); }
let saving = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(state, null, 2);
  saving = saving.catch(() => {}).then(async () => {
    const tmp = path.join(dataDir, 'state.tmp');
    await fs.writeFile(tmp, snapshot, { mode: 0o600 });
    await fs.rename(tmp, path.join(dataDir, 'state.json'));
  });
  return saving;
}
function publicState() { return { ...state, employees, skills: availableSkills, dependencies: dependencyReport, mcps: mcpRegistry.publicState(), binaries: Object.fromEntries(Object.entries(binaries).map(([key, value]) => [key, !!value])), readiness: { bob: !!process.env.BOB_API_KEY }, memory: { provider: 'ai-memory', active: !!projectMemory?.ready, endpoint: 'http://127.0.0.1:49375/mcp', dataDirectory: path.join(dataDir, 'ai-memory') }, limits: usageLimits, local: true }; }
function broadcast() { const data = `data: ${JSON.stringify(publicState())}\n\n`; for (const client of clients) client.write(data); }
async function changed() { await save(); broadcast(); }
async function locate(name) {
  const names = process.platform === 'win32' ? [`${name}.exe`, name] : [name];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const filename of names) {
      const candidate = path.join(dir, filename);
      try { await fs.access(candidate, constants.X_OK); return candidate; } catch {}
    }
    /* npm expõe .cmd no PATH do Windows, mas spawn(shell:false) não executa scripts de cmd. Preferimos o
       binário nativo instalado pelo pacote para preservar argumentos como dados e evitar um shell. */
    if (process.platform === 'win32') {
      const target = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
      const native = name === 'claude'
        ? path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
        : name === 'codex'
          ? path.join(dir, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', `codex-win32-${process.arch}`, 'vendor', target, 'bin', 'codex.exe')
          : null;
      if (native) try { await fs.access(native, constants.X_OK); return native; } catch {}
    }
  }
  return null;
}
async function refreshBinaries() {
  binaries = Object.fromEntries(await Promise.all(['claude', 'codex', 'bob', 'ai-usagebar', 'ai-memory'].map(async name => [name, await locate(name)])));
  dependencyReport = await inspectDependencies({ knownBinaries: binaries });
}
await refreshBinaries();
projectMemory = new AiMemory({ binary: binaries['ai-memory'], dataDirectory: path.join(dataDir, 'ai-memory') });
try { await projectMemory.start(); }
catch (error) { console.error(`ai-memory indisponível: ${error.message}`); }
await save();

/* O /usage do Claude abre um terminal interativo, então a consulta é compartilhada: pedidos simultâneos
   esperam a mesma leitura em vez de abrir vários processos para a mesma conta. */
function readUsage(force = false) {
  if (!force && usageCache && Date.now() - usageCache.at < 60_000) return Promise.resolve(usageCache.providers);
  if (usageReading) return usageReading;
  usageReading = (async () => {
    if (binaries['ai-usagebar']) {
      try {
        const providers = { ...await readUsagebar(binaries['ai-usagebar']), bob: { available: false, message: 'O IBM Bob CLI não informa um saldo restante em tokens.' } };
        usageCache = { at: Date.now(), providers };
        usageLimits = limitsFromUsage(providers);
        return providers;
      } catch {}
    }
    const [claudeResult, codexResult] = await Promise.allSettled([readClaudeUsage(binaries.claude), readCodexUsage(binaries.codex)]);
    const providers = {
      claude: claudeResult.status === 'fulfilled' ? claudeResult.value : { available: false, message: claudeResult.reason?.message || 'Não foi possível consultar /usage.' },
      codex: codexResult.status === 'fulfilled' ? codexResult.value : { available: false, message: codexResult.reason?.message || 'Não foi possível consultar o Codex.' },
      bob: { available: false, message: 'O IBM Bob CLI não informa um saldo restante em tokens.' }
    };
    usageCache = { at: Date.now(), providers };
    usageLimits = limitsFromUsage(providers);
    return providers;
  })().finally(() => { usageReading = null; });
  return usageReading;
}
async function refreshUsage(force = false) {
  const before = JSON.stringify(usageLimits);
  try { await readUsage(force); } catch { return; }
  if (JSON.stringify(usageLimits) !== before) broadcast();
}
/* Quem está sem saldo: vale a leitura da conta quando ela existe; sem leitura, o último aviso de limite
   registrado nas tarefas. Assim um recado antigo não deixa o funcionário dormindo com a conta liberada. */
function providerOutOfQuota(provider) {
  const limit = usageLimits[provider];
  if (limit?.known) return !!limit.exhausted;
  const latest = [...state.tasks].reverse().find(task => task.provider === provider && (task.exhausted || task.status === 'done'));
  return !!latest?.exhausted;
}
/* Quantos funcionários entram no fechamento. O corte existe por causa de cota: cada participante é uma
   chamada a mais no terminal dele. */
const STANDUP_SEATS = 3;
/* O mural guarda o essencial de cada entrega e de cada alinhamento, e é lido por todo mundo no prompt. */
function remember(task, kind) {
  const text = compact(task.result || task.output, kind === 'conversa' ? 600 : 320);
  if (!text) return;
  state.briefing = [...state.briefing, { at: task.endedAt || new Date().toISOString(), employee: task.employee, name: task.name, role: task.role, kind, mission: task.mission, text }].slice(-BRIEFING_LIMIT * 2);
}
function readyEmployee(id) {
  const provider = state.assignments[id];
  return !!binaries[provider] && !(provider === 'bob' && !process.env.BOB_API_KEY) && !providerOutOfQuota(provider);
}
/* Terminada uma missão de verdade, quem trabalhou nela e ainda tem saldo conversa para registrar o que o
   resto do escritório precisa saber. A conversa só troca contexto: missão nova continua sendo decisão sua. */
function queueStandup(mission, { force = false } = {}) {
  if ((!state.standup && !force) || closing) return false;
  const tasks = state.tasks.filter(t => t.mission === mission);
  if (tasks.length < 2 || tasks.some(t => t.standup)) return false;
  if (state.tasks.some(t => ['queued', 'running'].includes(t.status))) return false;
  const worked = [...new Set(tasks.filter(t => t.status === 'done').map(t => t.employee))].filter(readyEmployee);
  const seats = worked.slice(-STANDUP_SEATS);
  if (seats.length < 2 || state.tasks.length + seats.length > 200) return false;
  const round = randomUUID();
  for (const id of seats) {
    const employee = employees.find(e => e.id === id);
    state.tasks.push({ id: randomUUID(), mission: round, round, about: mission, employee: employee.id, role: employee.role, name: employee.name, provider: state.assignments[employee.id], workspace: tasks[0].workspace, prompt: STANDUP_AGENDA, attachments: [], chat: false, meeting: true, standup: true, participants: seats, status: 'queued', output: '', result: '', createdAt: new Date().toISOString() });
  }
  return true;
}

/* Teto de conversas que os funcionários podem pedir por conta própria dentro de uma mesma demanda. */
const ASKED_LIMIT = 3;
function meetingTasks({ mission, round, people, pauta, workspace, depends, asked, background = '' }) {
  const created = [];
  let previous = depends;
  for (const id of people) {
    const employee = employees.find(e => e.id === id);
    const task = { id: randomUUID(), mission, round, background, about: undefined, employee: employee.id, role: employee.role, name: employee.name, provider: state.assignments[employee.id], workspace, prompt: pauta, attachments: [], chat: false, meeting: true, plan: true, asked, participants: people, depends: previous, status: 'queued', output: '', result: '', createdAt: new Date().toISOString() };
    state.tasks.push(task); created.push(task.id);
    /* Cada participante fala depois do anterior: é isso que faz a conversa ser conversa, e não dois monólogos. */
    previous = [task.id];
  }
  return created;
}
/* O funcionário pode terminar a etapa dizendo que precisa falar com alguém. A conversa entra na frente de
   quem ia continuar a partir daquela etapa, para ninguém seguir com a informação velha. */
function askedAlignment(task) {
  if (!task.plan || task.meeting || task.status !== 'done') return null;
  const match = /^\s*ALINHAR:\s*([a-z]+)\s*(?:[\u2014\u2013-]\s*)?(.*)$/im.exec(task.result || '');
  if (!match) return null;
  const mate = match[1].toLowerCase();
  if (mate === task.employee || !employees.some(e => e.id === mate)) return null;
  return { mate, reason: (match[2] || '').trim().slice(0, 300) };
}
function queueAskedAlignment(task) {
  const wanted = askedAlignment(task);
  if (!wanted || closing) return false;
  if (state.tasks.filter(t => t.mission === task.mission && t.asked).length >= ASKED_LIMIT) return false;
  if (!readyEmployee(task.employee) || !readyEmployee(wanted.mate)) return false;
  if (state.tasks.length + 2 > 200) return false;
  /* Quem esperava esta etapa é calculado antes de criar a conversa, senão a própria conversa entraria na lista. */
  const waiting = state.tasks.filter(t => t.status === 'queued' && (t.depends || []).includes(task.id));
  const created = meetingTasks({
    mission: task.mission, round: randomUUID(), people: [task.employee, wanted.mate],
    pauta: `Alinhamento pedido por ${task.name} ao terminar a etapa dele: ${wanted.reason || 'combinar como seguir a partir desta entrega.'}`,
    workspace: task.workspace, depends: [task.id], asked: true
  });
  for (const next of waiting) next.depends = [...(next.depends || []), ...created];
  return true;
}

/* Encerrar uma demanda para o trabalho na hora, mas a conversa de fechamento só pode entrar quando a fila
   esvaziar — senão ela disputaria a vez com a etapa que acabou de ser cancelada. */
function settleFinish() {
  if (!state.finishing.length || closing) return false;
  if (state.tasks.some(t => ['queued', 'running'].includes(t.status))) return false;
  return queueStandup(state.finishing.shift(), { force: true });
}

/* Enquanto alguém estiver com o escritório aberto, o saldo é reconferido sozinho. */
setInterval(() => { if (clients.size) void refreshUsage(true); }, 5 * 60 * 1000).unref();

function killGroup(child, signal) { try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} } }
function stopProcess(task, reason = 'cancelled') {
  const processInfo = running.get(task.id);
  if (!processInfo) return;
  task.status = reason;
  killGroup(processInfo.child, 'SIGTERM');
  processInfo.killTimer = setTimeout(() => killGroup(processInfo.child, 'SIGKILL'), 2500);
  processInfo.killTimer.unref();
}
/* Uma etapa depende de outra direta ou indiretamente? É o que decide quem fica esperando quando algo para. */
function dependsOn(task, id, seen = new Set()) {
  for (const dep of task.depends || []) {
    if (dep === id) return true;
    if (seen.has(dep)) continue;
    seen.add(dep);
    const previous = state.tasks.find(t => t.id === dep);
    if (previous && dependsOn(previous, id, seen)) return true;
  }
  return false;
}
function holdPipeline(task) {
  for (const next of state.tasks) {
    if (next.mission !== task.mission || next.status !== 'queued') continue;
    /* Em reunião cada um fala por si: o tropeço de um participante não pode calar a mesa inteira. */
    if (next.meeting && task.meeting) continue;
    /* No plano, quem não dependia desta etapa continua livre para trabalhar. */
    if (next.depends?.length && !dependsOn(next, task.id)) continue;
    next.status = 'blocked';
  }
}
async function pump() {
  if (closing || state.paused || running.size) return;
  /* Uma etapa só entra quando tudo de que ela depende terminou. Etapas sem dependência entre si ficam
     livres para rodar em qualquer ordem, mas ainda uma por vez: dois terminais na mesma pasta se atropelam. */
  /* Uma etapa entra quando tudo de que ela depende encerrou — concluído ou não. Quem não podia seguir sem
     aquele resultado já foi barrado, então esperar por "done" só criaria fila travada para sempre. */
  const settled = new Set(state.tasks.filter(t => !['queued', 'running'].includes(t.status)).map(t => t.id));
  const task = state.tasks.find(t => t.status === 'queued' && (t.depends || []).every(id => settled.has(id)));
  if (!task) return;
  const employee = employees.find(e => e.id === task.employee);
  if (!binaries[task.provider]) {
    task.status = 'failed'; task.output = 'Terminal não encontrado no PATH. Instale ou abra o escritório em um terminal onde ele esteja disponível.';
    holdPipeline(task); await changed(); return pump();
  }
  const previous = task.chat
    ? state.tasks.filter(t => t.chat && t.employee === task.employee && t.id !== task.id && t.status === 'done').slice(-8)
    : state.tasks.filter(t => (t.mission === task.mission || (task.about && t.mission === task.about)) && t.status === 'done');
  let extensions;
  try {
    const memoryMissions = [...new Set(state.tasks
      .filter(item => item.workspace === task.workspace && item.status === 'done' && item.mission !== task.mission)
      .map(item => item.mission).filter(Boolean))].reverse().slice(0, 3);
    const [skills, projectMemoryText] = await Promise.all([
      skillCatalog.prompt(task.skills),
      projectMemory.recent(task.workspace, memoryMissions)
    ]);
    extensions = { skills, projectMemory: projectMemoryText };
  } catch (error) {
    task.status = 'failed'; task.output = `Não foi possível preparar o contexto da missão: ${error.message}`;
    holdPipeline(task); await changed(); return pump();
  }
  const command = commandFor(task.provider, task.workspace, buildPrompt(task, employee, previous, state.briefing, extensions));
  const target = spawnTarget(binaries[task.provider], command.args);
  task.status = 'running'; task.startedAt = new Date().toISOString(); task.output = ''; task.result = '';
  const child = spawn(target.binary, target.args, { cwd: task.workspace, shell: false, detached: true, env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const entry = { child, failed: false, blocked: false, killTimer: null };
  running.set(task.id, entry);
  const buffers = { stdout: '', stderr: '' };
  let updateTimer;
  function processLine(line) {
    const parsed = decodeLine(line);
    if (parsed.failed) entry.failed = true;
    if (parsed.blocked) entry.blocked = true;
    /* O aviso de cota marca o terminal para o agendamento seguinte, mas não reprova o que o
       funcionário já entregou: quem foi cortado de verdade não termina com código 0. */
    if (parsed.exhausted) task.exhausted = true;
    const usage=eventUsage({usage:parsed.usage});
    if(usage&&usage.totalTokens>(task.usage?.totalTokens||0))task.usage=usage;
    /* Terminais que respondem em pedaços (IBM Bob) emendam o texto; os demais entregam linhas inteiras. */
    if (parsed.result) task.result = ((parsed.stream ? task.result || '' : '') + parsed.result).slice(-60000);
    if (parsed.text) task.output = (task.output + String(parsed.text) + (parsed.stream ? '' : '\n')).slice(-400000);
    if (!updateTimer) updateTimer = setTimeout(() => { updateTimer = null; broadcast(); }, 180);
  }
  for (const channel of ['stdout', 'stderr']) {
    child[channel].setEncoding('utf8');
    child[channel].on('data', chunk => {
      buffers[channel] += chunk;
      const lines = buffers[channel].split('\n'); buffers[channel] = lines.pop();
      for (const line of lines) if (line.trim()) processLine(line);
      if (buffers[channel].length > 100000) { processLine(buffers[channel]); buffers[channel] = ''; }
    });
  }
  child.stdin.on('error', () => {});
  child.stdin.end(command.input);
  const timeout = setTimeout(() => { stopProcess(task, 'timedout'); holdPipeline(task); changed().catch(console.error); }, 45 * 60 * 1000);
  timeout.unref();
  child.on('error', error => { entry.failed = true; task.output += `\nFalha ao iniciar: ${error.message}\n`; });
  child.on('close', async (code, signal) => {
    clearTimeout(timeout); clearTimeout(updateTimer); clearTimeout(entry.killTimer);
    for (const rest of Object.values(buffers)) if (rest.trim()) processLine(rest);
    clearTimeout(updateTimer);
    task.exitCode = code; task.signal = signal; task.endedAt = new Date().toISOString();
    if (task.status === 'running') {
      /* Uma ferramenta negada não apaga o que o funcionário entregou: se ele terminou e trouxe resposta, a
         etapa está concluída e a negativa vira aviso. Sem resposta, aí sim foi barrado de verdade. */
      const delivered = code === 0 && !entry.failed && !!String(task.result || task.output).trim();
      if ((entry.blocked || task.exhausted) && delivered) { task.status = 'done'; if (entry.blocked) task.denied = true; }
      else task.status = entry.blocked ? 'blocked' : (code === 0 && !entry.failed ? 'done' : 'failed');
    }
    if (task.status !== 'done') holdPipeline(task);
    running.delete(task.id);
    if (task.status === 'done') remember(task, task.standup ? 'conversa' : 'entrega');
    try { await projectMemory.recordMission(task.workspace, task.mission, state.tasks.filter(item => item.mission === task.mission)); }
    catch (error) { console.error(`Não foi possível atualizar a memória do projeto: ${error.message}`); }
    void refreshUsage(true);
    try { if (!queueAskedAlignment(task) && !settleFinish()) queueStandup(task.mission); await changed(); await pump(); } catch (error) { console.error(error); }
  });
  await changed();
}

function respond(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 30_000_000) throw new Error('Pedido muito grande. O limite total é 20 MB em arquivos.'); }
  return JSON.parse(text || '{}');
}
async function storeAttachments(items, mission) {
  if (items == null) return [];
  if (!Array.isArray(items) || items.length > 5) throw new Error('Envie no máximo 5 arquivos por mensagem.');
  let total = 0;
  const prepared = items.map((item, index) => {
    if (!item || typeof item.name !== 'string' || typeof item.data !== 'string') throw new Error('Anexo inválido.');
    if (item.data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error(`O arquivo ${item.name || index + 1} está corrompido.`);
    const content = Buffer.from(item.data, 'base64');
    if (content.length > 8 * 1024 * 1024) throw new Error(`O arquivo ${item.name} excede 8 MB.`);
    total += content.length;
    const clean = path.basename(item.name).replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 120) || `arquivo-${index + 1}`;
    const mime = typeof item.type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(item.type) ? item.type : 'application/octet-stream';
    return { content, name: clean, mime, filename: `${String(index + 1).padStart(2, '0')}-${clean}` };
  });
  if (total > 20 * 1024 * 1024) throw new Error('Os anexos excedem o limite total de 20 MB.');
  if (!prepared.length) return [];
  const dir = path.join(dataDir, 'uploads', mission);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stored = [];
  for (const file of prepared) {
    const target = path.join(dir, file.filename);
    await fs.writeFile(target, file.content, { mode: 0o600 });
    stored.push({ name: file.name, type: file.mime, size: file.content.length, path: target });
  }
  return stored;
}
async function directory(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Informe o caminho absoluto de uma pasta existente.');
  const resolved = await fs.realpath(value);
  if (!(await fs.stat(resolved)).isDirectory()) throw new Error('O caminho precisa ser uma pasta.');
  if (resolved === path.parse(resolved).root) throw new Error('Escolha a pasta de um projeto.');
  return resolved;
}
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  if (!hosts.has(req.headers.host)) return respond(res, 403, { error: 'Host não permitido.' });
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return respond(res, 403, { error: 'Origem não permitida.' });
  const spotifyCallback = req.method === 'GET' && req.url.split('?')[0] === '/spotify/callback';
  // OAuth redirects retain cross-site provenance until the document loads.
  // Allow only the app's top-level document; APIs and embedded requests stay protected.
  const officeNavigation = req.method === 'GET' && req.url.split('?')[0] === '/'
    && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
  if (!spotifyCallback && !officeNavigation && req.headers['sec-fetch-site'] === 'cross-site') return respond(res, 403, { error: 'Acesso externo não permitido.' });
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (spotifyCallback) {
      const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('office_spotify='))?.slice('office_spotify='.length);
      let status='connected';
      try { await spotify.callback(url.searchParams,cookie); } catch { status='error'; }
      res.writeHead(303, {'Location':`/?spotify=${status}`, 'Cache-Control':'no-store', 'Set-Cookie':'office_spotify=; HttpOnly; SameSite=Lax; Path=/spotify; Max-Age=0'});
      return res.end();
    }
    if (url.pathname === '/api/bootstrap' && req.method === 'GET') return respond(res, 200, { token, ...publicState() });
    if (url.pathname.startsWith('/api/')) {
      if (req.headers['x-office-token'] !== token) return respond(res, 403, { error: 'Reabra o escritório para atualizar a sessão.' });
      if (url.pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(res); res.write(`data: ${JSON.stringify(publicState())}\n\n`); void refreshUsage();
        const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15000);
        req.on('close', () => { clearInterval(heartbeat); clients.delete(res); }); return;
      }
      if (req.method !== 'POST') return respond(res, 405, { error: 'Método não permitido.' });
      const data = await body(req);
      if(url.pathname==='/api/usage'){
        /* Abrir as configurações vale uma leitura nova: é o /usage do Claude e os limites do Codex do momento. */
        const providers=await readUsage(true);
        broadcast();
        const agents=employees.map(employee=>({id:employee.id,consumedTokens:state.tasks.filter(task=>task.employee===employee.id).reduce((sum,task)=>sum+(task.usage?.totalTokens||0),0)}));
        return respond(res,200,{providers,limits:usageLimits,agents,updatedAt:new Date(usageCache?.at||Date.now()).toISOString()});
      }
      if(url.pathname==='/api/dependencies'){
        await refreshBinaries();
        broadcast();
        return respond(res,200,dependencyReport);
      }
      if(url.pathname==='/api/mcps/save'){
        await mcpRegistry.upsert(data.server);
        broadcast();
        return respond(res,200,{mcps:mcpRegistry.publicState()});
      }
      if(url.pathname==='/api/mcps/import'){
        const servers=await mcpRegistry.import(data.json,data.targets);
        broadcast();
        return respond(res,200,{imported:servers.map(server=>server.name),mcps:mcpRegistry.publicState()});
      }
      if(url.pathname==='/api/mcps/apply'){
        const results=await mcpRegistry.apply(data.name,binaries,state.workspace||root);
        broadcast();
        return respond(res,200,{results,mcps:mcpRegistry.publicState()});
      }
      if(url.pathname==='/api/mcps/remove'){
        await mcpRegistry.remove(data.name);
        broadcast();
        return respond(res,200,{mcps:mcpRegistry.publicState()});
      }
      /* Sair da mesa sem plano: a conversa fica no histórico, e todo mundo volta para a mesa de trabalho. */
      if (url.pathname === '/api/meeting/close') {
        const round = state.tasks.filter(t => t.meeting && (t.round || t.mission) === data.round);
        if (!round.length) throw new Error('Reunião não encontrada.');
        if (round.some(t => ['queued', 'running'].includes(t.status))) throw new Error('Alguém ainda está falando. Aguarde a rodada terminar ou encerre a demanda.');
        for (const task of round) task.closed = true;
        await changed();
        return respond(res, 200, publicState());
      }
      /* Encerrar a reunião não encerra a demanda: o gerente transforma o que foi combinado em um plano,
         que volta para você conferir antes de virar fila. */
      if (url.pathname === '/api/plan') {
        if (planning) throw new Error('Já estou montando um plano. Aguarde essa consulta terminar.');
        /* O alinhamento pode ter acontecido na mesa de reunião ou na conversa direta com um funcionário:
           os dois viram plano do mesmo jeito, mudando só de onde sai a transcrição. */
        const fromChat = !data.mission && typeof data.employee === 'string';
        const source = fromChat
          ? state.tasks.filter(t => t.chat && t.employee === data.employee).slice(-12)
          : state.tasks.filter(t => t.mission === data.mission);
        if (!source.length) throw new Error(fromChat ? 'Essa conversa ainda não existe.' : 'Reunião não encontrada.');
        if (source.some(t => ['queued', 'running'].includes(t.status))) throw new Error('Aguarde a resposta terminar para montar o plano.');
        const turns = source.filter(t => t.status === 'done' && (t.result || t.output));
        if (!turns.length) throw new Error('Não há nenhuma resposta aqui para virar plano.');
        const manager = employees.find(e => e.id === 'manager');
        const provider = state.assignments[manager.id];
        if (!binaries[provider]) throw new Error(`O terminal do ${manager.name} não está disponível.`);
        if (provider === 'bob' && !process.env.BOB_API_KEY) throw new Error('IBM Bob precisa de BOB_API_KEY para montar o plano.');
        if (providerOutOfQuota(provider)) throw new Error(`O terminal do ${manager.name} está sem saldo. Troque o terminal dele nas configurações e tente de novo.`);
        const transcript = turns.map(t => `${fromChat ? `### Você pediu\n${t.prompt}\n\n` : ''}### ${t.name} (${t.role})\n${String(t.result || t.output).slice(0, 4000)}`).join('\n\n');
        const demand = turns.at(-1).prompt;
        planning = true;
        try {
          const plan = await buildPlan({ manager, provider, binary: binaries[provider], demand, transcript });
          /* A conversa vai junto: sem ela, quem executa começaria sem saber o que já foi decidido. */
          const skills = [...new Set(source.flatMap(task => Array.isArray(task.skills) ? task.skills : []))];
          return respond(res, 200, { mission: data.mission || null, employee: fromChat ? data.employee : null, background: transcript.slice(-12000), skills, plan });
        } finally { planning = false; }
      }
      if (url.pathname === '/api/plan/confirm') {
        const origin = data.mission ? state.tasks.filter(t => t.mission === data.mission) : [];
        if (data.mission && !origin.length) throw new Error('Reunião não encontrada.');
        if (state.tasks.some(t => ['queued', 'running'].includes(t.status))) throw new Error('Aguarde a fila esvaziar para distribuir o plano.');
        /* Reunião distribui dentro da própria demanda; conversa abre uma demanda nova carregando o combinado. */
        const target = data.mission || randomUUID();
        const background = typeof data.background === 'string' ? data.background.slice(0, 12000) : '';
        const selectedSkills = (await skillCatalog.select(data.skills)).map(skill => skill.id);
        const plan = parsePlan(data.plan);
        const workspace = await directory(state.workspace);
        const people = [...new Set([...plan.etapas.map(step => step.employee), ...plan.alinhamentos.flatMap(item => item.participantes)])];
        const missing = people.filter(id => !binaries[state.assignments[id]]);
        if (missing.length) throw new Error(`Terminal não encontrado para: ${missing.map(id => employees.find(e => e.id === id).name).join(', ')}.`);
        if (people.some(id => state.assignments[id] === 'bob') && !process.env.BOB_API_KEY) throw new Error('IBM Bob precisa de BOB_API_KEY no ambiente do servidor.');
        const size = plan.etapas.length + plan.alinhamentos.reduce((total, item) => total + item.participantes.length, 0);
        if (state.tasks.length + size > 200) throw new Error('Limite de 200 etapas atingido. Arquive missões concluídas antes de distribuir.');
        /* Na ordem topológica: quando uma etapa é criada, tudo de que ela depende já virou tarefa. */
        for (const task of state.tasks) if (task.meeting && task.mission === data.mission && !task.plan) task.closed = true;
        const created = new Map();
        for (const id of plan.ordem) {
          const step = plan.etapas.find(item => item.id === id);
          const alignment = plan.alinhamentos.find(item => item.id === id);
          const depends = (step || alignment).depende.flatMap(dep => created.get(dep) || []);
          if (step) {
            const employee = employees.find(e => e.id === step.employee);
            const task = { id: randomUUID(), mission: target, background, employee: employee.id, role: employee.role, name: employee.name, provider: state.assignments[employee.id], workspace, prompt: step.tarefa, skills: selectedSkills, attachments: [], chat: false, meeting: false, plan: true, planItem: id, depends, status: 'queued', output: '', result: '', createdAt: new Date().toISOString() };
            state.tasks.push(task); created.set(id, [task.id]);
          } else {
            const ids = meetingTasks({ mission: target, background, round: randomUUID(), people: alignment.participantes, pauta: alignment.pauta, workspace, depends, asked: false });
            for (const taskId of ids) state.tasks.find(task => task.id === taskId).skills = selectedSkills;
            created.set(id, ids);
          }
        }
        await changed(); void pump().catch(console.error);
        return respond(res, 200, publicState());
      }
      if (url.pathname.startsWith('/api/spotify/')) {
        const action=url.pathname.slice('/api/spotify/'.length);
        if(action==='connect') {
          if(req.headers.host!==`127.0.0.1:${port}`)throw new Error(`Abra http://127.0.0.1:${port} para conectar o Spotify.`);
          const auth=spotify.startAuth(data.clientId);
          res.setHeader('Set-Cookie',`office_spotify=${auth.cookie}; HttpOnly; SameSite=Lax; Path=/spotify; Max-Age=600`);
          return respond(res,200,{url:auth.url});
        }
        if(action==='status')return respond(res,200,{...await spotify.status(),choice:musicChoice,djBusy:!!djAbort});
        if(action==='devices')return respond(res,200,{devices:await spotify.devices()});
        if(action==='playlists')return respond(res,200,{playlists:await spotify.playlists()});
        if(action==='search')return respond(res,200,{tracks:await spotify.search(data.query)});
        if(action==='control') {
          musicRevision++;djAbort?.abort();musicChoice=null;
          return respond(res,200,await spotify.control(data.action,data));
        }
        if(action==='disconnect') {
          musicRevision++;djAbort?.abort();await spotify.disconnect();musicChoice=null;
          return respond(res,200,{...spotify.info(),playing:false,track:null,device:null});
        }
        if(action==='dj') {
          if(!spotify.info().connected)throw new Error('Conecte o Spotify antes de convidar um funcionário.');
          if(djAbort)throw new Error('Um funcionário já está escolhendo. Aguarde ou troque a música manualmente.');
          const employee=employees.find(e=>e.id===data.employee);
          if(!employee)throw new Error('Escolha o funcionário DJ.');
          const provider=state.assignments[employee.id];
          if(!binaries[provider])throw new Error('O terminal desse funcionário não está disponível.');
          if(provider==='bob'&&!process.env.BOB_API_KEY)throw new Error('Configure o terminal IBM Bob antes de escolher esse DJ.');
          if(providerOutOfQuota(provider))throw new Error('Esse terminal está sem limite de uso. Escolha outro funcionário.');
          const revision=musicRevision;const controller=new AbortController();djAbort=controller;
          try {
            const picked=await chooseMusic({employee,provider,binary:binaries[provider],mood:data.mood||'',signal:controller.signal});
            if(revision!==musicRevision)throw new Error('Escolha cancelada: você assumiu o controle do rádio.');
            const tracks=await spotify.search(`track:${picked.song} artist:${picked.artist}`.slice(0,200));
            const track=tracks[0];if(!track)throw new Error(`${employee.name} sugeriu ${picked.song}, mas a faixa não foi encontrada no Spotify. Tente outra escolha.`);
            if(revision!==musicRevision)throw new Error('Escolha cancelada: você assumiu o controle do rádio.');
            await spotify.control('play',{uri:track.uri,deviceId:data.deviceId});
            if(revision!==musicRevision)throw new Error('Escolha cancelada: você assumiu o controle do rádio.');
            musicChoice={employee:employee.name,reason:picked.reason,trackUri:track.uri};
            return respond(res,200,{ok:true,choice:musicChoice,track});
          } finally {if(djAbort===controller)djAbort=null;}
        }
        return respond(res,404,{error:'Ação Spotify não encontrada.'});
      }
      if (url.pathname === '/api/config') {
        if (running.size || state.tasks.some(t => t.status === 'queued')) throw new Error('Aguarde ou encerre a missão antes de alterar a equipe.');
        const workspace = await directory(data.workspace);
        const assignments = {};
        for (const e of employees) { const p = data.assignments?.[e.id]; if (!['claude', 'codex', 'bob'].includes(p)) throw new Error('Terminal inválido.'); assignments[e.id] = p; }
        state.workspace = workspace; state.assignments = assignments; state.standup = data.standup !== false; await refreshBinaries(); await changed();
      } else if (url.pathname === '/api/missions') {
        if (typeof data.prompt !== 'string' || data.prompt.trim().length < 5 || data.prompt.length > 20000) throw new Error('Descreva a tarefa em 5 a 20.000 caracteres.');
        const workspace = await directory(state.workspace);
        const selectedSkills = (await skillCatalog.select(data.skills)).map(skill => skill.id);
        const meetingIds = Array.isArray(data.participants) ? [...new Set(data.participants)] : null;
        if (meetingIds && (meetingIds.length < 2 || meetingIds.length > 6)) throw new Error('Escolha de 2 a 6 participantes para a reunião.');
        const selected = meetingIds ? meetingIds.map(id => employees.find(e => e.id === id)).filter(Boolean) : data.employee === 'team' ? employees : employees.filter(e => e.id === data.employee);
        if (meetingIds && selected.length !== meetingIds.length) throw new Error('A reunião contém um funcionário inválido.');
        if (!selected.length) throw new Error('Funcionário inválido.');
        if (state.tasks.length + selected.length > 200) throw new Error('Limite de 200 etapas atingido. Exporte o histórico e arquive missões concluídas.');
        const missing = selected.filter(e => !binaries[state.assignments[e.id]]);
        if (missing.length) throw new Error(`Terminal não encontrado para: ${missing.map(e => e.name).join(', ')}.`);
        if (selected.some(e => state.assignments[e.id] === 'bob') && !process.env.BOB_API_KEY) throw new Error('IBM Bob precisa de BOB_API_KEY no ambiente do servidor. Configure a chave no seu terminal e reinicie o escritório, ou escolha Claude/Codex para esses funcionários.');
        const mission = randomUUID();
        const round = randomUUID();
        const attachments = await storeAttachments(data.attachments, mission);
        for (const e of selected) state.tasks.push({ id: randomUUID(), mission, employee: e.id, role: e.role, name: e.name, provider: state.assignments[e.id], workspace, prompt: data.prompt.trim(), skills: selectedSkills, attachments, chat: !meetingIds && data.employee !== 'team', meeting: !!meetingIds, round: meetingIds ? round : undefined, participants: meetingIds || undefined, status: 'queued', output: '', result: '', createdAt: new Date().toISOString() });
        await changed(); void pump().catch(console.error);
      } else if (url.pathname === '/api/pause') {
        state.paused = !!data.paused; await changed(); void pump().catch(console.error);
      } else if (url.pathname === '/api/cancel') {
        const task = state.tasks.find(t => t.id === data.id); if (!task) throw new Error('Tarefa não encontrada.');
        for (const t of state.tasks.filter(t => t.mission === task.mission)) {
          if (t.status === 'running') stopProcess(t);
          else if (['queued', 'blocked'].includes(t.status)) t.status = 'cancelled';
        }
        await changed();
      } else if (url.pathname === '/api/retry') {
        if (running.size || state.tasks.some(t => t.status === 'queued')) throw new Error('Aguarde ou encerre a missão atual para retomar.');
        const task = state.tasks.find(t => t.id === data.id);
        if (!task || !['failed', 'blocked', 'interrupted', 'cancelled', 'timedout'].includes(task.status)) throw new Error('Esta etapa não pode ser retomada.');
        if (state.finished.includes(task.mission)) throw new Error('Esta demanda foi encerrada. Abra uma nova missão para retomar o assunto.');
        let reached = false;
        for (const t of state.tasks.filter(t => t.mission === task.mission)) { if (t.id === task.id) reached = true; if (reached && t.status !== 'done') { t.status = 'queued'; t.output = ''; t.result = ''; } }
        state.paused = false; await changed(); void pump().catch(console.error);
      } else if (url.pathname === '/api/task/cancel') {
        /* Cancela UMA etapa. O /api/cancel encerra a missão inteira; no mural você mexe em um cartão. */
        const task = state.tasks.find(t => t.id === data.id);
        if (!task) throw new Error('Tarefa não encontrada.');
        /* Dá para encerrar também o que parou com falha: é você dizendo que não vai retomar aquilo.
           A evidência não some — saída, código de saída e log seguem nos detalhes da etapa. */
        if (!['running', 'queued', 'blocked', 'failed', 'interrupted', 'timedout'].includes(task.status)) throw new Error('Essa etapa já está cancelada ou concluída.');
        if (task.status === 'running') stopProcess(task);
        else task.status = 'cancelled';
        /* Cancelar um cartão não derruba a missão inteira, como faz a falha de uma etapa: só quem
           dependia dela para de esperar por um resultado que não vem mais. */
        for (const next of state.tasks) {
          if (next.status === 'queued' && next.depends?.length && dependsOn(next, task.id)) next.status = 'blocked';
        }
        await changed(); void pump().catch(console.error);
      } else if (url.pathname === '/api/task/retry') {
        /* Devolve UMA etapa para a fila, sem arrastar as seguintes junto como faz o /api/retry. */
        const task = state.tasks.find(t => t.id === data.id);
        if (!task) throw new Error('Tarefa não encontrada.');
        if (!['failed', 'blocked', 'interrupted', 'cancelled', 'timedout'].includes(task.status)) throw new Error('Essa etapa não pode voltar para a fila.');
        if (state.finished.includes(task.mission)) throw new Error('Esta demanda foi encerrada. Abra uma nova missão para retomar o assunto.');
        if (!binaries[task.provider]) throw new Error('O terminal desse funcionário não está disponível.');
        task.status = 'queued'; task.output = ''; task.result = '';
        delete task.exitCode; delete task.signal; delete task.endedAt; delete task.startedAt; delete task.denied;
        await changed(); void pump().catch(console.error);
      } else if (url.pathname === '/api/task/move') {
        /* Reordena a fila. Só as posições ocupadas por etapas na fila são reescritas: o resto do
           histórico fica exatamente onde está, senão a ordem das conversas embaralharia junto. */
        const task = state.tasks.find(t => t.id === data.id);
        if (!task || task.status !== 'queued') throw new Error('Só dá para reordenar etapas que estão na fila.');
        const posicoes = state.tasks.map((t, i) => (t.status === 'queued' ? i : -1)).filter(i => i >= 0);
        const fila = posicoes.map(i => state.tasks[i]);
        const de = fila.indexOf(task);
        fila.splice(de, 1);
        const alvo = data.beforeId ? fila.findIndex(t => t.id === data.beforeId) : -1;
        fila.splice(alvo >= 0 ? alvo : fila.length, 0, task);
        posicoes.forEach((posicao, ordem) => { state.tasks[posicao] = fila[ordem]; });
        await changed(); void pump().catch(console.error);
      } else if (url.pathname === '/api/finish') {
        const tasks = state.tasks.filter(t => t.mission === data.mission);
        if (!tasks.length) throw new Error('Demanda não encontrada.');
        if (state.finished.includes(data.mission)) throw new Error('Essa demanda já está encerrada.');
        for (const task of tasks) {
          if (task.status === 'running') stopProcess(task);
          else if (['queued', 'blocked'].includes(task.status)) task.status = 'cancelled';
        }
        /* A demanda já conta como encerrada agora; a conversa de fechamento entra assim que a fila abrir. */
        state.finished = [...state.finished, tasks[0].mission];
        state.finishing = [...state.finishing, tasks[0].mission];
        settleFinish();
        await changed(); void pump().catch(console.error);
        return respond(res, 200, publicState());
      } else if (url.pathname === '/api/delete') {
        const tasks = state.tasks.filter(t => t.mission === data.mission);
        if (!tasks.length) throw new Error('Demanda não encontrada.');
        if (tasks.some(t => ['running', 'queued'].includes(t.status))) throw new Error('Encerre a demanda antes de apagar.');
        const mission = tasks[0].mission;
        state.tasks = state.tasks.filter(t => t.mission !== mission);
        state.finished = state.finished.filter(id => id !== mission);
        state.finishing = state.finishing.filter(id => id !== mission);
        /* Apagar é sem rastro: sai do histórico, sai do mural e leva os anexos junto. */
        state.briefing = state.briefing.filter(entry => entry.mission !== mission);
        await fs.rm(path.join(dataDir, 'uploads', mission), { recursive: true, force: true });
        await projectMemory.removeMission(tasks[0].workspace, mission);
        await changed();
      } else if (url.pathname === '/api/archive') {
        const tasks = state.tasks.filter(t => t.mission === data.mission);
        if (!tasks.length) throw new Error('Demanda não encontrada.');
        if (tasks.some(t => ['running', 'queued'].includes(t.status))) throw new Error('Encerre a demanda antes de arquivá-la.');
        await fs.mkdir(path.join(dataDir, 'archive'), { recursive: true });
        await fs.writeFile(path.join(dataDir, 'archive', `${tasks[0].mission}.json`), JSON.stringify(tasks, null, 2), { mode: 0o600 });
        state.tasks = state.tasks.filter(t => t.mission !== tasks[0].mission);
        state.finished = state.finished.filter(id => id !== tasks[0].mission);
        state.finishing = state.finishing.filter(id => id !== tasks[0].mission);
        await changed();
      } else return respond(res, 404, { error: 'Rota não encontrada.' });
      return respond(res, 200, publicState());
    }
    if (!['GET', 'HEAD'].includes(req.method)) return respond(res, 405, { error: 'Método não permitido.' });
    const routes = {
      '/': 'index.html', '/app.js': 'app.js', '/office3d.js': 'office3d.js',
      '/office-motion.js': 'office-motion.js',
      '/spotify-radio.js': 'spotify-radio.js',
      '/assets/blender/employee.glb': path.join('assets', 'blender', 'employee.glb'),
      '/assets/blender/mural.glb': path.join('assets', 'blender', 'mural.glb'),
      '/vendor/three.module.min.js': path.join('vendor', 'three.module.min.js'),
      '/vendor/three.core.min.js': path.join('vendor', 'three.core.min.js'),
      '/vendor/GLTFLoader.js': path.join('vendor', 'GLTFLoader.js'),
      '/vendor/utils/BufferGeometryUtils.js': path.join('vendor', 'utils', 'BufferGeometryUtils.js'),
      '/styles.css': 'styles.css', '/office.png': 'office.png', '/favicon.svg': 'favicon.svg',
      '/assets/kenney/LICENSE.txt': path.join('assets', 'kenney', 'LICENSE.txt'),
      ...Object.fromEntries(['a','b','c','d','e','f'].flatMap(letter => [
        [`/assets/kenney/character-${letter}.glb`, path.join('assets', 'kenney', `character-${letter}.glb`)],
        [`/assets/kenney/Textures/texture-${letter}.png`, path.join('assets', 'kenney', 'Textures', `texture-${letter}.png`)]
      ]))
    };
    const filename = routes[url.pathname]; if (!filename) return respond(res, 404, { error: 'Página não encontrada.' });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.txt': 'text/plain; charset=utf-8' };
    const content = await fs.readFile(path.join(root, 'dist', filename));
    res.writeHead(200, { 'Content-Type': types[path.extname(filename)], 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) { respond(res, 400, { error: error.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`Dev Office pronto em http://127.0.0.1:${port}`));
async function shutdown() {
  if (closing) return; closing = true;
  djAbort?.abort();
  for (const task of state.tasks.filter(t => t.status === 'running')) stopProcess(task, 'interrupted');
  for (const task of state.tasks.filter(t => t.status === 'queued')) task.status = 'interrupted';
  await save(); await projectMemory?.stop(); for (const client of clients) client.end(); server.close();
  setTimeout(() => { for (const { child } of running.values()) killGroup(child, 'SIGKILL'); process.exit(0); }, 3000);
}
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
