import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const TARGETS = new Set(['claude', 'codex', 'bob']);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function cloneJson(value, depth = 0) {
  if (depth > 10) throw new Error('O JSON do MCP tem níveis demais.');
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (value.length > 10_000 || value.includes('\0')) throw new Error('Um valor do JSON do MCP é inválido ou muito longo.');
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 200) throw new Error('Uma lista do JSON do MCP excede 200 itens.');
    return value.map(item => cloneJson(item, depth + 1));
  }
  if (!object(value)) throw new Error('O JSON do MCP contém um valor não suportado.');
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`A chave ${key} não é permitida no JSON do MCP.`);
    copy[key] = cloneJson(item, depth + 1);
  }
  return copy;
}
function stringMap(value, field) {
  if (value == null) return undefined;
  if (!object(value)) throw new Error(`${field} precisa ser um objeto de texto para texto.`);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.length > 200 || typeof item !== 'string' || /[\0\r\n]/.test(key) || item.includes('\0')) throw new Error(`${field} contém uma entrada inválida.`);
    result[key] = item;
  }
  return result;
}
function stringList(value, field, limit = 200) {
  if (value == null) return undefined;
  if (!Array.isArray(value) || value.length > limit || value.some(item => typeof item !== 'string' || item.length > 10_000 || item.includes('\0'))) throw new Error(`${field} precisa ser uma lista de textos.`);
  return [...value];
}

function normalizeServer(input) {
  if (!object(input) || !NAME.test(input.name || '')) throw new Error('Nome de MCP inválido. Use letras, números, _ ou -.');
  const source = object(input.config) ? cloneJson(input.config) : cloneJson(input);
  delete source.name; delete source.targets; delete source.transport; delete source.config;
  if (JSON.stringify(source).length > 100_000) throw new Error('A configuração do MCP excede 100 KB.');
  const declared = String(input.transport || source.type || '').toLowerCase();
  const transport = declared === 'stdio' || (!source.url && !source.httpURL && source.command) ? 'stdio' : 'http';
  const targets = [...new Set(Array.isArray(input.targets) ? input.targets : [])].filter(target => TARGETS.has(target));
  if (!targets.length) throw new Error('Escolha pelo menos uma IA para o MCP.');
  if (transport === 'http') {
    const rawUrl = source.url || source.httpURL;
    let parsed;
    try { parsed = new URL(rawUrl); } catch { throw new Error('URL do MCP inválida.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('O MCP remoto precisa usar HTTP ou HTTPS.');
    if (parsed.username || parsed.password) throw new Error('Não inclua credenciais na URL do MCP.');
    if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) throw new Error('HTTP sem TLS só é permitido em loopback.');
    source.type = ['sse', 'ws'].includes(declared) ? declared : 'http'; source.url = parsed.toString(); delete source.httpURL;
    if (source.headers != null) source.headers = stringMap(source.headers, 'headers');
    if (source.http_headers != null) source.http_headers = stringMap(source.http_headers, 'http_headers');
    if (source.env_http_headers != null) source.env_http_headers = stringMap(source.env_http_headers, 'env_http_headers');
    if (source.bearer_token_env_var != null && (typeof source.bearer_token_env_var !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.bearer_token_env_var))) throw new Error('bearer_token_env_var precisa conter o nome de uma variável de ambiente.');
    return { name: input.name, transport, url: source.url, targets, config: source };
  }
  const command = String(source.command || '').trim();
  if (!command || command.length > 500 || /[\0\r\n]/.test(command)) throw new Error('Comando STDIO inválido.');
  const args = stringList(source.args || [], 'args', 200) || [];
  if (args.some(value => /[\0\r\n]/.test(value))) throw new Error('Argumento STDIO inválido.');
  source.type = 'stdio'; source.command = command; source.args = args;
  if (source.env != null) source.env = stringMap(source.env, 'env');
  if (source.env_vars != null) source.env_vars = stringList(source.env_vars, 'env_vars');
  if (source.cwd != null && (typeof source.cwd !== 'string' || source.cwd.length > 2000 || /[\0\r\n]/.test(source.cwd))) throw new Error('cwd inválido.');
  return { name: input.name, transport, command, args, targets, config: source };
}

function parseMcpJson(value, targets) {
  let document;
  try { document = typeof value === 'string' ? JSON.parse(value) : cloneJson(value); }
  catch (error) { throw new Error(`JSON inválido: ${error.message}`); }
  if (!object(document)) throw new Error('O JSON precisa ser um objeto.');
  const wrapper = object(document.mcpServers) ? document.mcpServers : object(document.servers) ? document.servers : null;
  let entries;
  if (wrapper) entries = Object.entries(wrapper).map(([name, config]) => ({ name, config }));
  else {
    const name = document.name;
    if (!name) throw new Error('Informe "name" ou use o formato { "mcpServers": { ... } }.');
    const config = { ...document }; delete config.name; delete config.targets;
    entries = [{ name, config, targets: document.targets }];
  }
  if (!entries.length) throw new Error('O JSON não contém nenhum servidor MCP.');
  if (entries.length > 20) throw new Error('Importe no máximo 20 servidores MCP por vez.');
  return entries.map(entry => normalizeServer({ name: entry.name, config: entry.config, targets: entry.targets || targets }));
}

function run(binary, args, { cwd = process.cwd(), timeoutMs = 20000, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    if (!binary) return reject(new Error('CLI não encontrada.'));
    const child = spawnImpl(binary, args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    let output = '', settled = false;
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill('SIGTERM'); } catch {} error ? reject(error) : resolve(result); };
    const timer = setTimeout(() => finish(new Error('A configuração do MCP demorou para responder.')), timeoutMs); timer.unref();
    for (const stream of [child.stdout, child.stderr]) { stream.setEncoding('utf8'); stream.on('data', chunk => { output = (output + chunk).slice(-12000); }); }
    child.on('error', error => finish(error)); child.on('close', code => code === 0 ? finish(null, output.trim()) : finish(new Error(output.trim() || `CLI encerrou com código ${code}.`)));
  });
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error(`JSON inválido em ${file}: ${error.message}`); }
}

function claudeConfig(server) {
  const config = cloneJson(server.config);
  if (server.transport === 'http') {
    config.type = config.type === 'sse' || config.type === 'ws' ? config.type : 'http'; config.headers = { ...(config.http_headers || {}), ...(config.headers || {}) };
    for (const [header, variable] of Object.entries(config.env_http_headers || {})) config.headers[header] = `\${${variable}}`;
    if (config.bearer_token_env_var && !config.headers.Authorization) config.headers.Authorization = `Bearer \${${config.bearer_token_env_var}}`;
    if (!Object.keys(config.headers).length) delete config.headers;
  }
  delete config.http_headers; delete config.env_http_headers; delete config.bearer_token_env_var; delete config.enabled_tools; delete config.disabled_tools;
  return config;
}

function bobConfig(server) {
  const config = cloneJson(server.config);
  if (server.transport === 'http') {
    config.type = config.type === 'sse' ? 'sse' : 'streamable-http'; config.headers = { ...(config.http_headers || {}), ...(config.headers || {}) };
    for (const [header, variable] of Object.entries(config.env_http_headers || {})) config.headers[header] = `\${env:${variable}}`;
    if (config.bearer_token_env_var && !config.headers.Authorization) config.headers.Authorization = `Bearer \${env:${config.bearer_token_env_var}}`;
    if (!Object.keys(config.headers).length) delete config.headers;
  }
  delete config.http_headers; delete config.env_http_headers; delete config.bearer_token_env_var;
  return { alwaysAllow: [], disabled: false, ...config };
}

function codexArgs(server) {
  const config = server.config;
  if (server.transport === 'stdio') {
    if (config.cwd || config.env_vars) throw new Error('O Codex CLI não grava cwd/env_vars por comando. Remova esses campos para o Codex ou desmarque esse destino.');
    const args = ['mcp', 'add', server.name]; for (const [key, value] of Object.entries(config.env || {})) args.push('--env', `${key}=${value}`);
    return [...args, '--', config.command, ...(config.args || [])];
  }
  if (config.type === 'ws' || config.type === 'sse') throw new Error('O Codex aceita MCP remoto por Streamable HTTP; WebSocket/SSE explícito não é compatível.');
  const headers = { ...(config.http_headers || {}), ...(config.headers || {}) }; let bearer = config.bearer_token_env_var;
  const authorization = headers.Authorization || headers.authorization; const match = typeof authorization === 'string' && authorization.match(/^Bearer \$\{([A-Za-z_][A-Za-z0-9_]*)\}$/);
  if (!bearer && match) bearer = match[1]; if (authorization) { delete headers.Authorization; delete headers.authorization; }
  if (Object.keys(headers).length || Object.keys(config.env_http_headers || {}).length) throw new Error('O Codex CLI não grava headers HTTP personalizados; use bearer_token_env_var ou desmarque Codex para este cadastro.');
  const args = ['mcp', 'add', server.name, '--url', config.url]; if (bearer) args.push('--bearer-token-env-var', bearer); return args;
}

export class McpRegistry {
  constructor(file, { home = os.homedir(), execute = run, now = () => new Date() } = {}) { this.file = file; this.home = home; this.execute = execute; this.now = now; this.servers = []; this.results = {}; this.appliedAt = {}; }
  async load() { const content = await readJson(this.file); this.servers = (Array.isArray(content.servers) ? content.servers : []).map(server => { try { return normalizeServer(server); } catch { return null; } }).filter(Boolean); this.results = object(content.results) ? content.results : {}; this.appliedAt = object(content.appliedAt) ? content.appliedAt : {}; return this.publicState(); }
  publicState() { return { servers: this.servers, results: this.results, appliedAt: this.appliedAt }; }
  async save() { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify({ servers: this.servers, results: this.results, appliedAt: this.appliedAt }, null, 2), { mode: 0o600 }); }
  async upsert(input) { return (await this.upsertMany([normalizeServer(input)]))[0]; }
  async import(value, targets) { return this.upsertMany(parseMcpJson(value, targets)); }
  async upsertMany(servers) { for (const server of servers) { this.servers = this.servers.filter(item => item.name !== server.name); this.servers.push(server); delete this.results[server.name]; delete this.appliedAt[server.name]; } this.servers.sort((a, b) => a.name.localeCompare(b.name)); await this.save(); return servers; }
  async remove(name) { if (!NAME.test(name || '') || !this.servers.some(server => server.name === name)) throw new Error('MCP não encontrado no catálogo.'); this.servers = this.servers.filter(server => server.name !== name); delete this.results[name]; delete this.appliedAt[name]; await this.save(); }
  async ensure(server) { if (!this.servers.some(item => item.name === server.name)) await this.upsert(server); }
  async apply(name, binaries, cwd = process.cwd()) {
    const server = this.servers.find(item => item.name === name); if (!server) throw new Error('MCP não encontrado no catálogo.'); const results = {};
    for (const target of server.targets) {
      try {
        if (target === 'claude') {
          try { await this.execute(binaries.claude, ['mcp', 'remove', '--scope', 'user', server.name], { cwd }); } catch {}
          results.claude = { ok: true, message: await this.execute(binaries.claude, ['mcp', 'add-json', '--scope', 'user', server.name, JSON.stringify(claudeConfig(server))], { cwd }) || 'Configurado.' };
        } else if (target === 'codex') {
          const args = codexArgs(server); try { await this.execute(binaries.codex, ['mcp', 'remove', server.name], { cwd }); } catch {}
          results.codex = { ok: true, message: await this.execute(binaries.codex, args, { cwd }) || 'Configurado.' };
        } else {
          const file = path.join(this.home, '.bob', 'settings', 'mcp.json'); const config = await readJson(file); config.mcpServers = object(config.mcpServers) ? config.mcpServers : {}; config.mcpServers[server.name] = bobConfig(server);
          await fs.mkdir(path.dirname(file), { recursive: true }); try { await fs.copyFile(file, `${file}.backup-${this.now().toISOString().replace(/[:.]/g, '-')}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
          await fs.writeFile(file, JSON.stringify(config, null, 2), { mode: 0o600 }); results.bob = { ok: true, message: `Configurado em ${file}. Reinicie o IBM Bob.` };
        }
      } catch (error) { results[target] = { ok: false, message: error.message }; }
    }
    this.results[name] = results; this.appliedAt[name] = this.now().toISOString(); await this.save(); return results;
  }
}

export { normalizeServer, parseMcpJson };
