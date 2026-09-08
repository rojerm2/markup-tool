// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { validShape, constrainedPoint, resizeShape, moveShape, pickShape, type Shape } from '../src/services/shapes';
import { emptySession } from '../src/services/annotationSession';
import { SessionHistory, sameSession } from '../src/services/sessionHistory';
import { parseProject, serializeProject, hashBytes } from '../src/services/projectFormat';
import { generateAnnotatedPdf } from '../src/services/pdfExport';
import { newPageLegend } from '../src/services/pageLegend';
const shape:Shape={id:'s',type:'rectangle',page:1,a:{x:30,y:40},b:{x:130,y:140},color:'#38bdf8',width:2.125,fill:null};
const source={reference:'p.pdf',filename:'p.pdf',sha256:'a'.repeat(64),size:100,pages:4};
it('validates bounded optional v2 shape defaults, IDs, malformed data and unchanged old projects',()=>{
 const old=serializeProject(source,emptySession);expect(parseProject(old).session).toEqual(emptySession);
 const raw=JSON.parse(old);raw.session.shapes=[{id:'s',type:'line',page:2,a:{x:-20,y:.5},b:{x:50,y:100}}];expect(parseProject(JSON.stringify(raw)).session.shapes![0]).toMatchObject({width:2,fill:null,color:'#38bdf8'});
 for(const bad of [{type:'polygon'},{a:null},{b:{x:NaN,y:0}},{width:0},{width:10001},{fill:'red'},{type:'line',fill:'#facc15'},{id:'bad\n'},{b:shape.a},{b:{x:1e7,y:30}},{page:5}])expect(()=>serializeProject(source,{...emptySession,shapes:[{...shape,...bad} as Shape]})).toThrow();
 expect(()=>serializeProject(source,{...emptySession,shapes:[shape,shape]})).toThrow();
 expect(()=>serializeProject(source,{...emptySession,shapes:Array.from({length:10001},(_,i)=>({...shape,id:String(i)}))})).toThrow();
 expect(()=>serializeProject(source,{...emptySession,legends:[{id:'s',name:'Walls',color:'#facc15'}],shapes:[shape]})).toThrow();
});
it('supports atomic create/edit/move/resize/delete history, reference/ABA guards and clean equality',()=>{
 const h=new SessionHistory(emptySession);h.apply({type:'put-shape',shape});const original=h.present;
 expect(h.apply({type:'put-shape',shape:{...shape},before:shape})).toBe(false);
 h.apply({type:'put-shape',before:shape,shape:moveShape(shape,2,-3)});expect(h.present.shapes![0].a).toEqual({x:32,y:37});
 h.traverse('undo');expect(h.present).toBe(original);const g=h.generation;h.traverse('redo');h.traverse('undo');expect(h.apply({type:'put-shape',before:shape,shape:moveShape(shape,4,0)},g)).toBe(false);
 h.apply({type:'remove-shape',id:shape.id});expect(sameSession(h.present,emptySession)).toBe(true);h.traverse('undo');expect(h.present.shapes![0]).toBe(shape);
});
it.each([0,90,180,270])('constraints, resizing, visible picking and actual vector exports on rotated/cropped UserUnit page %i',async rotation=>{
 const pdf=await PDFDocument.create();for(let i=0;i<2;i++){const p=pdf.addPage([400,300]);p.setCropBox(10,20,370,260);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),pdf.context.obj(2));}
 const bytes=await pdf.save(),hash=await hashBytes(bytes),inputTask=getDocument({data:bytes.slice()}),input=await inputTask.promise,p=await input.getPage(1),vp=p.getViewport({scale:1}),rect={left:0,top:0,width:vp.width,height:vp.height};
 for(const type of ['rectangle','ellipse','line'] as const)for(const dx of [-75,75])for(const dy of [-40,40]) {
  const a={x:100,y:100},b={x:100+dx,y:100+dy},end=constrainedPoint(a,b,type,true,rect,vp),s={...shape,type,a,b:end};expect(validShape(s)).toBe(true);
  const av=vp.convertToViewportPoint(a.x,a.y),bv=vp.convertToViewportPoint(end.x,end.y),x=Math.abs(bv[0]-av[0]),y=Math.abs(bv[1]-av[1]);if(type!=='line')expect(x).toBeCloseTo(y);else expect(Math.atan2(y,x)/(Math.PI/4)).toBeCloseTo(Math.round(Math.atan2(y,x)/(Math.PI/4)));
  expect(validShape(resizeShape(s,0,{x:200,y:200},true,rect,vp))).toBe(true);
 }
 for(let handle=0;handle<4;handle++){const corners=[shape.a,{x:shape.b.x,y:shape.a.y},shape.b,{x:shape.a.x,y:shape.b.y}];expect(resizeShape(shape,handle,corners[handle],false,rect,vp)).toEqual(shape);}
 const client=(x:number,y:number)=>{const [a,b]=vp.convertToViewportPoint(x,y);return {x:a,y:b};};
 expect(pickShape([shape],client(80,90),rect,vp)).toBeNull();expect(pickShape([shape],client(30,90),rect,vp)?.id).toBe('s');
 expect(pickShape([shape,{...shape,id:'top',fill:'#facc15'}],client(80,90),rect,vp)?.id).toBe('top');
 const shapes:Shape[]=[shape,{...shape,id:'ellipse',type:'ellipse',a:{x:160,y:40},b:{x:260,y:140},fill:'#facc15'}, {...shape,id:'line',type:'line',a:{x:30,y:180},b:{x:260,y:180}}, {...shape,id:'page2',page:2}];
 const legends=[{id:'wall',name:'Caf\u00e9 \u2013 \u0421\u0442\u0435\u043d\u044b',color:'#4ade80'}];const key={...newPageLegend(1,vp,['wall'],{x:10,y:10}),background:false,border:false,width:180};
 const session={...emptySession,shapes,legends,pageLegends:[key]};const restored=parseProject(serializeProject(source,session)).session;expect(restored).toEqual(session);
 const output=await generateAnnotatedPdf(bytes,restored,new Uint8Array(readFileSync('src/assets/LegendSans.ttf'))),task=getDocument({data:output}),doc=await task.promise;
 expect(doc.numPages).toBe(2);const page=await doc.getPage(1);expect((await page.getTextContent()).items.map(i=>'str'in i?i.str:'').join('')).toContain('Caf\u00e9 \u2013 \u0421\u0442\u0435\u043d\u044b');
 for(const scale of [1,1.25]){const v=page.getViewport({scale}),canvas=createCanvas(Math.ceil(v.width),Math.ceil(v.height));await page.render({canvas:canvas as never,viewport:v}).promise;
  const at=(x:number,y:number)=>{const q=v.convertToViewportPoint(x,y);return [...canvas.getContext('2d').getImageData(Math.floor(q[0]),Math.floor(q[1]),1,1).data];};
  // Samples intentionally away from the page-key footprint for every rotation.
  expect(at(210,90)).toEqual([254,245,208,255]);expect(at(145,180)).toEqual([56,189,248,255]);
 }
 await task.destroy();await inputTask.destroy();expect(await hashBytes(bytes)).toBe(hash);
});

it('transparent keys retain independent borders, opaque Unicode text/swatches and the highlighted plan beneath after reopen/export',async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([400,300]);const bytes=await pdf.save();
 const input=getDocument({data:bytes.slice()}),doc=await input.promise,vp=(await doc.getPage(1)).getViewport({scale:1});
 const legends=[{id:'w',name:'Walls',color:'#4ade80'}],key={...newPageLegend(1,vp,['w'],{x:30,y:30}),background:false,border:true,width:240};
 const annotation={id:'h',type:'freehand' as const,page:1,legendId:null,color:'#facc15',width:100,opacity:.4,points:[{x:0,y:240},{x:350,y:240}]};
 for(const background of [false,true]){
  const session=parseProject(serializeProject(source,{...emptySession,legends,annotations:[annotation],pageLegends:[{...key,background}]})).session;
  expect(session.pageLegends![0]).toMatchObject({background,border:true});
  const out=await generateAnnotatedPdf(bytes,session,new Uint8Array(readFileSync('src/assets/LegendSans.ttf'))),task=getDocument({data:out}),result=await task.promise,page=await result.getPage(1),viewport=page.getViewport({scale:2}),canvas=createCanvas(800,600);await page.render({canvas:canvas as never,viewport}).promise;
  // Empty space at the right of the key remains translucent plan, or opaque white.
  expect([...canvas.getContext('2d').getImageData(480,100,1,1).data]).toEqual(background?[255,255,255,255]:[253,235,162,255]);
  await task.destroy();
 }
 await input.destroy();
});
