import { ARROW_DEFAULTS, TEXT_DEFAULTS, MAX_NOTES, validNotes, type NoteObject } from './notes';
import { validShape, MAX_SHAPES, SHAPE_DEFAULTS, type Shape } from './shapes';
import { validPageLegend, type PageLegend } from './pageLegend';
import type { AnnotationSession } from './annotationSession';

export const MAX_PROJECT_BYTES = 16 * 1024 * 1024;
export type SourceIdentity = { reference: string; filename: string; sha256: string; size: number; pages: number };
export type Project = { format: 'pdf-markup-project'; version: 2; source: SourceIdentity; session: AnnotationSession };
const fail = (field: string): never => { throw new Error(`Invalid project: ${field}.`); };
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(field);
  return value as Record<string, unknown>;
}
function string(value: unknown, field: string, max = 256): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f]/.test(value)) return fail(field);
  return value;
}
function number(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) return fail(field);
  return value;
}
function integer(value: unknown, field: string, min: number, max: number): number {
  const result = number(value, field, min, max);
  return Number.isInteger(result) ? result : fail(field);
}
function color(value: unknown): string {
  const result = string(value, 'color', 7);
  return /^#[0-9a-f]{6}$/.test(result) ? result : fail('color (lowercase #rrggbb required)');
}
function array(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(field);
  return value;
}
function style(value: unknown) {
  const v = object(value, 'drawing style');
  return { ...(v.rounding === undefined || v.rounding === 100 ? {} : {rounding: number(v.rounding, 'rounding', 0, 100)}), color: color(v.color), width: number(v.width, 'width', 0.01, 10000), opacity: number(v.opacity, 'opacity', 0.01, 1) };
}
export function parseProject(text: string): Project {
  if (new TextEncoder().encode(text).length > MAX_PROJECT_BYTES) return fail('file exceeds 16 MiB');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail('JSON syntax'); }
  const root = object(raw, 'root');
  if (root.format !== 'pdf-markup-project') return fail('format');
  if (root.version !== 1 && root.version !== 2) return fail('unsupported version');
  const source = object(root.source, 'source');
  const sha256 = string(source.sha256, 'source hash', 64);
  if (!/^[0-9a-f]{64}$/.test(sha256)) return fail('source SHA-256');
  const identity: SourceIdentity = { reference: string(source.reference, 'source reference', 32768),
    filename: string(source.filename, 'source filename', 1024), sha256,
    size: integer(source.size, 'source size', 1, 1024 * 1024 * 1024), pages: integer(source.pages, 'page count', 1, 10000) };
  const session = object(root.session, 'session');
  const ids = new Set<string>(), names = new Set<string>();
  const legends = array(session.legends, 'legends', 1000).map(item => {
    const legend = object(item, 'legend');
    const id = string(legend.id, 'legend ID'), name = string(legend.name, 'legend name');
    if (ids.has(id) || name.trim() !== name || !name.trim() || names.has(name.toLowerCase())) return fail('duplicate ID or invalid/duplicate legend name');
    ids.add(id); names.add(name.toLowerCase());
    return { id, name, color: color(legend.color) };
  });
  const relationship = (id: unknown): string | null => id === null ? null :
    typeof id === 'string' && ids.has(id) ? id : fail('legend relationship');
  const annotationIds = new Set<string>(); let points = 0;
  const annotations = array(session.annotations, 'annotations', 100000).map(item => {
    const stroke = object(item, 'annotation'); const id = string(stroke.id, 'annotation ID');
    if (annotationIds.has(id) || stroke.type !== 'freehand') return fail('duplicate annotation ID or unsupported type');
    annotationIds.add(id);
    const geometry = array(stroke.points, 'points', 100000);
    points += geometry.length;
    if (geometry.length < 2 || points > 1000000) return fail('point count');
    return { id, type: 'freehand' as const, page: integer(stroke.page, 'annotation page', 1, identity.pages),
      legendId: relationship(stroke.legendId), ...style(stroke), points: geometry.map(item => {
        const p = object(item, 'point'); return { x: number(p.x, 'point x', -1e9, 1e9), y: number(p.y, 'point y', -1e9, 1e9) };
      }) };
  });
  const pageLegends = root.version === 1 ? [] : array(session.pageLegends ?? [], 'page legends', 1000).map(item => {
    const value = object(item, 'page legend');
    const k = {title:'LEGEND',layout:'list',fontSize:12,width:240,background:true,border:true,...value} as PageLegend;
    if (!validPageLegend(k,legends,identity.pages) || annotationIds.has(k.id)) return fail('page legend geometry, layout or references');
    annotationIds.add(k.id);
    return {id:k.id,page:k.page,x:k.x,y:k.y,rotation:k.rotation,categoryIds:[...k.categoryIds],title:k.title,layout:k.layout,width:k.width,fontSize:k.fontSize,background:k.background,border:k.border};
  });
  const shapes = root.version === 1 ? [] : array(session.shapes ?? [], 'shapes', MAX_SHAPES).map(item => {
    const value = object(item, 'shape'), s = {...SHAPE_DEFAULTS,...value} as Shape;
    if(!validShape(s,identity.pages)||ids.has(s.id)||annotationIds.has(s.id))return fail('shape geometry, style or ID');
    annotationIds.add(s.id);
    return {id:s.id,type:s.type,page:s.page,a:{x:s.a.x,y:s.a.y},b:{x:s.b.x,y:s.b.y},color:s.color,width:s.width,fill:s.fill};
  });
  const notes = root.version===1 ? [] : array(session.notes??[], 'notes', MAX_NOTES).map(item=> {
    const value=object(item,'note');
    if(value.type==='arrow')return {...ARROW_DEFAULTS,...value} as NoteObject;
    const n: Record<string,unknown>={...TEXT_DEFAULTS,...value};
    n.pointers=array(n.pointers,'note pointers',32).map(p=>({...ARROW_DEFAULTS,...object(p,'pointer')}));
    return n as NoteObject;
  });
  if(!validNotes(notes,[...ids,...annotationIds],identity.pages))return fail('note text, geometry, pointers or duplicate IDs');
  const drawing = style(session.drawing), activeLegendId = relationship(session.activeLegendId);
  if (activeLegendId !== null && legends.find(l => l.id === activeLegendId)!.color !== drawing.color) return fail('active legend/drawing color');
  return { format: 'pdf-markup-project', version: 2, source: identity, session: { ...(notes.length?{notes}:{}), legends, annotations, drawing, activeLegendId, ...(shapes.length ? {shapes} : {}), ...(pageLegends.length ? {pageLegends} : {}) } };
}
export function serializeProject(source: SourceIdentity, session: AnnotationSession): string {
  const text = JSON.stringify({ format: 'pdf-markup-project', version: 2, source, session });
  parseProject(text);
  return text;
}
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function sameSource(expected: SourceIdentity, actual: SourceIdentity): boolean {
  return expected.sha256 === actual.sha256 && expected.size === actual.size && expected.pages === actual.pages;
}
