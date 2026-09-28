import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillCatalog } from '../skills.mjs';

test('Catálogo lista metadados e carrega somente skills selecionadas', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-skills-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'safe-review'));
  await fs.writeFile(path.join(root, 'safe-review', 'SKILL.md'), '---\nname: safe-review\ndescription: Revise com evidências.\n---\n\n# Processo\n\nValide o resultado.\n');
  const catalog = new SkillCatalog(root);
  assert.deepEqual(await catalog.list(), [{ id: 'safe-review', name: 'safe-review', description: 'Revise com evidências.', stage: 'general' }]);
  assert.match(await catalog.prompt(['safe-review']), /Valide o resultado/);
  await assert.rejects(catalog.select(['../escape']), /inválido/);
  await assert.rejects(catalog.select(['missing']), /não encontrada/);
});

test('Catálogo real cobre o ciclo de entrada até melhoria contínua', async () => {
  const catalog = new SkillCatalog(fileURLToPath(new URL('../skills', import.meta.url)));
  const skills = await catalog.list();
  assert.equal(skills.length, 13);
  assert.deepEqual(new Set(skills.map(skill => skill.stage)), new Set(['intake', 'resolution', 'verification', 'release', 'improvement']));
  for (const expected of ['pr-audit', 'issue-audit', 'github-resolution', 'dependency-bump', 'post-resolution-audit', 'release', 'kaizen']) {
    assert.ok(skills.some(skill => skill.id === expected), `${expected} deve existir`);
  }
});

test('Catálogo limita a seleção e ignora skills quebradas na listagem', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'office-skills-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'broken'));
  await fs.writeFile(path.join(root, 'broken', 'SKILL.md'), '# sem frontmatter');
  const catalog = new SkillCatalog(root);
  assert.deepEqual(await catalog.list(), []);
  await assert.rejects(catalog.select(['a', 'b', 'c', 'd', 'e']), /no máximo 4/);
});
