import { spawn } from 'node:child_process';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 6000;

export function platformInstructions(platform) {
  const windows = platform === 'win32';
  const mac = platform === 'darwin';
  return {
    node: windows ? 'winget install OpenJS.NodeJS.LTS' : mac ? 'brew install node' : 'sudo apt install nodejs npm',
    git: windows ? 'winget install Git.Git' : mac ? 'brew install git' : 'sudo apt install git',
    claude: 'npm install -g @anthropic-ai/claude-code',
    codex: 'npm install -g @openai/codex',
    gh: windows ? 'winget install GitHub.cli' : mac ? 'brew install gh' : 'sudo apt install gh',
    'ai-usagebar': windows
      ? 'scoop bucket add akitaonrails https://github.com/akitaonrails/scoop-bucket\nscoop install ai-usagebar'
      : 'cargo binstall ai-usagebar',
    'ai-memory': windows
      ? 'Baixe ai-memory-windows-x86_64.zip em https://github.com/akitaonrails/ai-memory/releases/latest'
      : 'mise use -g github:akitaonrails/ai-memory',
    'ai-jail': windows ? 'wsl --install' : mac ? 'brew tap akitaonrails/tap && brew install ai-jail' : 'cargo install --locked ai-jail'
  };
}

const definitions = [
  { id: 'node', name: 'Node.js', required: true, description: 'Runtime do servidor local.', url: 'https://nodejs.org/' },
  { id: 'git', name: 'Git', required: false, description: 'Histórico, branches e preparação para o GitHub.', url: 'https://git-scm.com/downloads' },
  { id: 'claude', name: 'Claude Code', required: false, auth: true, description: 'Terminal de IA da Anthropic.', url: 'https://code.claude.com/docs/en/getting-started' },
  { id: 'codex', name: 'Codex CLI', required: false, auth: true, description: 'Terminal de IA da OpenAI.', url: 'https://developers.openai.com/codex/cli/' },
  { id: 'gh', name: 'GitHub CLI', required: false, auth: true, description: 'Issues, pull requests, reviews e CI.', url: 'https://cli.github.com/' },
  { id: 'ai-usagebar', name: 'ai-usagebar', required: false, description: 'Cotas e horários de renovação de provedores.', url: 'https://github.com/akitaonrails/ai-usagebar' },
  { id: 'ai-memory', name: 'ai-memory', required: false, description: 'Memória externa avançada e handoff entre agentes.', url: 'https://github.com/akitaonrails/ai-memory' },
  { id: 'ai-jail', name: 'ai-jail', required: false, description: 'Sandbox opcional envolvendo todo o processo do agente.', url: 'https://github.com/akitaonrails/ai-jail' }
];

export async function findExecutable(name, { env = process.env, platform = process.platform } = {}) {
  const extensions = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of String(env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      try { await fs.access(candidate, constants.X_OK); return candidate; } catch {}
    }
  }
  return null;
}

function commandForProbe(id) {
  if (id === 'claude') return ['auth', 'status'];
  if (id === 'codex') return ['--no-daemon', 'login', 'status'];
  if (id === 'gh') return ['auth', 'status'];
  return ['--version'];
}

export function runProbe(binary, args, { platform = process.platform, spawnImpl = spawn } = {}) {
  return new Promise(resolve => {
    if (!binary) return resolve({ ok: false, text: '' });
    /* Scripts .cmd/.bat são detectados, mas não executados pelo servidor. Os CLIs principais têm binário
       nativo; para wrappers, a tela informa apenas que estão instalados. */
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(binary)) return resolve({ ok: true, text: '' });
    let child;
    try { child = spawnImpl(binary, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } }); }
    catch { resolve({ ok: false, text: '' }); return; }
    let output = '', settled = false;
    const finish = (ok) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ ok, text: output.replace(/\x1b\[[0-9;]*m/g, '').trim().slice(0, 3000) }); };
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8'); stream.on('data', chunk => { output = (output + chunk).slice(-6000); });
    }
    child.on('error', () => finish(false));
    child.on('close', code => finish(code === 0));
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} finish(false); }, TIMEOUT_MS);
    timer.unref();
  });
}

function authenticated(id, probe) {
  if (!probe.ok) return false;
  const text = probe.text.toLowerCase();
  if (id === 'claude') return !/"loggedin"\s*:\s*false|not logged|não autentic/.test(text);
  if (id === 'codex') return !/not logged|not authenticated|não autentic/.test(text);
  if (id === 'gh') return !/not logged|not authenticated|no hosts|não autentic/.test(text);
  return true;
}

function versionFrom(text) {
  return String(text || '').split(/\r?\n/).find(Boolean)?.slice(0, 120) || '';
}

export async function inspectDependencies({
  platform = process.platform,
  arch = process.arch,
  knownBinaries = {},
  locate = findExecutable,
  probe = runProbe
} = {}) {
  const commands = platformInstructions(platform);
  const items = await Promise.all(definitions.map(async definition => {
    if (definition.id === 'ai-jail' && platform === 'win32') {
      const wsl = knownBinaries.wsl || await locate('wsl', { platform });
      const wslProbe = wsl ? await probe(wsl, ['--status'], { platform }) : { ok: false, text: '' };
      const jailProbe = wslProbe.ok
        ? await probe(wsl, ['--', 'sh', '-lc', 'command -v ai-jail >/dev/null 2>&1 && ai-jail --version'], { platform })
        : { ok: false, text: '' };
      const installed = jailProbe.ok;
      const note = installed
        ? 'Disponível dentro do WSL2; os agentes protegidos devem ser executados nesse ambiente.'
        : wslProbe.ok
          ? 'WSL2 disponível. Instale também bubblewrap e ai-jail dentro da distribuição Linux.'
          : 'Requer WSL2 no Windows. Abra um terminal como Administrador e execute o comando exibido.';
      const actionCommand = installed
        ? ''
        : wslProbe.ok
          ? 'wsl -- sh -lc "sudo apt update && sudo apt install -y bubblewrap cargo && cargo install --locked ai-jail"'
          : commands[definition.id];
      return {
        ...definition,
        installed,
        authenticated: null,
        status: installed ? 'ready' : 'missing',
        version: installed ? versionFrom(jailProbe.text) : '',
        path: installed ? `${wsl}: ai-jail` : wsl || '',
        actionCommand,
        note
      };
    }
    let binary = definition.id === 'node' ? process.execPath : knownBinaries[definition.id] || await locate(definition.id, { platform });
    const empty = { ok: false, text: '' };
    const [versionProbe, authProbe] = binary
      ? await Promise.all([
          probe(binary, ['--version'], { platform }),
          definition.auth ? probe(binary, commandForProbe(definition.id), { platform }) : Promise.resolve(empty)
        ])
      : [empty, empty];
    const installed = !!binary;
    const isAuthenticated = definition.auth && installed ? authenticated(definition.id, authProbe) : null;
    const status = !installed ? 'missing' : definition.auth && !isAuthenticated ? 'auth_required' : 'ready';
    const actionCommand = status === 'auth_required'
      ? definition.id === 'claude' ? 'claude' : definition.id === 'codex' ? 'codex login' : 'gh auth login'
      : status === 'missing' ? commands[definition.id] : '';
    const note = status === 'auth_required' ? 'Instalado, mas a autenticação precisa ser concluída.'
      : status === 'missing' ? (definition.required ? 'Obrigatório para o Office.' : 'Integração opcional ainda não instalada.')
      : 'Disponível neste computador.';
    return { ...definition, installed, authenticated: isAuthenticated, status, version: versionFrom(versionProbe.text), path: binary || '', actionCommand, note };
  }));
  return { platform, arch, checkedAt: new Date().toISOString(), items };
}

export { definitions };
