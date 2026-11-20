import {createSceneDocument,insertObject,addPage} from '../../../src/domain/documents/scene.js';
import {startTextFlow,threadFrame,enableNativeComposition} from '../../../src/domain/documents/text-flows.js';
import {enablePublishing} from '../../../src/domain/documents/publishing.js';
import {markTypographyVersion} from '../../../src/domain/documents/capabilities.js';

export function baselineGridFixture({aligned=false} = {}) {
  const doc=createSceneDocument('Baseline grid', {width:512,height:300});
  const firstPage=doc.pages[0].id, secondPage=addPage(doc,firstPage).id;
  const words=['cut','hem','sew','press','join','trim','fold','line','rip','finish','dart','spin'];
  const source='<p'+(aligned?' data-ivo-gridalign="all"':'')+'>'+words.join('<br>')+'</p>';
  const frames=[[firstPage,35,31,78,3,4],[firstPage,245,47,90,6,1],[secondPage,31,52,201,11,2]].map(([page,x,y,h,insetTop,insetBottom],i)=>
    insertObject(doc,'text',page,{x,y,w:i===2?220:200,h,textStyle:'cmu-serif',fontSize:12,leading:14.4,
      frameOptions:{firstBaseline:'fixed',minimumFirstBaseline:12,insetTop,insetBottom,verticalAlign:'top'},html:i?'':source}));
  const flow=startTextFlow(doc,frames[0].id,{automaticPages:false});
  threadFrame(doc,frames[0].id,frames[1].id);threadFrame(doc,frames[1].id,frames[2].id);
  enableNativeComposition(doc,flow,'single-line');
  if (aligned) {
    enablePublishing(doc).baselineGrid={start:17,increment:19};
    markTypographyVersion(doc);
  }
  return {doc,frames,words};
}
