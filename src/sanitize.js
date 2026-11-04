import {resolveDocumentLink} from './model.js';
const TAGS=new Set(['P','BR','STRONG','B','EM','I','U','S','H2','H3','H4','UL','OL','LI','BLOCKQUOTE','A','SUP','SUB','SPAN','CODE']);
const DROP=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','INPUT','BUTTON','TEXTAREA']);
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeURL(value){
  const s=String(value||'').trim();
  if(s.startsWith('asset:'))return /^asset:[a-zA-Z0-9_-]+$/.test(s)?s:'';
  if(/^\.\/public\/[a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+$/.test(s))return s;
  try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}
}
export function cleanHTML(value){
  const source=new DOMParser().parseFromString(String(value||''),'text/html');
  function clean(node){
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent);
    if(node.nodeType!==Node.ELEMENT_NODE||DROP.has(node.tagName))return document.createTextNode('');
    if(!TAGS.has(node.tagName)){const frag=document.createDocumentFragment();node.childNodes.forEach(c=>frag.append(clean(c)));return frag;}
    const out=document.createElement(node.tagName.toLowerCase());
    if(node.tagName==='A'){
      const target=node.getAttribute('data-doc-id');
      const href=safeURL(node.getAttribute('href'));
      if(target&&/^[\w-]{1,120}$/.test(target)){out.dataset.docId=target;out.href='#doc='+encodeURIComponent(target);}
      else if(href){out.href=href;out.target='_blank';out.rel='noopener noreferrer';}
    }
    node.childNodes.forEach(c=>out.append(clean(c)));return out;
  }
  const host=document.createElement('div');source.body.childNodes.forEach(n=>host.append(clean(n)));return host.innerHTML;
}
export function readableHTML(html,documents,sourceId=null){
  const node=document.createElement('div');node.innerHTML=cleanHTML(html);
  const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);const leaves=[];while(walker.nextNode())if(!walker.currentNode.parentElement.closest('a,code'))leaves.push(walker.currentNode);
  for(const text of leaves){
    const re=/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;let match,last=0;const fragment=document.createDocumentFragment();
    while((match=re.exec(text.data))){fragment.append(text.data.slice(last,match.index));const target=resolveDocumentLink(documents,match[1],sourceId);const a=document.createElement('a');a.textContent=match[2]||match[1];if(target){a.dataset.docId=target;a.href='#doc='+encodeURIComponent(target);}else{a.className='unresolved';a.title='Unresolved or ambiguous document link';}fragment.append(a);last=re.lastIndex;}
    if(last){fragment.append(text.data.slice(last));text.replaceWith(fragment);}
  }
  return node.innerHTML;
}
