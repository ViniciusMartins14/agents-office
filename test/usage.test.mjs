import test from 'node:test';
import assert from 'node:assert/strict';
import {eventUsage,limitsFromUsage,summarizeClaudeUsage,summarizeCodexUsage} from '../usage.mjs';

test('Normaliza tokens consumidos reportados pelos terminais',()=>{
  assert.deepEqual(eventUsage({usage:{input_tokens:100,output_tokens:25,cache_creation_input_tokens:10,cache_read_input_tokens:5}}),{inputTokens:100,outputTokens:25,totalTokens:140});
  assert.deepEqual(eventUsage({usage:{inputTokens:80,outputTokens:20,totalTokens:100}}),{inputTokens:80,outputTokens:20,totalTokens:100});
  assert.equal(eventUsage({}),null);
});

test('Converte janelas do Codex em percentuais restantes sem expor dados da conta',()=>{
  const result=summarizeCodexUsage({accountId:'privado',ordinaryUsageAllowed:true,rateLimitsByLimitId:{codex:{limitName:'Codex',primary:{usedPercent:12,windowDurationMins:300,resetsAt:1800000000},secondary:{usedPercent:75,windowDurationMins:10080,resetsAt:1800100000}}}});
  assert.deepEqual(result,{available:true,ordinaryUsageAllowed:true,buckets:[{id:'codex',name:'Codex',windows:[{remainingPercent:88,resetsAt:1800000000,windowDurationMins:300},{remainingPercent:25,resetsAt:1800100000,windowDurationMins:10080}]}]});
  assert.ok(!JSON.stringify(result).includes('privado'));
});

test('Converte a saída interativa de /usage do Claude em saldo restante',()=>{
  const result=summarizeClaudeUsage(`Claude Code v2.1.274\nCurrent session\n12% 12% used\nResets 9:20pm (America/Sao_Paulo)\nCurrent week (all models)\n27% 27% used\nResets Sep 21 at 2pm (America/Sao_Paulo)\n`);
  assert.deepEqual(result,{available:true,buckets:[{id:'claude',name:'Claude',windows:[
    {label:'Sessão atual',usedPercent:12,remainingPercent:88,resetsText:'9:20pm (America/Sao_Paulo)'},
    {label:'Semana atual',usedPercent:27,remainingPercent:73,resetsText:'Sep 21 at 2pm (America/Sao_Paulo)'}
  ]}]});
});

test('Deriva quem está sem saldo a partir da leitura das contas',()=>{
  const limits=limitsFromUsage({
    codex:{available:true,ordinaryUsageAllowed:false,buckets:[{id:'codex',name:'Codex',windows:[
      {remainingPercent:74,resetsAt:1789690303,windowDurationMins:300},
      {remainingPercent:0,resetsAt:1790013451,windowDurationMins:10080}
    ]}]},
    claude:{available:true,buckets:[{id:'claude',name:'Claude',windows:[
      {label:'Sessão atual',usedPercent:2,remainingPercent:98,resetsText:'9:20pm'},
      {label:'Semana atual',usedPercent:27,remainingPercent:73,resetsText:'Sep 21 at 2pm'}
    ]}]},
    bob:{available:false,message:'O IBM Bob CLI não informa um saldo restante em tokens.'}
  });
  assert.deepEqual(limits.codex,{known:true,exhausted:true,remainingPercent:0,resetsAt:1790013451,resetsText:null});
  assert.deepEqual(limits.claude,{known:true,exhausted:false,remainingPercent:73,resetsAt:null,resetsText:'9:20pm'});
  assert.equal(limits.bob.known,false);
  assert.equal(limits.bob.exhausted,false);
});

test('Conta sem janelas legíveis não afirma que o saldo acabou',()=>{
  const limits=limitsFromUsage({claude:{available:true,buckets:[]},codex:{available:false,message:'Codex CLI não encontrado.'}});
  assert.equal(limits.claude.known,false);
  assert.equal(limits.claude.exhausted,false);
  assert.equal(limits.codex.known,false);
});
