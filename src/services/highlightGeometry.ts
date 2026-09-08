import type { Highlight } from '../types/annotation';
import type { Point } from './coordinates';

export type PathCommand = { op: 'M' | 'L' | 'C' | 'Z'; points: Point[] };
export const validRounding = (value: unknown): boolean => value === undefined || typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const add = (a: Point, b: Point, scale = 1): Point => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

// Minkowski sum of a convex core and a radius-r disk. All subpaths wind CCW,
// so the nonzero fill is their union, including crossings and reversals.
function expandedPolygon(vertices: Point[], radius: number): PathCommand[] {
  vertices=vertices.filter((p,i)=>{const previous=vertices[(i+vertices.length-1)%vertices.length];return p.x!==previous.x||p.y!==previous.y;});
  if(vertices.length<2)return [];
  let area = 0;
  const origin=vertices[0];
  vertices.forEach((a, i) => { const b=vertices[(i + 1) % vertices.length]; area += cross({x:a.x-origin.x,y:a.y-origin.y},{x:b.x-origin.x,y:b.y-origin.y}); });
  if (area < 0) vertices = [...vertices].reverse();
  const normals = vertices.map((a, i) => {
    const b = vertices[(i + 1) % vertices.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.y - a.y) / length, y: (a.x - b.x) / length };
  });
  const result: PathCommand[] = [];
  vertices.forEach((v, i) => {
    const previous = normals[(i + normals.length - 1) % normals.length], next = normals[i];
    const start = add(v, previous, radius);
    result.push({ op: i ? 'L' : 'M', points: [start] });
    if (!radius) return;
    let angle = Math.atan2(previous.y, previous.x), sweep = Math.atan2(cross(previous, next), previous.x * next.x + previous.y * next.y);
    if (sweep < 0) sweep += Math.PI * 2;
    const steps = Math.ceil(sweep / (Math.PI / 2));
    for (let j = 0; j < steps; j++) {
      const end = angle + sweep / steps, k = 4 / 3 * Math.tan((end - angle) / 4);
      result.push({ op: 'C', points: [
        { x: v.x + radius * (Math.cos(angle) - k * Math.sin(angle)), y: v.y + radius * (Math.sin(angle) + k * Math.cos(angle)) },
        { x: v.x + radius * (Math.cos(end) + k * Math.sin(end)), y: v.y + radius * (Math.sin(end) - k * Math.cos(end)) },
        { x: v.x + radius * Math.cos(end), y: v.y + radius * Math.sin(end) },
      ] });
      angle = end;
    }
  });
  result.push({ op: 'Z', points: [] });
  return result;
}

export function highlightOutline(stroke: Highlight): PathCommand[] {
  const half = stroke.width / 2, radius = half * (stroke.rounding ?? 100) / 100, core = half - radius;
  // Fully round strokes use the original native path in production.
  if (core <= 0) return [];
  const origin=stroke.points[0]??{x:0,y:0};
  const points = stroke.points.map(p=>({x:p.x-origin.x,y:p.y-origin.y})).filter((p, i, all) => !i || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
  const paths: PathCommand[] = [];
  const directions: Point[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, n = { x: -d.y * core, y: d.x * core };
    directions.push(d);
    paths.push(...expandedPolygon([add(a, n), add(b, n), add(b, n, -1), add(a, n, -1)], radius));
  }
  for (let i = 1; i < directions.length; i++) {
    const a = directions[i - 1], b = directions[i], turn = cross(a, b);
    if (Math.abs(turn) < 1e-10) continue;
    const side = turn > 0 ? -1 : 1, v = points[i];
    const n1 = { x: -a.y * core * side, y: a.x * core * side }, n2 = { x: -b.y * core * side, y: b.x * core * side };
    const p = add(v, n1), q = add(v, n2), t = cross({ x: q.x - p.x, y: q.y - p.y }, b) / turn;
    const miter = add(p, a, t);
    const vertices = Math.hypot(miter.x - v.x, miter.y - v.y) <= 2 * core ? [v, p, miter, q] : [v, p, q];
    paths.push(...expandedPolygon(vertices, radius));
  }
  return paths.map(c=>({...c,points:c.points.map(p=>add(p,origin))}));
}

export function svgPath(path: PathCommand[], project: (p: Point) => Point = p => p): string {
  return path.map(c => c.op + c.points.map(p => { const q = project(p); return `${q.x} ${q.y}`; }).join(' ')).join(' ');
}

// Picking uses the same cubic outline, flattened to <=0.05 raw-unit chord error.
export function outlineContains(path: PathCommand[], point: Point, tolerance: number, filled = true): boolean {
  let start = point, previous = point, winding = 0, near = false;
  const edge = (a: Point, b: Point) => {
    const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
    const t = d2 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / d2)) : 0;
    if (Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <= tolerance) near = true;
    const side = dx * (point.y - a.y) - (point.x - a.x) * dy;
    if (a.y <= point.y && b.y > point.y && side > 0) winding++;
    if (a.y > point.y && b.y <= point.y && side < 0) winding--;
  };
  for (const c of path) {
    if (c.op === 'M') { start = previous = c.points[0]; }
    else if (c.op === 'Z') { edge(previous, start); previous = start; }
    else if (c.op === 'L') { edge(previous, c.points[0]); previous = c.points[0]; }
    else {
      const a = previous, [b, d, e] = c.points;
      const length = Math.hypot(b.x-a.x,b.y-a.y)+Math.hypot(d.x-b.x,d.y-b.y)+Math.hypot(e.x-d.x,e.y-d.y);
      const steps = Math.max(8, Math.min(512, Math.ceil(Math.sqrt(length / .01))));
      for (let i = 1; i <= steps; i++) { const t=i/steps,u=1-t,q={x:u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*d.x+t*t*t*e.x,y:u*u*u*a.y+3*u*u*t*b.y+3*u*t*t*d.y+t*t*t*e.y};edge(previous,q);previous=q; }
    }
  }
  return near || filled && winding !== 0;
}
