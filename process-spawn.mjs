import path from 'node:path';

/* Unix permite executar scripts com shebang diretamente. No Windows, o mesmo arquivo sem extensão precisa
   passar pelo Node; isso mantém fixtures e CLIs JavaScript como argumentos, sem recorrer a shell:true. */
export function spawnTarget(binary,args,{platform=process.platform,node=process.execPath}={}){
  if(platform==='win32'&&!path.extname(binary))return{binary:node,args:[binary,...args]};
  return{binary,args};
}
