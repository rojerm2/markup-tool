// @vitest-environment node
import { expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFDict, PDFRawStream, decodePDFRawStream, degrees } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { generateAnnotatedPdf } from '../src/services/pdfExport';
import { emptySession } from '../src/services/annotationSession';
import type { Highlight } from '../src/types/annotation';

// Node Skia/PDF.js transparency groups quantize alpha differently from browser SVG
// by one channel level. Exact interiors below also prove overlap equals one stroke.
const line = (id: string, points: Highlight['points'], extra: Partial<Highlight> = {}): Highlight => ({ id, points, page: 1, type: 'freehand', legendId: null, color: '#facc15', opacity: 0.4, width: 10, ...extra });
async function fixture(rotation = 0, unit = 1) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const page = pdf.addPage([300, 200]);
    page.setMediaBox(-20, -10, 300, 200); page.setCropBox(-10.5, 10.25, 200, 150);
    page.setRotation(degrees(rotation)); page.node.set(PDFName.of('UserUnit'), pdf.context.obj(unit));
  }
  return pdf.save();
}
async function raster(bytes: Uint8Array, scale = 1, pageNumber = 1) {
  const task = getDocument({ data: bytes.slice() }); const pdf = await task.promise;
  const page = await pdf.getPage(pageNumber); const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({canvas: canvas as never, canvasContext: canvas.getContext('2d') as never, viewport}).promise;
  const pixel = (x:number,y:number) => Array.from(canvas.getContext('2d').getImageData(x,y,1,1).data);
  return { task, pdf, page, viewport, pixel };
}
it('no annotations retains all page geometry and leaves source/session unchanged', async () => {
  const source = await fixture(90, 2), before = source.slice();
  const session = structuredClone(emptySession), snapshot = structuredClone(session);
  const bytes = await generateAnnotatedPdf(source, session); const r = await raster(bytes);
  try { expect(r.pdf.numPages).toBe(2); expect(r.page.view).toEqual([-10.5,10.25,189.5,160.25]); expect(r.page.rotate).toBe(90); expect(r.page.userUnit).toBe(2); expect(r.pixel(20,20)).toEqual([255,255,255,255]); }
  finally { await r.task.destroy(); }
  expect(source).toEqual(before); expect(session).toEqual(snapshot);
});
it.each([0,90,180,270])('actual PDF.js pixels preserve raw fractional crop/rotation/UserUnit at %i', async rotation => {
  const source = await fixture(rotation,2);
  const stroke = line('a',[{x:-30.25,y:60.25},{x:120.5,y:60.25}]);
  const session = {...emptySession, annotations:[stroke,{...stroke,id:'b',legendId:'wall'},line('self',[{x:40,y:30},{x:40,y:100},{x:70,y:100},{x:40,y:30}])]};
  const snapshot = structuredClone(session); const bytes = await generateAnnotatedPdf(source,session);
  for (const scale of [1,1.25,2]) {
    const r = await raster(bytes,scale);
    try {
      // Independent mapping from CropBox and quarter rotation, including UserUnit.
      const x=60.5,y=60.25, w=200,h=150,u=x+10.5,v=y-10.25;
      const expected = rotation===0?[u,h-v]:rotation===90?[v,u]:rotation===180?[w-u,v]:[h-v,w-u];
      expect(r.viewport.convertToViewportPoint(x,y)).toEqual(expected.map(n=>n*2*scale));
      expect(r.pixel(...expected.map(n=>Math.floor(n*2*scale)) as [number,number])).toEqual([253,235,162,255]);
      const cross=r.viewport.convertToViewportPoint(40,60.25); expect(r.pixel(Math.floor(cross[0]),Math.floor(cross[1]))).toEqual([253,235,162,255]);
      const empty=r.viewport.convertToViewportPoint(150,120); expect(r.pixel(Math.floor(empty[0]),Math.floor(empty[1]))).toEqual([255,255,255,255]);
    } finally { await r.task.destroy(); }
  }
  expect(session).toEqual(snapshot);
});
it('first-color layer ordering, separate opacity groups and page assignment survive actual PDF rendering', async () => {
  const source=await fixture(); const yellow=line('a',[{x:20,y:60},{x:150,y:60}]);
  const blue=line('b',[{x:60,y:30},{x:60,y:120}],{color:'#38bdf8'});
  const bytes=await generateAnnotatedPdf(source,{...emptySession,annotations:[yellow,blue,{...yellow,id:'repeat'}, {...yellow,id:'page2',page:2}]});
  for (const n of [1,2]) { const r=await raster(bytes,1,n); try {
    const at=(x:number,y:number)=>{const p=r.viewport.convertToViewportPoint(x,y);return r.pixel(Math.floor(p[0]),Math.floor(p[1]));};
    expect(at(30,60)).toEqual([253,235,162,255]);
    expect(at(60,60)).toEqual(n===1?[175,217,196,255]:[253,235,162,255]);
  }finally{await r.task.destroy();} }
});

it('serialized forms retain exact path numbers, round joins/caps, isolated grouping and opacity', async () => {
  const source=await fixture();
  const stroke=line('a',[{x:-30.125,y:60.25},{x:120.5,y:60.25}],{width:10.125});
  const bytes=await generateAnnotatedPdf(source,{...emptySession,annotations:[stroke,{...stroke,id:'b'}, {...stroke,id:'c',opacity:0.6}]});
  const pdf=await PDFDocument.load(bytes);const resources=pdf.getPage(0).node.Resources()!;
  const states=resources.lookup(PDFName.of('ExtGState'),PDFDict).values().map(ref=>pdf.context.lookup(ref,PDFDict));
  expect(states.map(state=>state.get(PDFName.of('CA'))?.toString())).toEqual(['0.4','0.6']);
  const forms=resources.lookup(PDFName.of('XObject'),PDFDict).values().map(ref=>pdf.context.lookup(ref,PDFRawStream));
  expect(forms).toHaveLength(2);
  for(const form of forms) {
    const group=form.dict.lookup(PDFName.of('Group'),PDFDict);
    expect(group.get(PDFName.of('I'))?.toString()).toBe('true');expect(group.get(PDFName.of('K'))?.toString()).toBe('false');
    expect(form.dict.get(PDFName.of('BBox'))?.toString()).toBe('[ -10.5 10.25 189.5 160.25 ]');
    const commands=new TextDecoder().decode(decodePDFRawStream(form).decode());
    expect(commands).toContain('1 J 1 j');expect(commands).toContain('10.125 w');expect(commands).toContain('-30.125 60.25 m');expect(commands).toContain('120.5 60.25 l');expect(commands).not.toContain(' gs');
  }
});
