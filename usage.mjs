import {spawn} from 'node:child_process';
import * as pty from 'node-pty';

const number=value=>Number.isFinite(Number(value))?Number(value):0;

export function eventUsage(event){
  const usage=event?.usage||event?.result?.usage||event?.item?.usage;
  if(!usage||typeof usage!=='object')return null;
  const input=number(usage.input_tokens??usage.inputTokens);
  const output=number(usage.output_tokens??usage.outputTokens);
  const cacheCreation=number(usage.cache_creation_input_tokens);
  const cacheRead=number(usage.cache_read_input_tokens);
  const total=number(usage.total_tokens??usage.totalTokens)||(input+output+cacheCreation+cacheRead);
  return total>0?{inputTokens:input,outputTokens:output,totalTokens:total}:null;
}

export function summarizeCodexUsage(result){
  const raw=result?.rateLimitsByLimitId&&Object.keys(result.rateLimitsByLimitId).length?result.rateLimitsByLimitId:{codex:result?.rateLimits};
  const buckets=Object.entries(raw||{}).map(([id,value])=>{
    const windows=[value?.primary,value?.secondary].filter(Boolean).map(window=>({
      remainingPercent:Math.max(0,Math.min(100,100-number(window.usedPercent))),
      resetsAt:window.resetsAt||null,
      windowDurationMins:window.windowDurationMins||null
    }));
    return {id,name:value?.limitName||id,windows};
  }).filter(bucket=>bucket.windows.length);
  return {available:true,ordinaryUsageAllowed:result?.ordinaryUsageAllowed??null,buckets};
}

export function summarizeUsagebar(result){
  const entries=Array.isArray(result?.entries)?result.entries:[];
  const read=(entryId,providerId,displayName)=>{
    const entry=entries.find(item=>item?.id===entryId||item?.brand===entryId);
    if(!entry)return{available:false,message:`${displayName} não foi informado pelo ai-usagebar.`};
    if(entry.status!=='ready')return{available:false,message:entry.error||`${displayName} não está pronto no ai-usagebar.`};
    const windows=(entry.metrics||[]).filter(metric=>Number.isFinite(Number(metric?.percent))).map(metric=>{
      const usedPercent=Math.max(0,Math.min(100,number(metric.percent)));
      const resetMillis=Date.parse(metric.reset_at||'');
      return{
        label:String(metric.label||'Limite'),usedPercent,remainingPercent:100-usedPercent,
        resetsAt:Number.isFinite(resetMillis)?Math.floor(resetMillis/1000):null,
        windowDurationMins:metric.window_secs?Math.round(number(metric.window_secs)/60):null
      };
    });
    return{available:true,ordinaryUsageAllowed:windows.every(window=>window.remainingPercent>0),buckets:[{id:providerId,name:displayName,windows}]};
  };
  return{claude:read('anthropic','claude','Claude'),codex:read('openai','codex','Codex')};
}

export function readUsagebar(binary,{timeoutMs=15000,spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    if(!binary)return reject(new Error('ai-usagebar não encontrado.'));
    const child=spawnImpl(binary,['usage','--json'],{shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1'}});
    let output='',errors='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{child.kill('SIGTERM');}catch{}error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('O ai-usagebar demorou para informar os limites.')),timeoutMs);timer.unref();
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>1_000_000)finish(new Error('Resposta do ai-usagebar excedeu o limite.'));});
    child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-4000);});
    child.on('error',()=>finish(new Error('Não foi possível executar o ai-usagebar.')));
    child.on('close',code=>{
      if(code!==0)return finish(new Error(errors.trim()||`ai-usagebar encerrou a consulta (${code??'sem código'}).`));
      try{return finish(null,summarizeUsagebar(JSON.parse(output)));}catch{return finish(new Error('O ai-usagebar retornou JSON inválido.'));}
    });
  });
}

/* Converte a leitura de cada terminal no veredito que o escritório usa para dizer quem está sem saldo.
   `known:false` significa que ninguém conseguiu ler a conta — aí o histórico de tarefas volta a valer. */
export function limitsFromUsage(providers){
  return Object.fromEntries(Object.entries(providers||{}).map(([id,info])=>{
    const windows=(info?.buckets||[]).flatMap(bucket=>bucket.windows||[]);
    const blocked=info?.ordinaryUsageAllowed===false;
    if(!info?.available||(!windows.length&&!blocked))return[id,{known:false,exhausted:false,message:info?.message||null}];
    const empty=windows.filter(window=>number(window.remainingPercent)<=0);
    const exhausted=blocked||empty.length>0;
    const stamps=(empty.length?empty:windows).map(window=>Number(window.resetsAt)).filter(Number.isFinite);
    const resetsText=(empty.length?empty:windows).map(window=>window.resetsText).find(Boolean)||null;
    return[id,{
      known:true,
      exhausted,
      remainingPercent:windows.length?Math.min(...windows.map(window=>number(window.remainingPercent))):0,
      resetsAt:stamps.length?Math.max(...stamps):null,
      resetsText
    }];
  }));
}

const stripTerminalNoise=value=>String(value||'')
  .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'')
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'')
  .replace(/\x1b[@-_]/g,'')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g,'');

export function summarizeClaudeUsage(output){
  const text=stripTerminalNoise(output);
  const readWindow=(heading,label)=>{
    const start=text.indexOf(heading);
    if(start<0)return null;
    const section=text.slice(start,start+500);
    const match=section.match(/(\d{1,3})%\s+(?:\d{1,3}%\s+)?used[\s\S]{0,180}?Resets\s+([^\r\n]+)/i);
    if(!match)return null;
    const usedPercent=Math.max(0,Math.min(100,Number(match[1])));
    return {label,usedPercent,remainingPercent:100-usedPercent,resetsText:match[2].trim().slice(0,120)};
  };
  const windows=[readWindow('Current session','Sessão atual'),readWindow('Current week','Semana atual')].filter(Boolean);
  if(!windows.length)throw new Error('O Claude Code não informou as janelas no comando /usage.');
  return {available:true,buckets:[{id:'claude',name:'Claude',windows}]};
}

function ensureClaudeAuthenticated(binary,{timeoutMs=5000,spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    let child;
    try{child=spawnImpl(binary,['auth','status'],{shell:false,stdio:['ignore','pipe','pipe'],env:{...process.env,NO_COLOR:'1'}});}
    catch{return reject(new Error('Não foi possível consultar a autenticação do Claude Code.'));}
    let output='',settled=false;
    const finish=(error)=>{if(settled)return;settled=true;clearTimeout(timer);try{child.kill('SIGTERM');}catch{}error?reject(error):resolve();};
    const timer=setTimeout(()=>finish(new Error('O Claude Code demorou para informar a autenticação.')),timeoutMs);timer.unref();
    for(const channel of ['stdout','stderr']){
      child[channel].setEncoding('utf8');
      child[channel].on('data',chunk=>{output=(output+chunk).slice(-20000);});
    }
    child.on('error',()=>finish(new Error('Não foi possível consultar a autenticação do Claude Code.')));
    child.on('close',code=>{
      let status;try{status=JSON.parse(output);}catch{}
      if(code===0&&status?.loggedIn===true)return finish();
      finish(new Error('Claude Code não está autenticado. Execute "claude" em um terminal e conclua o login.'));
    });
  });
}

export async function readClaudeUsage(binary,{timeoutMs=15000,ptySpawn=pty.spawn,authCheck=ensureClaudeAuthenticated}={}){
  if(!binary)throw new Error('Claude Code não encontrado.');
  await authCheck(binary,{timeoutMs:Math.min(timeoutMs,5000)});
  return new Promise((resolve,reject)=>{
    const env=Object.fromEntries(Object.entries({...process.env,NO_COLOR:'1',TERM:'xterm-256color'}).filter(([,value])=>value!=null).map(([key,value])=>[key,String(value)]));
    let terminal;
    try{
      terminal=ptySpawn(binary,['--ax-screen-reader','--safe-mode','--permission-mode','dontAsk'],{name:'xterm-256color',cols:120,rows:40,cwd:process.cwd(),env});
    }catch{
      return reject(new Error('Não foi possível abrir o Claude Code em um terminal compatível.'));
    }
    let output='',settled=false,sent=false,enterTimer;
    const stop=()=>{try{terminal.write('\x1b');terminal.write('/exit\r');}catch{}try{terminal.kill();}catch{}};
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(enterTimer);stop();error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('O Claude Code demorou para responder ao comando /usage.')),timeoutMs);timer.unref();
    terminal.onData(chunk=>{
      output+=chunk;
      if(output.length>1_000_000)return finish(new Error('Resposta de uso do Claude excedeu o limite.'));
      const plain=stripTerminalNoise(output);
      if(!sent&&plain.includes('Claude Code v')&&/[>$]\s*$/m.test(plain)){
        sent=true;
        try{terminal.write('/usage');}catch{}
        enterTimer=setTimeout(()=>{try{terminal.write('\r');}catch{}},120);enterTimer.unref();
      }
      if(output.includes('Current session')&&output.includes('Current week')){
        try{return finish(null,summarizeClaudeUsage(output));}catch{}
      }
    });
    terminal.onExit(({exitCode})=>{if(!settled)finish(new Error(`O Claude Code encerrou a consulta /usage (${exitCode??'sem código'}).`));});
  });
}

export function readCodexUsage(binary,{timeoutMs=10000,spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    if(!binary)return reject(new Error('Codex CLI não encontrado.'));
    const child=spawnImpl(binary,['--no-daemon','app-server','--listen','stdio://'],{shell:false,stdio:['pipe','pipe','ignore'],env:{...process.env,NO_COLOR:'1'}});
    let buffer='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);try{child.kill('SIGTERM');}catch{}error?reject(error):resolve(value);};
    const timer=setTimeout(()=>finish(new Error('O Codex demorou para informar os limites.')),timeoutMs);timer.unref();
    const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>1_000_000)return finish(new Error('Resposta de uso do Codex excedeu o limite.'));
      const lines=buffer.split('\n');buffer=lines.pop();
      for(const line of lines){
        let message;try{message=JSON.parse(line);}catch{continue;}
        if(message.id===1&&message.result){
          send({method:'initialized'});
          send({id:2,method:'account/rateLimits/read',params:{excludeResetCreditDetails:true,supportsLunaReserve:false}});
        }else if(message.id===2){
          if(message.error)return finish(new Error('O Codex não disponibilizou os limites.'));
          return finish(null,summarizeCodexUsage(message.result));
        }
      }
    });
    child.on('error',()=>finish(new Error('Não foi possível consultar o Codex CLI.')));
    child.on('exit',code=>{if(!settled)finish(new Error(`O Codex encerrou a consulta (${code??'sem código'}).`));});
    send({id:1,method:'initialize',params:{clientInfo:{name:'dev-office',title:'Dev Office',version:'1.0.0'},capabilities:{experimentalApi:true}}});
  });
}
