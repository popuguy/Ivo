import {cp,mkdir,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
for(const item of ['index.html','manifest.webmanifest','sw.js','src','public']) await cp(item,`dist/${item}`,{recursive:true});
console.log('Built static Ivo app in dist/');

await import('./portable.mjs');
