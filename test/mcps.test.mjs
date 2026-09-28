import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpRegistry, normalizeServer, parseMcpJson } from '../mcps.mjs';

test('Registro aplica MCP HTTP em Claude, Codex e IBM Bob sem shell', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-mcps-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const registry = new McpRegistry(path.join(root, 'office', 'mcps.json'), {
    home: path.join(root, 'home'),
    execute: async (binary, args) => { calls.push({ binary, args }); return 'ok'; },
    now: () => new Date('2026-09-25T18:00:00.000Z')
  });
  await registry.load();
  const bobFile = path.join(root, 'home', '.bob', 'settings', 'mcp.json');
  await fs.mkdir(path.dirname(bobFile), { recursive: true });
  await fs.writeFile(bobFile, JSON.stringify({ mcpServers: { existente: { command: 'keep-me' } }, preference: true }));
  await registry.upsert({ name: 'memory', transport: 'http', url: 'http://127.0.0.1:49375/mcp', targets: ['claude', 'codex', 'bob'] });
  const results = await registry.apply('memory', { claude: 'claude.exe', codex: 'codex.exe' }, root);
  assert.equal(results.claude.ok, true);
  assert.equal(results.codex.ok, true);
  assert.equal(results.bob.ok, true);
  assert.ok(calls.some(call => call.binary === 'claude.exe' && call.args.includes('--scope') && call.args.includes('user')));
  assert.ok(calls.some(call => call.binary === 'codex.exe' && call.args.includes('--url')));
  const bob = JSON.parse(await fs.readFile(bobFile, 'utf8'));
  assert.deepEqual(bob.mcpServers.memory, { type: 'streamable-http', url: 'http://127.0.0.1:49375/mcp', alwaysAllow: [], disabled: false });
  assert.deepEqual(bob.mcpServers.existente, { command: 'keep-me' });
  assert.equal(bob.preference, true);
  assert.equal((await fs.readdir(path.dirname(bobFile))).some(file => file.startsWith('mcp.json.backup-')), true);
  const restored = new McpRegistry(path.join(root, 'office', 'mcps.json'), { home: path.join(root, 'home') });
  await restored.load();
  assert.equal(restored.publicState().results.memory.claude.ok, true);
  assert.equal(restored.publicState().appliedAt.memory, '2026-09-25T18:00:00.000Z');
  await restored.remove('memory');
  assert.equal(restored.publicState().servers.length, 0);
  assert.equal(restored.publicState().results.memory, undefined);
});

test('Registro aceita STDIO estruturado e rejeita HTTP remoto sem TLS', () => {
  assert.deepEqual(normalizeServer({ name: 'local', transport: 'stdio', command: 'node', args: ['server.mjs'], targets: ['claude'] }), {
    name: 'local', transport: 'stdio', command: 'node', args: ['server.mjs'], targets: ['claude'], config: { type: 'stdio', command: 'node', args: ['server.mjs'] }
  });
  assert.throws(() => normalizeServer({ name: 'unsafe', transport: 'http', url: 'http://example.com/mcp', targets: ['codex'] }), /TLS/);
  assert.throws(() => normalizeServer({ name: 'secret', transport: 'http', url: 'https://user:password@example.com/mcp', targets: ['claude'] }), /credenciais/);
});

test('Importa JSON MCP direto, mcpServers e servers preservando campos avançados', () => {
  const direct = parseMcpJson(JSON.stringify({ name: 'opensearch', command: 'uvx', args: ['opensearch-mcp-server-py'], cwd: 'C:/work', env: { OPENSEARCH_URL: '${OPENSEARCH_URL}' } }), ['claude', 'bob']);
  assert.equal(direct[0].transport, 'stdio');
  assert.equal(direct[0].config.cwd, 'C:/work');
  assert.deepEqual(direct[0].config.env, { OPENSEARCH_URL: '${OPENSEARCH_URL}' });
  assert.deepEqual(direct[0].targets, ['claude', 'bob']);
  const wrapped = parseMcpJson({ mcpServers: { search: { type: 'http', url: 'https://example.com/mcp', headers: { 'X-Tenant': '${TENANT}' } } } }, ['claude']);
  assert.equal(wrapped[0].name, 'search');
  assert.deepEqual(wrapped[0].config.headers, { 'X-Tenant': '${TENANT}' });
  const vscode = parseMcpJson({ servers: { docs: { type: 'http', url: 'https://developers.openai.com/mcp' } } }, ['codex']);
  assert.equal(vscode[0].name, 'docs');
  assert.throws(() => parseMcpJson('{', ['claude']), /JSON inválido/);
  assert.throws(() => parseMcpJson({ mcpServers: {} }, ['claude']), /nenhum servidor/);
});

test('Aplica env avançado em Claude, Codex e Bob sem expor por shell', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-mcps-json-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const registry = new McpRegistry(path.join(root, 'office', 'mcps.json'), { home: path.join(root, 'home'), execute: async (binary, args) => { calls.push({ binary, args }); return 'ok'; } });
  await registry.load();
  await registry.import({ mcpServers: { opensearch: { command: 'uvx', args: ['opensearch-mcp-server-py'], env: { OPENSEARCH_URL: '${OPENSEARCH_URL}' } } } }, ['claude', 'codex', 'bob']);
  const result = await registry.apply('opensearch', { claude: 'claude', codex: 'codex' }, root);
  assert.equal(result.claude.ok, true); assert.equal(result.codex.ok, true); assert.equal(result.bob.ok, true);
  const claude = calls.find(call => call.args.includes('add-json'));
  assert.deepEqual(JSON.parse(claude.args.at(-1)).env, { OPENSEARCH_URL: '${OPENSEARCH_URL}' });
  const codex = calls.find(call => call.binary === 'codex' && call.args.includes('add'));
  assert.ok(codex.args.includes('--env')); assert.ok(codex.args.includes('OPENSEARCH_URL=${OPENSEARCH_URL}'));
  const bob = JSON.parse(await fs.readFile(path.join(root, 'home', '.bob', 'settings', 'mcp.json'), 'utf8'));
  assert.deepEqual(bob.mcpServers.opensearch.env, { OPENSEARCH_URL: '${OPENSEARCH_URL}' });
});

test('Codex recusa headers personalizados sem apagar cadastro existente', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-mcps-header-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const calls = [];
  const registry = new McpRegistry(path.join(root, 'mcps.json'), { execute: async (binary, args) => { calls.push({ binary, args }); return 'ok'; } });
  await registry.load(); await registry.import({ name: 'private', type: 'http', url: 'https://example.com/mcp', headers: { 'X-Tenant': '${TENANT}' } }, ['codex']);
  const result = await registry.apply('private', { codex: 'codex' }, root);
  assert.equal(result.codex.ok, false); assert.match(result.codex.message, /headers HTTP personalizados/);
  assert.equal(calls.length, 0);
});
