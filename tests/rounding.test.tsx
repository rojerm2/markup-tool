// @vitest-environment node
import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { highlightOutline, svgPath, outlineContains } from '../src/services/highlightGeometry';
import { emptySession } from '../src/services/annotationSession';
import { SessionHistory } from '../src/services/sessionHistory';
import { parseProject, serializeProject } from '../src/services/projectFormat';
import { generateAnnotatedPdf } from '../src/services/pdfExport';
import type { Highlight } from '../src/types/annotation';
const stroke:Highlight={id:'a',type:'freehand',page:1,legendId:null,color:'#123456',opacity:.4,width:10.125,points:[{x:30,y:50},{x:80,y:50},{x:80,y:90}]};
const source={reference:'p.pdf',filename:'p.pdf',sha256:'a'.repeat(64),size:100,pages:4};
it('defaults old v1/v2 highlights and drawing to round, preserves nonpalette geometry, and bounds rounding',()=>{
 for(const version of [1,2]) {const s={...emptySession,annotations:[stroke]};expect(parseProject(JSON.stringify({format:'pdf-markup-project',version,source,session:s})).session).toEqual(s);}
 for(const rounding of [-1,101,null,'50',Infinity]) expect(()=>serializeProject(source,{...emptySession,annotations:[{...stroke,rounding} as Highlight]})).toThrow();
 const h=new SessionHistory({...emptySession,annotations:[stroke,{...stroke,id:'b'}]});
 expect(h.apply({type:'edit-stroke',id:'a',edit:{rounding:100}})).toBe(false);
 h.apply({type:'edit-stroke',id:'a',before:stroke,edit:{rounding:25}});expect(h.present.annotations[0].points).toBe(stroke.points);expect(h.present.annotations[1].rounding).toBeUndefined();
 const generation=h.generation;h.traverse('undo');h.traverse('redo');expect(h.apply({type:'edit-stroke',id:'a',before:stroke,edit:{rounding:0}},generation)).toBe(false);
 h.traverse('undo');expect(h.present.annotations[0]).toBe(stroke);
});
it('has genuinely distinct continuous endpoint footprints, fixed width, and finite bounded bend primitives',()=>{
 const paths=[0,25,50,75].map(rounding=>highlightOutline({...stroke,rounding}));expect(new Set(paths.map(p=>svgPath(p))).size).toBe(4);
 for(const rounding of [0,25,50,75]) {const path=highlightOutline({...stroke,rounding});const r=stroke.width/2*rounding/100;
   expect(outlineContains(path,{x:30-r+.001,y:50},0)).toBe(true);expect(outlineContains(path,{x:30-r-.001,y:50},0)).toBe(false);
   expect(outlineContains(path,{x:50,y:50+stroke.width/2-.001},0)).toBe(true);expect(outlineContains(path,{x:50,y:50+stroke.width/2+.001},0)).toBe(false);
 }
 for(const points of [[{x:0,y:0},{x:0,y:0},{x:10,y:0}], [{x:0,y:0},{x:.000001,y:0},{x:0,y:0}], [{x:0,y:0},{x:10,y:0},{x:0,y:.001}], [{x:0,y:0},{x:10,y:10},{x:0,y:10},{x:10,y:0}]])
  for(const rounding of [0,25,50,75]) {const coords=highlightOutline({...stroke,points,rounding}).flatMap(c=>c.points.flatMap(p=>[p.x,p.y]));expect(coords.every(Number.isFinite)).toBe(true);expect(coords.every(v=>Math.abs(v)<30)).toBe(true);}
});
it.each([0,90,180,270])('exports distinct paths and once-composited mixed rounding with real PDF.js, rotation %i',async rotation=>{
 const pdf=await PDFDocument.create();for(let i=0;i<2;i++){const p=pdf.addPage([300,250]);p.setCropBox(10,20,270,210);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),pdf.context.obj(2));}
 const bytes=await pdf.save(),snapshot=bytes.slice();
 const strokes=[0,25,50,75,100].map((rounding,i)=>({...stroke,id:String(i),color:'#facc15',rounding,points:[{x:40,y:40+i*35},{x:100,y:40+i*35},{x:100,y:55+i*35}]}));
 const session={...emptySession,annotations:[...strokes,...strokes.map(s=>({...s,id:'copy'+s.id,rounding:100}))]};
 const out=await generateAnnotatedPdf(bytes,session),parsed=await PDFDocument.load(out);
 const forms=parsed.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).values();expect(forms).toHaveLength(1);
 const commands=new TextDecoder().decode(decodePDFRawStream(parsed.context.lookup(forms[0],PDFRawStream)).decode());expect(commands).toContain(' c');expect(commands.match(/\nf/g)).toHaveLength(4);expect(commands).toContain('1 J 1 j');
 const task=getDocument({data:out});const doc=await task.promise;expect(doc.numPages).toBe(2);const p=await doc.getPage(1);
 for(const scale of [1,1.25]) {const vp=p.getViewport({scale}),canvas=createCanvas(Math.ceil(vp.width),Math.ceil(vp.height));await p.render({canvas:canvas as never,viewport:vp}).promise;
  const at=(x:number,y:number)=>{const q=vp.convertToViewportPoint(x,y);return [...canvas.getContext('2d').getImageData(Math.floor(q[0]),Math.floor(q[1]),1,1).data];};
  for(let i=0;i<5;i++)expect(at(60,40+i*35)).toEqual([253,235,162,255]);
 }
 await task.destroy();expect(bytes).toEqual(snapshot);
});
