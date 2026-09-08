// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { PDFDocument, PDFName, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { emptySession, sessionReducer } from '../src/services/annotationSession';
import { SessionHistory, sameSession } from '../src/services/sessionHistory';
import { keyPoint, layoutLegend, newPageLegend, textError, validPageLegend, type PageLegend } from '../src/services/pageLegend';
import { parseProject, serializeProject } from '../src/services/projectFormat';
import { generateAnnotatedPdf } from '../src/services/pdfExport';
import { COLORS } from '../src/components/Annotations/DrawingControls';
const legends=[{id:'wall',name:'Walls',color:'#4ade80'},{id:'door',name:'Doors',color:'#facc15'},{id:'ceil',name:'Ceiling',color:'#ef4444'}];
const base={...emptySession,legends};
const key:PageLegend={id:'key',page:1,x:20,y:180,rotation:0,categoryIds:['wall','door','ceil'],title:'LEGEND',layout:'list',width:180,fontSize:12,background:true,border:true};
const source={reference:'plan.pdf',filename:'plan.pdf',sha256:'a'.repeat(64),size:100,pages:2};
it('returns to the clean baseline after removing the last key and restores empty-key category deletion atomically',()=>{
  const h=new SessionHistory(base);
  h.apply({type:'put-key',key:{...key,categoryIds:['wall']},legends});
  h.apply({type:'remove-key',id:key.id});
  expect(sameSession(h.present,base)).toBe(true);
  expect(parseProject(serializeProject(source,{...base,pageLegends:[]})).session).toEqual(base);
  h.traverse('undo');const placed=h.present;
  h.apply({type:'delete',id:'wall'});expect(h.present.pageLegends).toBeUndefined();
  h.traverse('undo');expect(h.present).toBe(placed);expect(h.present.pageLegends![0].categoryIds).toEqual(['wall']);
});
it('migrates v1 without changing legacy values and validates v2 ordered references and geometry',()=>{
  const legacy={...base,legends:[...legends,{id:'legacy',name:'原本',color:'#123456'}]};
  expect(parseProject(JSON.stringify({format:'pdf-markup-project',version:1,source,session:legacy})).session).toEqual(legacy);
  const session={...base,pageLegends:[key]};expect(parseProject(serializeProject(source,session)).session).toEqual(session);
  for(const change of [{categoryIds:['wall','wall']},{categoryIds:['missing']},{categoryIds:[]},{x:Infinity},{width:0},{fontSize:9},{rotation:45},{layout:'other'},{page:3},{id:'wall'},{id:'bad\n'},{title:'bad\n'}]) {
    expect(()=>serializeProject(source,{...base,pageLegends:[{...key,...change} as PageLegend]})).toThrow();
  }
  expect(()=>parseProject(JSON.stringify({format:'pdf-markup-project',version:3,source,session}))).toThrow(/version/);
});
it('records atomic relationships, independent duplication, removal and guarded history',()=>{
  const h=new SessionHistory(base);h.apply({type:'put-key',key,legends:h.present.legends});
  h.apply({type:'put-key',key:{...key,id:'copy',page:2},legends:h.present.legends});
  const before=h.present.pageLegends![0],g=h.generation;
  expect(h.apply({type:'put-key',key:{...before,x:30},before,legends:h.present.legends},g)).toBe(true);
  expect(h.present.pageLegends![1].x).toBe(20);
  h.traverse('undo');h.traverse('redo');expect(h.apply({type:'put-key',key:{...before,x:40},before,legends:h.present.legends},g)).toBe(false);
  h.apply({type:'rename',id:'wall',name:'Murs'});expect(layoutLegend(h.present.pageLegends![0],h.present.legends).texts.some(t=>t.text==='Murs')).toBe(true);
  h.apply({type:'delete',id:'wall'});expect(h.present.pageLegends!.every(k=>!k.categoryIds.includes('wall'))).toBe(true);
  h.traverse('undo');expect(h.present.pageLegends![0].categoryIds).toEqual(key.categoryIds);
  const snapshot=h.present;h.apply({type:'remove-key',id:'key'});expect(h.present.legends).toBe(snapshot.legends);expect(snapshot.pageLegends).toHaveLength(2);
  expect(sessionReducer(base,{type:'put-key',key:{...key,title:'原本'},legends})).toBe(base);
});
it('wraps long labels deterministically, uses row-major columns and explicit glyph coverage',()=>{
  expect(COLORS).toHaveLength(12);expect(COLORS.slice(0,4).map(c=>c.value)).toEqual(['#facc15','#4ade80','#38bdf8','#f472b6']);
  for(const text of ['Café – entrée','Τοίχοι','Стены'])expect(textError(text)).toBeNull();
  expect(textError('原本')).toMatch(/cannot render/);expect(textError('🧱')).toMatch(/cannot render/);
  const l=layoutLegend({...key,title:'',layout:'columns',width:240},legends);
  expect(l.chips[0].y).toBe(l.chips[1].y);expect(l.chips[2].y).toBeGreaterThan(l.chips[1].y);
  const long=layoutLegend({...key,width:100},[{...legends[0],name:'VeryLongArchitecturalCategoryWithoutSpaces'},...legends.slice(1)]);
  expect(long.height).toBeGreaterThan(layoutLegend(key,legends).height);expect(validPageLegend(key,legends)).toBe(true);
});
it.each([0,90,180,270])('exports embedded upright text and exact swatches with crop/UserUnit at %i',async rotation=>{
  const pdf=await PDFDocument.create(),p=pdf.addPage([400,400]);p.setCropBox(20,30,350,330);p.setRotation(degrees(rotation));p.node.set(PDFName.of('UserUnit'),pdf.context.obj(2));
  const bytes=await pdf.save(),snapshot=bytes.slice();const inputTask=getDocument({data:bytes.slice()}),input=await inputTask.promise;
  const page=await input.getPage(1),vp=page.getViewport({scale:1});
  const placed={...newPageLegend(1,vp,legends.map(l=>l.id),{x:40,y:40}),width:180,title:'Café – Стены'};
  const out=await generateAnnotatedPdf(bytes,{...base,pageLegends:[placed]},new Uint8Array(readFileSync('src/assets/LegendSans.ttf')));
  const resultTask=getDocument({data:out}),result=await resultTask.promise,rpage=await result.getPage(1);
  const text=await rpage.getTextContent();expect(text.items.map(i=>'str'in i?i.str:'').join('')).toContain('Café – Стены');
  for(const scale of [1,1.25]) {
    const viewport=rpage.getViewport({scale}),canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
    await rpage.render({canvas:canvas as never,viewport}).promise;
    const layout=layoutLegend(placed,legends),chip=layout.chips[0],raw=keyPoint(placed,chip.x+6,chip.y+6),[x,y]=viewport.convertToViewportPoint(raw.x,raw.y);
    expect([...canvas.getContext('2d').getImageData(Math.floor(x),Math.floor(y),1,1).data]).toEqual([74,222,128,255]);
  }
  expect(bytes).toEqual(snapshot);await inputTask.destroy();await resultTask.destroy();
});
