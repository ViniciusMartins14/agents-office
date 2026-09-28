import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inspectDependencies, platformInstructions, runProbe } from '../dependencies.mjs';

test('Comandos de instalação são específicos por sistema e não executam instaladores', () => {
  assert.match(platformInstructions('win32').gh, /winget/);
  assert.match(platformInstructions('darwin').gh, /brew/);
  assert.match(platformInstructions('linux').gh, /apt/);
  assert.match(platformInstructions('win32')['ai-usagebar'], /scoop/);
});

test('Diagnóstico distingue pronto, autenticação pendente, ausente e incompatível', async () => {
  const paths = new Map([['git', '/bin/git'], ['gh', '/bin/gh']]);
  const report = await inspectDependencies({
    platform: 'win32', arch: 'x64', knownBinaries: { claude: 'C:\\bin\\claude.exe', codex: 'C:\\bin\\codex.exe' },
    locate: async name => paths.get(name) || null,
    probe: async (binary, args) => ({ ok: !binary.endsWith('gh'), text: args.includes('status') ? 'not logged in' : '1.0.0' })
  });
  const byId = Object.fromEntries(report.items.map(item => [item.id, item]));
  assert.equal(byId.git.status, 'ready');
  assert.equal(byId.claude.status, 'auth_required');
  assert.equal(byId.gh.status, 'auth_required');
  assert.equal(byId['ai-usagebar'].status, 'missing');
  assert.equal(byId['ai-jail'].status, 'missing');
  assert.equal(byId['ai-jail'].version, '');
  assert.match(byId['ai-jail'].note, /WSL2/);
});

test('ai-jail no Windows é detectado dentro do WSL2', async () => {
  const report = await inspectDependencies({
    platform: 'win32',
    arch: 'x64',
    knownBinaries: { wsl: 'C:\\Windows\\System32\\wsl.exe' },
    locate: async () => null,
    probe: async (_binary, args) => args[0] === '--'
      ? { ok: true, text: 'ai-jail 0.1.0' }
      : { ok: true, text: 'Default Distribution: Ubuntu' }
  });
  const jail = report.items.find(item => item.id === 'ai-jail');
  assert.equal(jail.status, 'ready');
  assert.equal(jail.version, 'ai-jail 0.1.0');
  assert.match(jail.path, /wsl\.exe: ai-jail/);
});

test('Falha síncrona ao iniciar um diagnóstico não derruba o Office', async () => {
  const result = await runProbe('bloqueado.exe', ['--version'], {
    platform: 'win32',
    spawnImpl: () => { const error = new Error('operation not permitted'); error.code = 'EPERM'; throw error; }
  });
  assert.deepEqual(result, { ok: false, text: '' });
});
