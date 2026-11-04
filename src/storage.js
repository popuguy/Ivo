const DB_NAME='ivo-atlas';const DB_VERSION=1;
let connection;
export async function openStore(){
  if(connection)return connection;
  connection=await new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{const db=r.result;for(const s of ['documents','assets','meta'])if(!db.objectStoreNames.contains(s))db.createObjectStore(s,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return connection;
}
async function transaction(store,mode,perform){const db=await openStore();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let result;try{result=perform(tx.objectStore(store));}catch(e){reject(e);return;}tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error||new Error('Storage failed'));tx.onabort=()=>reject(tx.error||new Error('Storage aborted'));});}
export const loadDocuments=()=>transaction('documents','readonly',s=>s.getAll());
export const saveDocument=doc=>transaction('documents','readwrite',s=>s.put(structuredClone(doc)));
export const saveAsset=asset=>transaction('assets','readwrite',s=>s.put(asset));
export const loadAssets=()=>transaction('assets','readonly',s=>s.getAll());
export const loadAsset=id=>transaction('assets','readonly',s=>s.get(id));
export const getMeta=id=>transaction('meta','readonly',s=>s.get(id));
export const putMeta=(id,value)=>transaction('meta','readwrite',s=>s.put({id,value}));
export async function saveImport(payload){const db=await openStore();return new Promise((resolve,reject)=>{const tx=db.transaction(['documents','assets','meta'],'readwrite');payload.documents.forEach(d=>tx.objectStore('documents').put(d));(payload.assets||[]).forEach(a=>tx.objectStore('assets').put(a));tx.objectStore('meta').put({id:'initialized',value:true});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});}
export async function snapshot(doc){const key='history:'+doc.id;const previous=(await getMeta(key))?.value||[];if(previous[0]?.updatedAt===doc.updatedAt)return;await putMeta(key,[structuredClone(doc),...previous].slice(0,20));}
export const loadHistory=async id=>(await getMeta('history:'+id))?.value||[];
export function fileAsDataURL(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});}
