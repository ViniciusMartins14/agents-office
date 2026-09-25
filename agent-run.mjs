import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {commandFor,decodeLine} from './adapters.mjs';

/* Pergunta avulsa a um funcionário, fora da fila de missões: roda o terminal dele em uma pasta vazia e
   devolve o texto da resposta. Pasta vazia porque estas perguntas são de raciocínio — nada deve ser lido
   nem alterado no projeto do usuário. */
export async function runAgent({provider,binary,prompt,timeoutMs=120000,limit=200000,signal}){
  if(!binary)throw new Error('O terminal desse funcionário não está disponível.');
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-ask-'));
  const command=commandFor(provider,directory,prompt);
  try{
    return await new Promise((resolve,reject)=>{
      const child=spawn(binary,command.args,{cwd:directory,env:{...process.env,NO_COLOR:'1'},shell:false,detached:true,stdio:['pipe','pipe','pipe']});
      let result='',output='',buffer='',failure=false,total=0,settled=false,killTimer;
      const kill=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}killTimer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1500);killTimer.unref();};
      const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
      const abort=()=>{kill();finish(new Error('Consulta cancelada.'));};
      const timer=setTimeout(()=>{kill();finish(new Error('O funcionário demorou para responder.'));},timeoutMs);
      const line=value=>{
        if(!value.trim())return;
        const parsed=decodeLine(value);
        failure ||= !!parsed.failed||!!parsed.blocked;
        if(parsed.result)result=(parsed.stream?result:'')+parsed.result;
        if(parsed.text)output=(output+parsed.text+(parsed.stream?'':'\n')).slice(-limit);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data',chunk=>{
        total+=chunk.length;
        if(total>limit*4){kill();finish(new Error('A resposta do funcionário excedeu o limite.'));return;}
        buffer+=chunk;const lines=buffer.split('\n');buffer=lines.pop();
        for(const item of lines)line(item);
      });
      child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});child.stdin.end(command.input);
      child.on('error',()=>finish(new Error('Não foi possível abrir o terminal do funcionário.')));
      child.on('close',code=>{
        clearTimeout(killTimer);line(buffer);
        if(code!==0||failure)return finish(new Error('O terminal não concluiu a resposta. Confira login, limite de uso e permissões.'));
        finish(null,result||output);
      });
      signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    });
  }finally{await fs.rm(directory,{recursive:true,force:true});}
}
