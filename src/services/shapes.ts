import { clientToPdf, pdfToClient, pdfWidthToViewport, type PageRect, type PageViewport, type Point } from './coordinates';
import { outlineContains, type PathCommand } from './highlightGeometry';

export type ShapeKind = 'rectangle' | 'ellipse' | 'line';
export type Shape = { id: string; type: ShapeKind; page: number; a: Point; b: Point; color: string; width: number; fill: string | null };
export const SHAPE_DEFAULTS = { color: '#38bdf8', width: 2, fill: null };
export const SHAPE_WIDTHS = [{name:'Thin',value:1},{name:'Medium',value:2},{name:'Thick',value:4}];
export const MAX_SHAPES = 10000;
export function validShape(s: Shape, pages = 10000): boolean {
  const point = (p: Point) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x) <= 1e9 && Math.abs(p.y) <= 1e9;
  const color = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/.test(v);
  return !!s && typeof s.id === 'string' && s.id.length > 0 && s.id.length <= 256 && !/[\u0000-\u001f]/.test(s.id)
    && ['rectangle','ellipse','line'].includes(s.type) && Number.isInteger(s.page) && s.page >= 1 && s.page <= pages
    && point(s.a) && point(s.b) && Number.isFinite(s.width) && s.width >= .01 && s.width <= 10000 && color(s.color)
    && (s.fill === null || s.type !== 'line' && color(s.fill))
    && Math.abs(s.a.x-s.b.x) <= 1e6 && Math.abs(s.a.y-s.b.y) <= 1e6
    && (s.type === 'line' ? Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y) >= .01 : Math.abs(s.b.x-s.a.x) >= .01 && Math.abs(s.b.y-s.a.y) >= .01);
}
export function shapePath(s: Shape): PathCommand[] {
  const x=Math.min(s.a.x,s.b.x),y=Math.min(s.a.y,s.b.y),w=Math.abs(s.b.x-s.a.x),h=Math.abs(s.b.y-s.a.y);
  if(s.type==='line')return [{op:'M',points:[s.a]},{op:'L',points:[s.b]}];
  if(s.type==='rectangle')return [{op:'M',points:[{x,y}]},{op:'L',points:[{x:x+w,y}]},{op:'L',points:[{x:x+w,y:y+h}]},{op:'L',points:[{x,y:y+h}]},{op:'Z',points:[]}];
  const cx=x+w/2,cy=y+h/2,rx=w/2,ry=h/2,k=.5522847498307936;
  return [{op:'M',points:[{x:cx+rx,y:cy}]},
    {op:'C',points:[{x:cx+rx,y:cy+k*ry},{x:cx+k*rx,y:cy+ry},{x:cx,y:cy+ry}]},
    {op:'C',points:[{x:cx-k*rx,y:cy+ry},{x:cx-rx,y:cy+k*ry},{x:cx-rx,y:cy}]},
    {op:'C',points:[{x:cx-rx,y:cy-k*ry},{x:cx-k*rx,y:cy-ry},{x:cx,y:cy-ry}]},
    {op:'C',points:[{x:cx+k*rx,y:cy-ry},{x:cx+rx,y:cy-k*ry},{x:cx+rx,y:cy}]},{op:'Z',points:[]}];
}
export function pickShape(shapes: Shape[], point: Point, rect: PageRect, viewport: PageViewport): Shape | null {
  const scale = pdfWidthToViewport(1,viewport) * rect.width / viewport.width;
  return [...shapes].reverse().find(s => outlineContains(shapePath(s).map(c=>({...c,points:c.points.map(p=>pdfToClient(p,rect,viewport))})), point, s.width*scale/2+5, s.fill !== null)) ?? null;
}
export function constrainedPoint(start: Point, end: Point, type: ShapeKind, shift: boolean, rect: PageRect, viewport: PageViewport): Point {
  if(!shift)return end;
  const a=pdfToClient(start,rect,viewport),b=pdfToClient(end,rect,viewport),dx=b.x-a.x,dy=b.y-a.y;
  let target:Point;
  if(type==='line'){const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4,length=Math.hypot(dx,dy);target={x:a.x+Math.cos(angle)*length,y:a.y+Math.sin(angle)*length};}
  else {const size=Math.max(Math.abs(dx),Math.abs(dy));target={x:a.x+(dx<0?-size:size),y:a.y+(dy<0?-size:size)};}
  return clientToPdf(target,rect,viewport);
}
export function shapeHandles(s: Shape): Point[] {
  return s.type==='line' ? [s.a,s.b] : [s.a,{x:s.b.x,y:s.a.y},s.b,{x:s.a.x,y:s.b.y}];
}
export function resizeShape(s: Shape, handle: number, end: Point, shift: boolean, rect: PageRect, viewport: PageViewport): Shape {
  if(s.type==='line') return handle===0 ? {...s,a:constrainedPoint(s.b,end,s.type,shift,rect,viewport)} : {...s,b:constrainedPoint(s.a,end,s.type,shift,rect,viewport)};
  const anchor=shapeHandles(s)[(handle+2)%4];
  const point=constrainedPoint(anchor,end,s.type,shift,rect,viewport);
  if(handle===0)return {...s,a:point};
  if(handle===2)return {...s,b:point};
  return handle===1 ? {...s,a:{...s.a,y:point.y},b:{...s.b,x:point.x}} : {...s,a:{...s.a,x:point.x},b:{...s.b,y:point.y}};
}
export const moveShape = (s: Shape, dx: number, dy: number): Shape => ({...s,a:{x:s.a.x+dx,y:s.a.y+dy},b:{x:s.b.x+dx,y:s.b.y+dy}});
