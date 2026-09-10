import metrics from '../assets/legendMetrics.json';
import { keyMatrix, textWidth } from './pageLegend';
import type { Point } from './coordinates';
import type { PathCommand } from './highlightGeometry';

export type ArrowStyle = { color: string; width: number; head: number };
export type NotePointer = ArrowStyle & { id: string; target: Point };
export type TextNote = { id: string; type: 'text'; page: number; x: number; y: number; rotation: 0|90|180|270;
  width: number; height: number; fontSize: number; color: string; background: boolean; border: boolean; text: string; pointers: NotePointer[] };
export type Arrow = ArrowStyle & { id: string; type: 'arrow'; page: number; a: Point; b: Point };
export type NoteObject = TextNote | Arrow;
export const ARROW_DEFAULTS: ArrowStyle = { color: '#a87951', width: 2, head: 10 };
export const TEXT_DEFAULTS = { width: 200, height: 60, fontSize: 12, color: '#a87951', background: true, border: true, pointers: [] };
export const MAX_NOTES = 10000;
export const MAX_POINTERS = 32;
export const MAX_TOTAL_TEXT = 1000000;
const widths: Record<string, number> = metrics;
export function noteTextError(text: string): string | null {
  if (text.length > 4096) return 'Use at most 4096 characters per note.';
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text)) return 'Use spaces and line breaks; tabs and control characters are not supported.';
  const missing = [...text].find(c => c !== '\n' && widths[c.codePointAt(0)!] === undefined);
  return missing ? `The local font cannot render “${missing}”. Use supported Latin, Greek or Cyrillic characters.` : null;
}
// Preserve every space and explicit newline. Wrap at spaces when possible, otherwise at glyph boundaries.
export function layoutNote(n: Pick<TextNote, 'text'|'width'|'fontSize'>) {
  const lines: string[] = [], available = n.width - 16;
  for (const paragraph of n.text.split('\n')) {
    let rest = paragraph;
    while (textWidth(rest,n.fontSize) > available) {
      let count = 0, advance = 0;
      for (const c of rest) { if (advance + textWidth(c,n.fontSize) > available) break; advance += textWidth(c,n.fontSize); count += c.length; }
      count = Math.max(1,count);
      const space = rest.lastIndexOf(' ',count-1);
      if (space > 0) count = space+1;
      lines.push(rest.slice(0,count)); rest = rest.slice(count);
    }
    lines.push(rest);
  }
  return { lines, height: 16 + lines.length*n.fontSize*1.4 };
}
export const fitNote = (n: TextNote): TextNote => ({...n,height:Math.max(n.height,layoutNote(n).height)});
export function noteMatrix(n: TextNote) { return keyMatrix(n); }
export function notePoint(n: TextNote, x: number, y: number): Point {
  const [a,b,c,d,e,f]=noteMatrix(n); return {x:a*x+c*y+e,y:b*x+d*y+f};
}
export function noteLocal(n: TextNote, p: Point): Point {
  const [a,b,c,d]=noteMatrix(n),x=p.x-n.x,y=p.y-n.y; return {x:a*x+b*y,y:c*x+d*y};
}
export function pointerOrigin(n: TextNote, target: Point): Point | null {
  const p=noteLocal(n,target),cx=n.width/2,cy=n.height/2,dx=p.x-cx,dy=p.y-cy;
  // Inside and boundary targets have no visible leader, but retain their editable target.
  if (Math.abs(dx)<=cx && Math.abs(dy)<=cy) return null;
  const t=Math.min(dx===0?Infinity:cx/Math.abs(dx),dy===0?Infinity:cy/Math.abs(dy));
  return notePoint(n,cx+dx*t,cy+dy*t);
}
export function arrowGeometry(a: Point, b: Point, style: ArrowStyle): {shaft: PathCommand[]; head: PathCommand[]} {
  const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
  if (!Number.isFinite(length)||length<.01) return {shaft:[],head:[]};
  const ux=dx/length,uy=dy/length,h=Math.min(style.head,length*.8),base={x:b.x-ux*h,y:b.y-uy*h};
  return {shaft:[{op:'M',points:[a]},{op:'L',points:[h ? base : b]}],head:h ? [
    {op:'M',points:[b]},{op:'L',points:[{x:base.x-uy*h*.4,y:base.y+ux*h*.4}]},
    {op:'L',points:[{x:base.x+uy*h*.4,y:base.y-ux*h*.4}]},{op:'Z',points:[]}] : []};
}
const point = (p: Point) => !!p && [p.x,p.y].every(v=>Number.isFinite(v)&&Math.abs(v)<=1e9);
const id = (v: string) => typeof v==='string' && v.length>0 && v.length<=256 && !/[\u0000-\u001f]/.test(v);
const color = (v: string) => typeof v==='string' && /^#[0-9a-f]{6}$/.test(v);
const style = (v: ArrowStyle) => color(v.color)&&Number.isFinite(v.width)&&v.width>=.25&&v.width<=20&&Number.isFinite(v.head)&&v.head>=0&&v.head<=100;
export function validNote(n: NoteObject, pages=10000): boolean {
  if (!n||!id(n.id)||!Number.isInteger(n.page)||n.page<1||n.page>pages) return false;
  if(n.type==='arrow') return Object.keys(n).every(k=>['id','type','page','a','b','color','width','head'].includes(k))&&point(n.a)&&point(n.b)&&style(n)&&Math.hypot(n.a.x-n.b.x,n.a.y-n.b.y)>=.01&&Math.hypot(n.a.x-n.b.x,n.a.y-n.b.y)<=1e6;
  return n.type==='text'&&Object.keys(n).every(k=>['id','type','page','x','y','rotation','width','height','fontSize','color','background','border','text','pointers'].includes(k))&&point(n)&&[0,90,180,270].includes(n.rotation)&&color(n.color)
    &&Number.isFinite(n.width)&&n.width>=40&&n.width<=2000&&Number.isFinite(n.height)&&n.height>=30&&n.height<=10000
    &&[10,12,16,20].includes(n.fontSize)&&typeof n.background==='boolean'&&typeof n.border==='boolean'
    &&typeof n.text==='string'&&!!n.text.trim()&&!noteTextError(n.text)&&layoutNote(n).height<=n.height+1e-7
    &&Array.isArray(n.pointers)&&n.pointers.length<=MAX_POINTERS&&n.pointers.every(p=>!!p&&id(p.id)&&point(p.target)&&style(p)&&Math.hypot(p.target.x-n.x,p.target.y-n.y)<=1e6&&Object.keys(p).every(k=>['id','target','color','width','head'].includes(k)));
}
export function validNotes(notes: NoteObject[], reserved: string[]=[], pages=10000): boolean {
  if (notes.length>MAX_NOTES) return false;
  const ids=new Set(reserved); let text=0;
  for(const n of notes) {
    if(!validNote(n,pages))return false;
    for(const value of [n.id,...(n.type==='text'?n.pointers.map(p=>p.id):[])]) {if(ids.has(value))return false;ids.add(value);}
    if(n.type==='text')text+=n.text.length;
  }
  return text<=MAX_TOTAL_TEXT;
}
export function moveNote(n: NoteObject, dx: number, dy: number): NoteObject {
  return n.type==='text'?{...n,x:n.x+dx,y:n.y+dy}:{...n,a:{x:n.a.x+dx,y:n.a.y+dy},b:{x:n.b.x+dx,y:n.b.y+dy}};
}
