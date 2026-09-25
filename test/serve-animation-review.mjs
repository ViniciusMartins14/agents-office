// Prévia isolada, sem bootstrap/API, histórico ou execução dos terminais.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const allow=['office3d.js','office-motion.js','styles.css','vendor/GLTFLoader.js','vendor/three.module.min.js','vendor/three.core.min.js','vendor/utils/BufferGeometryUtils.js','assets/blender/employee.glb'];
http.createServer(async(req,res)=>{
 const route=new URL(req.url,'http://127.0.0.1:14318').pathname.slice(1);
 const file=route===''?'test/animation-review.html':route==='animation-review.js'?'test/animation-review.js':allow.includes(route)?`dist/${route}`:null;
 if(!file){res.writeHead(404);return res.end();}
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.glb':'model/gltf-binary'};
 try{res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store'});res.end(await readFile(path.join(root,file)));}catch{res.end();}
}).listen(14318,'127.0.0.1',()=>console.log('Revisão isolada em http://127.0.0.1:14318'));
