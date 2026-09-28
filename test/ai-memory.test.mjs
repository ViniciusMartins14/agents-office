import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { AiMemory, scopeFor } from '../ai-memory.mjs';

test('Adaptador grava, recupera e remove missões pelo ai-memory', async () => {
  const calls = [];
  const execute = async (_binary, args, options) => {
    calls.push({ args, input: options.input || '' });
    if (args[0] === 'read-page') return JSON.stringify({ body: '# Sessão anterior\n\nResultado preservado.' });
    return '';
  };
  const memory = new AiMemory({ binary: 'ai-memory', dataDirectory: path.join('tmp', 'memory'), execute });
  memory.ready = true;
  const workspace = path.resolve('projeto-com-memoria');
  await memory.recordMission(workspace, 'mission-1', [{
    name: 'Davi', role: 'Backend', provider: 'codex', status: 'done', result: 'API concluída', createdAt: '2026-09-25T10:00:00.000Z'
  }]);
  assert.equal(calls[0].args[0], 'write-page');
  assert.match(calls[0].input, /Davi — Backend/);
  assert.ok(calls[0].args.includes('episodic'));
  assert.match(await memory.recent(workspace, ['mission-1']), /Resultado preservado/);
  await memory.removeMission(workspace, 'mission-1');
  assert.equal(calls.at(-1).args[0], 'delete-page');
  assert.match(scopeFor(workspace).project, /^projeto-com-memoria-/);
});

test('Sem binário externo não cria uma memória paralela', async () => {
  const memory = new AiMemory({ binary: null, dataDirectory: 'ignorado' });
  assert.equal(await memory.start(), false);
  assert.equal(await memory.recent('/tmp/projeto', ['mission-1']), '');
});
