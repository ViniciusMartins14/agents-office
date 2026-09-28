import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';

const DEFAULT_ENDPOINT = 'http://127.0.0.1:49375';
const MAX_RESULT = 3500;

function compact(value, limit = MAX_RESULT) {
  const text = String(value ?? '').replace(/\r/g, '').trim();
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text;
}

function safeSegment(value) {
  const text = String(value ?? '');
  return /^[a-zA-Z0-9_-]{1,100}$/.test(text)
    ? text
    : createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function scopeFor(workspace) {
  const resolved = path.resolve(workspace);
  const label = path.basename(resolved).replace(/[^\p{L}\p{N}._-]/gu, '-').slice(0, 40) || 'project';
  const key = createHash('sha256').update(resolved).digest('hex').slice(0, 12);
  return { workspace: 'office', project: `${label}-${key}` };
}

export function runAiMemory(binary, args, { input = '', env = process.env, timeoutMs = 15000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnImpl(binary, args, { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env }); }
    catch (error) { return reject(error); }
    let stdout = '', stderr = '', settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch {}
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('O ai-memory demorou para responder.')), timeoutMs);
    timer.unref();
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
    child.on('error', error => finish(error));
    child.on('close', code => code === 0
      ? finish(null, stdout.trim())
      : finish(new Error(stderr.trim() || stdout.trim() || `ai-memory encerrou com código ${code}.`)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

export class AiMemory {
  constructor({ binary, dataDirectory, endpoint = DEFAULT_ENDPOINT, execute = runAiMemory, spawnImpl = spawn } = {}) {
    this.binary = binary;
    this.dataDirectory = dataDirectory;
    this.endpoint = endpoint;
    this.execute = execute;
    this.spawnImpl = spawnImpl;
    this.process = null;
    this.ready = false;
  }

  environment() {
    return { ...process.env, AI_MEMORY_SERVER_URL: this.endpoint, AI_MEMORY_EMBEDDING_PROVIDER: 'none', NO_COLOR: '1' };
  }

  async command(args, options = {}) {
    if (!this.binary) throw new Error('ai-memory não está instalado.');
    return this.execute(this.binary, [...args, '--data-dir', this.dataDirectory], { ...options, env: this.environment() });
  }

  async start() {
    if (!this.binary) return false;
    await this.command(['init']);
    const bind = new URL(this.endpoint).host;
    this.process = this.spawnImpl(this.binary, ['serve', '--data-dir', this.dataDirectory, '--transport', 'http', '--bind', bind, '--workspace', 'office', '--project', 'scratch'], {
      shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: this.environment()
    });
    let startupError = '';
    this.process.stderr.setEncoding('utf8');
    this.process.stderr.on('data', chunk => { startupError = (startupError + chunk).slice(-8000); });
    this.process.on('error', error => { startupError = error.message; this.ready = false; });
    this.process.on('close', () => { this.ready = false; });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (this.process.exitCode != null) throw new Error(startupError.trim() || 'O servidor ai-memory encerrou durante a inicialização.');
      try { await this.command(['status', '--json'], { timeoutMs: 1000 }); this.ready = true; return true; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    await this.stop();
    throw new Error('O servidor ai-memory não ficou pronto a tempo.');
  }

  async stop() {
    this.ready = false;
    if (!this.process || this.process.exitCode != null) return;
    try { this.process.kill('SIGTERM'); } catch {}
    await Promise.race([
      new Promise(resolve => this.process.once('close', resolve)),
      new Promise(resolve => setTimeout(resolve, 1500))
    ]);
  }

  async recordMission(workspace, mission, tasks) {
    if (!this.ready || !workspace || !mission || !Array.isArray(tasks) || !tasks.length) return;
    const scope = scopeFor(workspace);
    const updatedAt = tasks.map(task => task.endedAt || task.createdAt).filter(Boolean).sort().at(-1) || new Date().toISOString();
    const sections = tasks.map(task => {
      const answer = compact(task.result || task.output) || '(sem resultado registrado)';
      return `## ${task.name} — ${task.role}\n\n- Status: ${task.status}\n- Terminal: ${task.provider}\n- Atualização: ${task.endedAt || task.createdAt || updatedAt}\n\n### Resultado\n\n${answer}`;
    });
    const body = `# Sessão ${mission}\n\n- Projeto: ${path.basename(workspace)}\n- Pasta: ${workspace}\n- Atualização: ${updatedAt}\n\n${sections.join('\n\n---\n\n')}\n`;
    await this.command(['write-page', '--workspace', scope.workspace, '--project', scope.project, '--path', `sessions/${safeSegment(mission)}.md`, '--body', '-', '--kind', 'decision', '--tier', 'episodic', '--tag', 'office-mission'], { input: body });
  }

  async recent(workspace, missions = []) {
    if (!this.ready || !workspace) return '';
    const scope = scopeFor(workspace);
    const unique = [...new Set(missions.filter(Boolean))].slice(0, 3);
    const pages = await Promise.all(unique.map(async mission => {
      try {
        const output = await this.command(['read-page', '--workspace', scope.workspace, '--project', scope.project, '--path', `sessions/${safeSegment(mission)}.md`, '--json']);
        return JSON.parse(output).body || '';
      } catch { return ''; }
    }));
    return pages.filter(Boolean).join('\n\n').slice(0, 16_000);
  }

  async removeMission(workspace, mission) {
    if (!this.ready || !workspace || !mission) return;
    const scope = scopeFor(workspace);
    try { await this.command(['delete-page', '--workspace', scope.workspace, '--project', scope.project, '--path', `sessions/${safeSegment(mission)}.md`]); }
    catch (error) { if (!/not found|404/i.test(error.message)) throw error; }
  }
}

export { scopeFor };
