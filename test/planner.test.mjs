import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePlan, planPrompt, MAX_STEPS} from '../planner.mjs';
import {employees} from '../adapters.mjs';

const plano = {
  resumo: 'UX primeiro, backend em paralelo, frontend depois do alinhamento.',
  etapas: [
    {id: 'e1', employee: 'architect', tarefa: 'Desenhe o fluxo e entregue as telas.', depende: []},
    {id: 'e2', employee: 'backend', tarefa: 'Implemente a API de leitura.', depende: []},
    {id: 'e3', employee: 'frontend', tarefa: 'Implemente a tela com o UX aprovado.', depende: ['a1']}
  ],
  alinhamentos: [{id: 'a1', participantes: ['architect', 'frontend'], pauta: 'Passar o UX pronto para a implementação.', depende: ['e1']}]
};

test('Lê o plano do gerente e ordena as etapas pelas dependências', () => {
  const parsed = parsePlan('```json\n' + JSON.stringify(plano) + '\n```');
  assert.equal(parsed.etapas.length, 3);
  assert.equal(parsed.alinhamentos.length, 1);
  assert.ok(parsed.ordem.indexOf('e1') < parsed.ordem.indexOf('a1'));
  assert.ok(parsed.ordem.indexOf('a1') < parsed.ordem.indexOf('e3'));
  assert.ok(parsed.ordem.indexOf('e2') >= 0);
});

test('Recusa plano que travaria a fila ou citaria quem não trabalha aqui', () => {
  const com = mudanca => parsePlan(JSON.stringify({...plano, ...mudanca}));
  assert.throws(() => com({etapas: [{id: 'e1', employee: 'estagiario', tarefa: 'qualquer coisa', depende: []}], alinhamentos: []}), /não é um funcionário/);
  assert.throws(() => com({etapas: [{id: 'e1', employee: 'backend', tarefa: 'fazer', depende: ['nao-existe']}], alinhamentos: []}), /não existe no plano/);
  assert.throws(() => com({etapas: [{id: 'e1', employee: 'backend', tarefa: 'fazer', depende: ['e1']}], alinhamentos: []}), /depende de si mesmo/);
  assert.throws(() => com({etapas: [{id: 'e1', employee: 'backend', tarefa: 'fazer a parte um', depende: ['e2']}, {id: 'e2', employee: 'frontend', tarefa: 'fazer a parte dois', depende: ['e1']}], alinhamentos: []}), /círculo/);
  assert.throws(() => com({etapas: [{id: 'e1', employee: 'backend', tarefa: 'fazer a parte um', depende: []}, {id: 'e1', employee: 'frontend', tarefa: 'fazer a parte dois', depende: []}], alinhamentos: []}), /repetiu o identificador/);
  assert.throws(() => com({etapas: [], alinhamentos: []}), /pelo menos uma etapa/);
  assert.throws(() => com({etapas: Array.from({length: MAX_STEPS + 1}, (_, i) => ({id: `e${i}`, employee: 'backend', tarefa: 'fazer algo', depende: []})), alinhamentos: []}), /passou de/);
  assert.throws(() => com({alinhamentos: [{id: 'a1', participantes: ['architect'], pauta: 'sozinho', depende: []}]}), /2 a 6 participantes/);
  assert.throws(() => parsePlan('o funcionário respondeu em prosa'), /plano legível/);
});

test('A pauta do plano lista a equipe e proíbe mexer no projeto', () => {
  const prompt = planPrompt({manager: employees[0], demand: 'criar o guia de instalação', transcript: 'ficou combinado assim'});
  for (const employee of employees) assert.match(prompt, new RegExp(`- ${employee.id} \\(${employee.name}\\)`));
  assert.match(prompt, /criar o guia de instalação/);
  assert.match(prompt, /não leia nem edite arquivos/);
});
