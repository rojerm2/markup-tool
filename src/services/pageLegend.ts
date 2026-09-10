import metrics from '../assets/legendMetrics.json';
import type { Legend } from './annotationSession';
import type { Point, PageViewport } from './coordinates';
import { viewportToPdf } from './coordinates';

export type PageLegend = {
  id: string; page: number; x: number; y: number; rotation: 0 | 90 | 180 | 270;
  categoryIds: string[]; title: string; layout: 'list' | 'columns';
  width: number; fontSize: number; background: boolean; border: boolean;
};
const widths: Record<string, number> = metrics;
export function textError(text: string): string | null {
  if (text.length > 256 || /[\u0000-\u001f]/.test(text)) return 'Use up to 256 characters without control characters.';
  const missing = [...text].find(c => widths[c.codePointAt(0)!] === undefined);
  return missing ? `The local legend font cannot render “${missing}”. Use Latin, Greek or Cyrillic text supported by the font, or omit this category from the page legend.` : null;
}
export const textWidth = (text: string, size: number) => [...text].reduce((n,c) => n + (widths[c.codePointAt(0)!] ?? .6)*size, 0);
export function validPageLegend(k: PageLegend, legends: Legend[], pages = 10000): boolean {
  return !!k && typeof k.id === 'string' && k.id.length > 0 && k.id.length <= 256 && !/[\u0000-\u001f]/.test(k.id)
    && !legends.some(l => l.id === k.id) && Number.isInteger(k.page) && k.page >= 1 && k.page <= pages
    && [k.x,k.y].every(n => Number.isFinite(n) && Math.abs(n) <= 1e9)
    && [0,90,180,270].includes(k.rotation) && ['list','columns'].includes(k.layout)
    && Number.isFinite(k.width) && k.width >= (k.layout==='columns'?140:100) && k.width <= 2000 && [10,12,16].includes(k.fontSize)
    && typeof k.background === 'boolean' && typeof k.border === 'boolean'
    && typeof k.title === 'string' && k.title.length <= 256 && !/[\u0000-\u001f]/.test(k.title)
    && Array.isArray(k.categoryIds) && k.categoryIds.length > 0 && k.categoryIds.length <= 1000
    && new Set(k.categoryIds).size === k.categoryIds.length && k.categoryIds.every(id => legends.some(l => l.id === id));
}
export function legendTextError(k: PageLegend, legends: Legend[]): string | null {
  return textError(k.title) ?? k.categoryIds.map(id => textError(legends.find(l => l.id === id)?.name ?? '')).find(Boolean) ?? null;
}
function wrap(text: string, width: number, size: number): string[] {
  const lines: string[] = []; let line = '';
  for (const word of text.split(' ')) {
    if (line && textWidth(`${line} ${word}`,size) <= width) { line += ` ${word}`; continue; }
    if (line) { lines.push(line); line = ''; }
    for (const c of word) { if (line && textWidth(line+c,size)>width) { lines.push(line); line=''; } line+=c; }
  }
  if (line) lines.push(line);
  return lines;
}
export function layoutLegend(k: PageLegend, legends: Legend[]) {
  const texts: {text:string;x:number;y:number}[] = [], chips: {x:number;y:number;color:string}[] = [];
  const pad=10, leading=k.fontSize*1.4, chip=k.fontSize, columns=k.layout==='columns'?2:1;
  const cell=(k.width-pad*2-(columns-1)*14)/columns;
  let y=pad;
  for(const line of wrap(k.title,k.width-pad*2,k.fontSize)) { texts.push({text:line,x:pad,y:y+k.fontSize}); y+=leading; }
  if(k.title) y+=6;
  for(let i=0;i<k.categoryIds.length;i+=columns) {
    let height=leading;
    for(let col=0;col<columns && i+col<k.categoryIds.length;col++) {
      const l=legends.find(l=>l.id===k.categoryIds[i+col]); if(!l) continue;
      const x=pad+col*(cell+14), lines=wrap(l.name,cell-chip-8,k.fontSize);
      chips.push({x,y:y+2,color:l.color});
      lines.forEach((text,n)=>texts.push({text,x:x+chip+8,y:y+k.fontSize+n*leading}));
      height=Math.max(height,lines.length*leading);
    }
    y+=height+6;
  }
  return {texts,chips,chip,height:y-6+pad};
}
// Local key coordinates run right/down; this matrix maps them to raw PDF space.
export function keyMatrix(k: Pick<PageLegend, 'x'|'y'|'rotation'>): [number,number,number,number,number,number] {
  const axes = {0:[1,0,0,-1],90:[0,1,1,0],180:[-1,0,0,1],270:[0,-1,-1,0]}[k.rotation];
  return [...axes,k.x,k.y] as [number,number,number,number,number,number];
}
export function keyPoint(k: PageLegend, x:number,y:number): Point {
  const [a,b,c,d,e,f]=keyMatrix(k);return {x:a*x+c*y+e,y:b*x+d*y+f};
}
export function newPageLegend(page:number, viewport:PageViewport, ids:string[], at={x:20,y:20}):PageLegend {
  const p=viewportToPdf(at,viewport);
  const unit=Math.hypot(viewport.transform[0],viewport.transform[1]);
  return {id:crypto.randomUUID(),page,...p,rotation:((viewport.rotation%360+360)%360) as PageLegend['rotation'],categoryIds:ids,
    title:'LEGEND',layout:'list',width:Math.max(100,Math.min(240,(viewport.width-40)/unit)),fontSize:12,background:true,border:true};
}
