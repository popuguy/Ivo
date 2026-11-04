// A bounded application shell cache. User documents live in IndexedDB, never here.
const CACHE='ivo-shell-v1';
const SHELL=['./','./index.html','./manifest.webmanifest','./public/icon.svg','./src/styles.css','./src/app.js','./src/model.js','./src/seed.js','./src/storage.js','./src/sanitize.js','./src/graph.js','./src/graph-worker.js'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ivo-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok&&SHELL.some(path=>new URL(path,self.registration.scope).href===url.href)){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}
  return response;
 }).catch(()=>caches.match(event.request).then(hit=>hit||Response.error())));
});
