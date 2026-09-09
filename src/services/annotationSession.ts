import { validNotes, type NoteObject } from './notes';
import { validShape, MAX_SHAPES, type Shape } from './shapes';
import { validRounding } from './highlightGeometry';
import { validPageLegend, legendTextError, textError, type PageLegend } from './pageLegend';
import type { Highlight } from '../types/annotation';
import { DEFAULT_DRAWING, type DrawingStyle } from '../components/Annotations/DrawingControls';

export type Legend = { id: string; name: string; color: string };
export type AnnotationSession = {
  notes?: NoteObject[];
  shapes?: Shape[];
  pageLegends?: PageLegend[];
  legends: Legend[];
  activeLegendId: string | null;
  annotations: Highlight[];
  drawing: DrawingStyle;
};
export const emptySession: AnnotationSession = {
  legends: [], activeLegendId: null, annotations: [], drawing: DEFAULT_DRAWING,
};
export function legendNameError(legends: Legend[], name: string, exceptId?: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a legend name.';
  if (trimmed.length > 256 || /[\u0000-\u001f]/.test(trimmed)) return 'Use up to 256 characters without control characters.';
  if (legends.some(legend => legend.id !== exceptId && legend.name.toLowerCase() === trimmed.toLowerCase()))
    return 'A legend with this name already exists.';
  return null;
}
export type SessionAction =
  | { type: 'put-note'; note: NoteObject; before?: NoteObject }
  | { type: 'remove-note'; id: string }
  | { type: 'put-shape'; shape: Shape; before?: Shape }
  | { type: 'remove-shape'; id: string }
  | { type: 'put-key'; key: PageLegend; before?: PageLegend; legends: Legend[] }
  | { type: 'remove-key'; id: string }
  | { type: 'create'; legend: Legend }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'drawing'; drawing: DrawingStyle; manual: boolean }
  | { type: 'remove-stroke'; id: string }
  | { type: 'edit-stroke'; id: string; edit: { legendId: string | null } | { color: string } | { width: number } | { rounding: number }; before?: Highlight }
  | { type: 'move-stroke'; before: Highlight; points: Highlight['points']; legends: Legend[] }
  | { type: 'commit'; stroke: Highlight };

const validColor = (color: string) => /^#[0-9a-f]{6}$/.test(color);
const validStyle = (style: DrawingStyle) => validRounding(style.rounding) && validColor(style.color) && Number.isFinite(style.width) && style.width >= .01 && style.width <= 10000 && Number.isFinite(style.opacity) && style.opacity >= .01 && style.opacity <= 1;

function withPageLegends(state: AnnotationSession, keys: PageLegend[]): AnnotationSession {
  if (keys.length) return { ...state, pageLegends: keys };
  const result = { ...state };
  delete result.pageLegends;
  return result;
}

export function sessionReducer(state: AnnotationSession, action: SessionAction): AnnotationSession {
  const noteIds=(state.notes??[]).flatMap(n=>[n.id,...(n.type==='text'?n.pointers.map(p=>p.id):[])]);
  switch (action.type) {
    case 'put-note': {
      const notes=state.notes??[], n=action.note;
      if(action.before ? !notes.includes(action.before)||action.before.id!==n.id||action.before.page!==n.page||action.before.type!==n.type : notes.some(v=>v.id===n.id))return state;
      const next=action.before?notes.map(v=>v===action.before?n:v):[...notes,n];
      if(!validNotes(next,[...state.legends,...state.annotations,...(state.shapes??[]),...(state.pageLegends??[])].map(v=>v.id)))return state;
      return {...state,notes:next};
    }
    case 'remove-note': {
      if(!state.notes?.some(n=>n.id===action.id))return state;
      const notes=state.notes.filter(n=>n.id!==action.id), next={...state};
      if(notes.length)next.notes=notes;else delete next.notes;return next;
    }
    case 'put-shape': {
      const shapes=state.shapes??[],s=action.shape;
      if(noteIds.includes(s.id)||!validShape(s)||state.legends.some(l=>l.id===s.id)||state.annotations.some(a=>a.id===s.id)||state.pageLegends?.some(k=>k.id===s.id)
        ||(action.before ? !shapes.includes(action.before)||action.before.id!==s.id||action.before.page!==s.page||action.before.type!==s.type : shapes.length>=MAX_SHAPES||shapes.some(a=>a.id===s.id)))return state;
      return {...state,shapes:action.before ? shapes.map(a=>a===action.before?s:a) : [...shapes,s]};
    }
    case 'remove-shape': {
      if(!state.shapes?.some(s=>s.id===action.id))return state;
      const shapes=state.shapes.filter(s=>s.id!==action.id),next={...state};
      if(shapes.length)next.shapes=shapes;else delete next.shapes;return next;
    }
    case 'put-key': {
      const keys = state.pageLegends ?? [];
      if (noteIds.includes(action.key.id) || action.legends !== state.legends || !validPageLegend(action.key,state.legends) || legendTextError(action.key,state.legends)
        || state.shapes?.some(s=>s.id===action.key.id) || state.annotations.some(s=>s.id===action.key.id)
        || (action.before ? !keys.includes(action.before) || action.before.id !== action.key.id : keys.some(k=>k.id===action.key.id) || keys.length >= 1000)) return state;
      return {...state,pageLegends:action.before ? keys.map(k=>k===action.before?action.key:k) : [...keys,action.key]};
    }
    case 'remove-key':
      return state.pageLegends?.some(k=>k.id===action.id) ? withPageLegends(state,state.pageLegends.filter(k=>k.id!==action.id)) : state;
    case 'remove-stroke':
      return state.annotations.some(s => s.id === action.id)
        ? { ...state, annotations: state.annotations.filter(s => s.id !== action.id) } : state;
    case 'edit-stroke': {
      const before = state.annotations.find(s => s.id === action.id);
      if (!before || action.before && action.before !== before) return state;
      let after: Highlight;
      if ('legendId' in action.edit) {
        const id = action.edit.legendId;
        const legend = state.legends.find(l => l.id === id);
        if (action.edit.legendId !== null && !legend) return state;
        after = { ...before, legendId: legend?.id ?? null, color: legend?.color ?? before.color };
      } else if ('color' in action.edit) {
        if (!/^#[0-9a-f]{6}$/.test(action.edit.color)) return state;
        after = { ...before, color: action.edit.color, legendId: null };
      } else if ('rounding' in action.edit) {
        if (!validRounding(action.edit.rounding)) return state;
        after = { ...before };
        if (action.edit.rounding === 100) delete after.rounding; else after.rounding = action.edit.rounding;
      } else {
        if (!Number.isFinite(action.edit.width) || action.edit.width < .01 || action.edit.width > 10000) return state;
        after = { ...before, width: action.edit.width };
      }
      return before.legendId === after.legendId && before.color === after.color && before.width === after.width && (before.rounding ?? 100) === (after.rounding ?? 100) ? state
        : { ...state, annotations: state.annotations.map(s => s === before ? after : s) };
    }
    case 'move-stroke': {
      // Reference guards also reject change-then-revert and deleted/recreated IDs.
      if (state.legends !== action.legends || !state.annotations.includes(action.before)
        || action.points.length !== action.before.points.length) return state;
      const dx = action.points[0].x-action.before.points[0].x, dy = action.points[0].y-action.before.points[0].y;
      if ((!dx && !dy) || action.points.some((p, i) => !Number.isFinite(p.x) || !Number.isFinite(p.y)
        || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9
        || Math.abs(p.x-(action.before.points[i].x+dx)) > 1e-7 || Math.abs(p.y-(action.before.points[i].y+dy)) > 1e-7)) return state;
      return { ...state, annotations: state.annotations.map(s => s === action.before ? { ...s, points: action.points } : s) };
    }
    case 'create':
      if (noteIds.includes(action.legend.id) || !action.legend.id || state.shapes?.some(s=>s.id===action.legend.id) || state.pageLegends?.some(k=>k.id===action.legend.id) || !validColor(action.legend.color) || state.legends.some(item => item.id === action.legend.id) || legendNameError(state.legends, action.legend.name)) return state;
      return { ...state, legends: [...state.legends, { ...action.legend, name: action.legend.name.trim() }],
        activeLegendId: action.legend.id, drawing: { ...state.drawing, color: action.legend.color } };
    case 'rename':
      if (legendNameError(state.legends, action.name, action.id)) return state;
      if (state.pageLegends?.some(k=>k.categoryIds.includes(action.id)) && textError(action.name.trim())) return state;
      return { ...state, legends: state.legends.map(item => item.id === action.id ? { ...item, name: action.name.trim() } : item) };
    case 'delete':
      return { ...withPageLegends(state,(state.pageLegends ?? []).map(k=>({...k,categoryIds:k.categoryIds.filter(id=>id!==action.id)})).filter(k=>k.categoryIds.length)), legends: state.legends.filter(item => item.id !== action.id),
        activeLegendId: state.activeLegendId === action.id ? null : state.activeLegendId,
        annotations: state.annotations.map(stroke => stroke.legendId === action.id ? { ...stroke, legendId: null } : stroke) };
    case 'select': {
      if (action.id !== null && !state.legends.some(item => item.id === action.id)) return state;
      const legend = state.legends.find(item => item.id === action.id);
      return { ...state, activeLegendId: legend?.id ?? null,
        drawing: legend ? { ...state.drawing, color: legend.color } : state.drawing };
    }
    case 'drawing':
      if (!validStyle(action.drawing) || (!action.manual && state.activeLegendId !== null
        && state.legends.find(l => l.id === state.activeLegendId)?.color !== action.drawing.color)) return state;
      return { ...state, drawing: action.drawing, activeLegendId: action.manual ? null : state.activeLegendId };
    case 'commit':
      if (noteIds.includes(action.stroke.id) || !action.stroke.id || state.shapes?.some(s=>s.id===action.stroke.id) || state.pageLegends?.some(k=>k.id===action.stroke.id) || state.annotations.some(s => s.id === action.stroke.id) || !validStyle(action.stroke)
        || action.stroke.type !== 'freehand' || !Number.isInteger(action.stroke.page) || action.stroke.page < 1
        || action.stroke.points.length < 2 || action.stroke.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 1e9 || Math.abs(p.y) > 1e9)) return state;
      // Resolve against current session state, including deletion during a gesture.
      return { ...state, annotations: [...state.annotations, { ...action.stroke,
        legendId: state.legends.some(item => item.id === action.stroke.legendId) ? action.stroke.legendId : null }] };
  }
}
