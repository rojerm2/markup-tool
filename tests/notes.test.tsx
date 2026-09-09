// @vitest-environment node
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { ARROW_DEFAULTS, TEXT_DEFAULTS, arrowGeometry, fitNote, layoutNote, moveNote, notePoint, noteTextError, pointerOrigin, validNote, validNotes, type TextNote, type Arrow } from '../src/services/notes';
import { emptySession } from '../src/services/annotationSession';
import { SessionHistory, sameSession } from '../src/services/sessionHistory';
import { parseProject, serializeProject, hashBytes } from '../src/services/projectFormat';
import { outlineContains } from '../src/services/highlightGeometry';
import { constrainedPoint } from '../src/services/shapes';
const note:TextNote={...TEXT_DEFAULTS,id:'n',type:'text',page:1,x:40,y:200,rotation:0,text:'Café Ελληνικά\nСтены',pointers:[]};
const arrow:Arrow={...ARROW_DEFAULTS,id:'a',type:'arrow',page:1,a:{x:20,y:30},b:{x:150,y:30}};
const source={reference:'p.pdf',filename:'p.pdf',sha256:'a'.repeat(64),size:100,pages:4};
it('preserves multiline Unicode and whitespace, reflows without clipping, and rejects unsupported/bounded input',()=>{
  expect(noteTextError(note.text)).toBeNull();expect(layoutNote(note).lines).toEqual(['Café Ελληνικά','Стены']);
  expect(layoutNote({...note,text:'  A  \n\nB '} ).lines).toEqual(['  A  ','','B ']);
  const narrow=fitNote({...note,width:40,text:'longword '.repeat(30)});expect(narrow.height).toBe(layoutNote(narrow).height);expect(narrow.height).toBeGreaterThan(note.height);expect(validNote(narrow)).toBe(true);
  for(const text of ['emoji 😀','中文','a\tb','a\rb','a\u007fb','a\u0000b','x'.repeat(4097)])expect(noteTextError(text)).toBeTruthy();
  expect(validNote({...note,height:30})).toBe(false);expect(validNote({...note,text:' \n '})).toBe(false);
});
it('owns three independent targets, preserves them on move/reflow, safely attaches on all rotations and deletes atomically',()=>{
  for(const rotation of [0,90,180,270] as const){const n={...note,rotation};
    for(const [x,y] of [[100,30],[0,0],[200,60],[100,0]])expect(pointerOrigin(n,notePoint(n,x,y))).toBeNull();
    expect(pointerOrigin(n,notePoint(n,300,30))).toEqual(notePoint(n,200,30));
    expect(pointerOrigin(n,notePoint(n,300,90))).toEqual(notePoint(n,200,60));
  }
  const n={...note,pointers:[1,2,3].map(i=>({...ARROW_DEFAULTS,id:`p${i}`,target:{x:i*90,y:20}}))};
  const h=new SessionHistory(emptySession);h.apply({type:'put-note',note:n});const original=h.present;
  h.apply({type:'put-note',before:n,note:moveNote(n,20,30)});expect((h.present.notes![0] as TextNote).pointers).toBe(n.pointers);
  const moved=h.present.notes![0] as TextNote;h.apply({type:'put-note',before:moved,note:fitNote({...moved,width:60})});expect((h.present.notes![0] as TextNote).pointers).toBe(n.pointers);
  const resized=h.present.notes![0] as TextNote;h.apply({type:'put-note',before:resized,note:{...resized,pointers:resized.pointers.map((p,i)=>i===1?{...p,target:{x:45,y:60},head:16,width:4}:p)}});
  const edited=h.present.notes![0] as TextNote;expect(edited.pointers[0]).toBe(n.pointers[0]);expect(edited.pointers[2]).toBe(n.pointers[2]);
  h.apply({type:'put-note',before:edited,note:{...edited,pointers:edited.pointers.filter(p=>p.id!=='p2')}});expect((h.present.notes![0] as TextNote).pointers).toHaveLength(2);h.traverse('undo');expect(h.present.notes![0]).toBe(edited);
  h.apply({type:'remove-note',id:'n'});expect(sameSession(h.present,emptySession)).toBe(true);h.traverse('undo');expect(h.present.notes![0]).toBe(edited);
  const generation=h.generation;h.traverse('undo');h.traverse('redo');expect(h.apply({type:'put-note',before:edited,note:n},generation)).toBe(false);
  expect(original.notes![0]).toBe(n);
});
it('keeps optional v2 defaults and old projects; rejects duplicate, orphan-like, cross-page and unbounded objects',()=>{
  const old=serializeProject(source,emptySession);expect(parseProject(old).session).toEqual(emptySession);
  expect(parseProject(old.replace('"version":2','"version":1')).session).toEqual(emptySession);
  const raw=JSON.parse(old);raw.session.notes=[{id:'a',type:'arrow',page:1,a:arrow.a,b:arrow.b}];expect(parseProject(JSON.stringify(raw)).session.notes![0]).toEqual(arrow);
  const session={...emptySession,notes:[note,arrow]};expect(parseProject(serializeProject(source,session)).session).toEqual(session);
  for(const bad of [{width:0},{height:Infinity},{rotation:45},{page:5},{text:'😀'},{pointers:[{...ARROW_DEFAULTS,id:'p',target:null}]},{pointers:Array(33).fill({...ARROW_DEFAULTS,id:'p',target:arrow.a})}])expect(()=>serializeProject(source,{...emptySession,notes:[{...note,...bad} as TextNote]})).toThrow();
  for(const notes of [[note,note],[{...note,pointers:[{...ARROW_DEFAULTS,id:'n',target:arrow.a}]}],[{...arrow,b:arrow.a}],[{...arrow,type:'pointer'}]])expect(()=>serializeProject(source,{...emptySession,notes:notes as TextNote[]})).toThrow();
  expect(validNotes([note],['n'])).toBe(false);expect(validNotes(Array(10001).fill(note))).toBe(false);
});
it('shares bounded vector head picking, shaft/head independence, no-head and short/reversed behavior',()=>{
  const long=arrowGeometry(arrow.a,arrow.b,arrow),wide=arrowGeometry(arrow.a,arrow.b,{...arrow,width:4});expect(long).toEqual(wide);
  expect(outlineContains(long.head,{x:145,y:30},0,true)).toBe(true);
  expect(arrowGeometry(arrow.a,arrow.a,arrow)).toEqual({shaft:[],head:[]});
  const short=arrowGeometry({x:0,y:0},{x:1,y:0},arrow);expect(short.head[1].points[0].x).toBeCloseTo(.2);expect(short.shaft[1].points[0].x).toBeCloseTo(.2);
  expect(arrowGeometry(arrow.a,arrow.b,{...arrow,head:0}).head).toEqual([]);
  expect(arrowGeometry(arrow.b,arrow.a,arrow).head[0].points[0]).toEqual(arrow.a);
});
it.each([0,90,180,270])('exports embedded multiline text and vectors on multipage cropped UserUnit=2 pages at rotation %i',async rotation=>{
  const {generateAnnotatedPdf}=await import('../src/services/pdfExport');
  const pdf=await PDFDocument.create();for(let i=0;i<2;i++){const p=pdf.addPage([400,300]);p.setCropBox(10,20,370,260);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),pdf.context.obj(2));}
  const bytes=await pdf.save(),hash=await hashBytes(bytes),task=getDocument({data:bytes.slice()}),doc=await task.promise,vp=(await doc.getPage(1)).getViewport({scale:1});
  const rect={left:0,top:0,width:vp.width,height:vp.height},snap=constrainedPoint(arrow.a,{x:120,y:75},'line',true,rect,vp),a=vp.convertToViewportPoint(arrow.a.x,arrow.a.y),b=vp.convertToViewportPoint(snap.x,snap.y);
  const angle=Math.atan2(b[1]-a[1],b[0]-a[0])/(Math.PI/4);expect(angle).toBeCloseTo(Math.round(angle));
  const at=vp.convertToPdfPoint(40,40),n:TextNote={...note,x:at[0],y:at[1],rotation:rotation as TextNote['rotation'],width:100, text:'Café\nΕλληνικά\nСтены',height:80};
  n.pointers=[1,2,3].map(i=>({...ARROW_DEFAULTS,id:`p${i}`,target:notePoint(n,30*i,140)}));
  const out=await generateAnnotatedPdf(bytes,{...emptySession,notes:[n,{...arrow,color:'#ef4444'},{...n,id:'n2',page:2,pointers:[]}]},new Uint8Array(readFileSync('src/assets/LegendSans.ttf')));
  const output=getDocument({data:out}),result=await output.promise;expect(result.numPages).toBe(2);const page=await result.getPage(1);
  const text=(await page.getTextContent()).items.map(i=>'str'in i?i.str:'').join('');for(const line of n.text.split('\n'))expect(text).toContain(line);
  expect((await page.getOperatorList()).fnArray.length).toBeGreaterThan(80);
  for(const scale of [1,1.25,3]){const v=page.getViewport({scale}),canvas=createCanvas(Math.ceil(v.width),Math.ceil(v.height));await page.render({canvas:canvas as never,viewport:v}).promise;
    const p=v.convertToViewportPoint(80,30);expect([...canvas.getContext('2d').getImageData(Math.floor(p[0]),Math.floor(p[1]),1,1).data]).toEqual([239,68,68,255]);
  }
  expect(await hashBytes(bytes)).toBe(hash);await output.destroy();await task.destroy();
});
