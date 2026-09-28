import { promises as fs } from 'node:fs';
import path from 'node:path';

const SKILL_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const MAX_SKILLS = 4;
const MAX_FILE_SIZE = 64 * 1024;
const SKILL_STAGES = new Set(['intake', 'resolution', 'verification', 'release', 'improvement', 'general']);

function parseFrontmatter(source, expectedId) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(source);
  if (!match) throw new Error(`A skill "${expectedId}" não possui frontmatter válido.`);
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^([a-z_]+):\s*(.+)\s*$/.exec(line);
    if (item) fields[item[1]] = item[2].replace(/^['"]|['"]$/g, '').trim();
  }
  if (fields.name !== expectedId) throw new Error(`A skill "${expectedId}" precisa declarar o mesmo nome da pasta.`);
  if (!fields.description) throw new Error(`A skill "${expectedId}" precisa de uma descrição.`);
  const body = match[2].trim();
  if (!body) throw new Error(`A skill "${expectedId}" está vazia.`);
  const stage = SKILL_STAGES.has(fields.stage) ? fields.stage : 'general';
  return { id: expectedId, name: fields.name, description: fields.description.slice(0, 300), stage, body };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export class SkillCatalog {
  constructor(directory) { this.directory = path.resolve(directory); }

  async read(id) {
    if (typeof id !== 'string' || !SKILL_ID.test(id)) throw new Error('Identificador de skill inválido.');
    const root = await fs.realpath(this.directory);
    const file = path.join(root, id, 'SKILL.md');
    let resolved;
    try { resolved = await fs.realpath(file); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Skill não encontrada: ${id}.`);
      throw error;
    }
    if (!inside(root, resolved)) throw new Error(`A skill "${id}" aponta para fora do catálogo.`);
    const stat = await fs.stat(resolved);
    if (!stat.isFile() || stat.size > MAX_FILE_SIZE) throw new Error(`A skill "${id}" excede o limite permitido.`);
    return parseFrontmatter(await fs.readFile(resolved, 'utf8'), id);
  }

  async list() {
    await fs.mkdir(this.directory, { recursive: true });
    const entries = await fs.readdir(this.directory, { withFileTypes: true });
    const found = [];
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || !SKILL_ID.test(entry.name)) continue;
      try {
        const skill = await this.read(entry.name);
        found.push({ id: skill.id, name: skill.name, description: skill.description, stage: skill.stage });
      } catch { /* Uma skill quebrada não derruba o escritório inteiro. */ }
    }
    return found;
  }

  async select(ids) {
    if (ids == null) return [];
    if (!Array.isArray(ids)) throw new Error('A seleção de skills é inválida.');
    const unique = [...new Set(ids)];
    if (unique.length > MAX_SKILLS) throw new Error(`Escolha no máximo ${MAX_SKILLS} skills por missão.`);
    return Promise.all(unique.map(id => this.read(id)));
  }

  async prompt(ids) {
    const selected = await this.select(ids);
    if (!selected.length) return '';
    return selected.map(skill => `### ${skill.name}\n${skill.body}`).join('\n\n');
  }
}

export { MAX_SKILLS, parseFrontmatter };
