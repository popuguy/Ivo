import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const read=name=>fs.readFile(path.join(root,name),'utf8');
// Bundle our small ES modules without a dependency install. Each keeps its own scope.
const names=['model','seed','storage','sanitize','graph','app'];
let script='const IvoModules=Object.create(null);\n';
const worker=await read('src/graph-worker.js');
script+='const ivoWorkerURL=URL.createObjectURL(new Blob(['+JSON.stringify(worker)+'],{type:"text/javascript"}));\n';
for(const name of names){
 let code=await read('src/'+name+'.js');
 const exports=[...code.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m=>m[1]);
 code=code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,(_,bindings,source)=>'const {'+bindings.replace(/\s+as\s+/g,':')+'}=IvoModules['+JSON.stringify(source)+'];');
 code=code.replace(/\bexport\s+(?=(?:async\s+)?(?:function|const))/g,'');
 code=code.replace("new URL('./graph-worker.js', import.meta.url)",'ivoWorkerURL');
 code=code.replace("if('serviceWorker'in navigator)","if(location.protocol!=='file:'&&'serviceWorker'in navigator)");
 script+='IvoModules["./'+name+'.js"]=(()=>{\n'+code+'\nreturn {'+exports.join(',')+'};})();\n';
}
const css=await read('src/styles.css');
let html=await read('index.html');
html=html.replace(/<link[^>]+rel="manifest"[^>]*>/,'').replace(/<link[^>]+rel="icon"[^>]*>/,'');
html=html.replace(/<link[^>]+href="\.\/src\/styles.css"[^>]*>/,'<style>'+css+'</style>');
html=html.replace(/<script type="module" src="\.\/src\/app.js"><\/script>/,'<script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
await fs.mkdir(path.join(root,'dist'),{recursive:true});
await fs.writeFile(path.join(root,'dist/Ivo.html'),html);
console.log('Portable preview: '+path.join(root,'dist/Ivo.html'));
