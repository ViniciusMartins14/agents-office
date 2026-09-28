import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {eventUsage,limitsFromUsage,readClaudeUsage,readCodexUsage,summarizeClaudeUsage,summarizeCodexUsage,summarizeUsagebar} from '../usage.mjs';

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

test('Converte ai-usagebar em limites comuns de Claude e Codex',()=>{
  const providers=summarizeUsagebar({entries:[
    {id:'anthropic',status:'ready',metrics:[{label:'Session (5h)',percent:19,reset_at:'2026-09-28T16:59:59Z',window_secs:18000}]},
    {id:'openai',status:'ready',metrics:[{label:'Codex weekly',percent:30,reset_at:'2026-10-02T05:18:36Z',window_secs:604800}]}
  ]});
  assert.equal(providers.claude.buckets[0].windows[0].remainingPercent,81);
  assert.equal(providers.codex.buckets[0].windows[0].remainingPercent,70);
  assert.equal(providers.codex.buckets[0].windows[0].windowDurationMins,10080);
  assert.equal(providers.claude.ordinaryUsageAllowed,true);
});

test('Consulta Claude por PTY portátil e envia /usage somente após o prompt',async()=>{
  const writes=[];
  let dataHandler=()=>{};
  const terminal={
    onData(handler){dataHandler=handler;queueMicrotask(()=>handler('Claude Code v2.1.282\r\n$ '));return{dispose(){}};},
    onExit(){return{dispose(){}};},
    write(value){
      writes.push(value);
      if(value==='\r')queueMicrotask(()=>dataHandler('Current session\r\n34% used\r\nResets 9:20pm\r\nCurrent week (all models)\r\n5% used\r\nResets Sep 30 at 2pm\r\n'));
    },
    kill(){}
  };
  const result=await readClaudeUsage('/bin/claude',{timeoutMs:1000,authCheck:async()=>{},ptySpawn:(binary,args,options)=>{
    assert.equal(binary,'/bin/claude');
    assert.ok(args.includes('--ax-screen-reader'));
    assert.equal(options.cols,120);
    return terminal;
  }});
  assert.deepEqual(writes.slice(0,2),['/usage','\r']);
  assert.equal(result.buckets[0].windows[0].remainingPercent,66);
  assert.equal(result.buckets[0].windows[1].remainingPercent,95);
});

test('Explica quando o Claude precisa de login antes de abrir o PTY',async()=>{
  await assert.rejects(
    readClaudeUsage('/bin/claude',{authCheck:async()=>{throw new Error('Claude Code não está autenticado. Execute "claude" em um terminal e conclua o login.');},ptySpawn:()=>assert.fail('PTY não deve abrir sem autenticação')}),
    /não está autenticado/
  );
});

test('Consulta Codex em app-server isolado e sem daemon compartilhado',async()=>{
  let stdout;
  const child=new EventEmitter();
  child.stdout=new EventEmitter();stdout=child.stdout;stdout.setEncoding=()=>{};
  child.stderr=new EventEmitter();
  child.kill=()=>{};
  child.stdin={write(line){
    const message=JSON.parse(line);
    if(message.id===1)queueMicrotask(()=>stdout.emit('data',JSON.stringify({id:1,result:{}})+'\n'));
    if(message.id===2)queueMicrotask(()=>stdout.emit('data',JSON.stringify({id:2,result:{ordinaryUsageAllowed:true,rateLimits:{primary:{usedPercent:34,windowDurationMins:300,resetsAt:1800000000}}}})+'\n'));
  }};
  const result=await readCodexUsage('/bin/codex',{timeoutMs:1000,spawnImpl:(binary,args,options)=>{
    assert.equal(binary,'/bin/codex');
    assert.deepEqual(args.slice(0,2),['--no-daemon','app-server']);
    assert.equal(options.shell,false);
    return child;
  }});
  assert.equal(result.buckets[0].windows[0].remainingPercent,66);
});
