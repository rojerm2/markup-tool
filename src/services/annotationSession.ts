import type { Highlight } from '../types/annotation';
import { DEFAULT_DRAWING, type DrawingStyle } from '../components/Annotations/DrawingControls';

export type Legend = { id: string; name: string; color: string };
export type AnnotationSession = {
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
  | { type: 'create'; legend: Legend }
  | { type: 'rename'; id: string; name: string }
  | { type: 'delete'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'drawing'; drawing: DrawingStyle; manual: boolean }
  | { type: 'remove-stroke'; id: string }
  | { type: 'edit-stroke'; id: string; edit: { legendId: string | null } | { color: string } | { width: number } }
  | { type: 'move-stroke'; before: Highlight; points: Highlight['points']; legends: Legend[] }
  | { type: 'commit'; stroke: Highlight };

export function sessionReducer(state: AnnotationSession, action: SessionAction): AnnotationSession {
  switch (action.type) {
    case 'remove-stroke':
      return state.annotations.some(s => s.id === action.id)
        ? { ...state, annotations: state.annotations.filter(s => s.id !== action.id) } : state;
    case 'edit-stroke': {
      const before = state.annotations.find(s => s.id === action.id);
      if (!before) return state;
      let after: Highlight;
      if ('legendId' in action.edit) {
        const id = action.edit.legendId;
        const legend = state.legends.find(l => l.id === id);
        if (action.edit.legendId !== null && !legend) return state;
        after = { ...before, legendId: legend?.id ?? null, color: legend?.color ?? before.color };
      } else if ('color' in action.edit) {
        if (!/^#[0-9a-f]{6}$/.test(action.edit.color)) return state;
        after = { ...before, color: action.edit.color, legendId: null };
      } else {
        if (!Number.isFinite(action.edit.width) || action.edit.width < .01 || action.edit.width > 10000) return state;
        after = { ...before, width: action.edit.width };
      }
      return before.legendId === after.legendId && before.color === after.color && before.width === after.width ? state
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
      if (state.legends.some(item => item.id === action.legend.id) || legendNameError(state.legends, action.legend.name)) return state;
      return { ...state, legends: [...state.legends, { ...action.legend, name: action.legend.name.trim() }],
        activeLegendId: action.legend.id, drawing: { ...state.drawing, color: action.legend.color } };
    case 'rename':
      if (legendNameError(state.legends, action.name, action.id)) return state;
      return { ...state, legends: state.legends.map(item => item.id === action.id ? { ...item, name: action.name.trim() } : item) };
    case 'delete':
      return { ...state, legends: state.legends.filter(item => item.id !== action.id),
        activeLegendId: state.activeLegendId === action.id ? null : state.activeLegendId,
        annotations: state.annotations.map(stroke => stroke.legendId === action.id ? { ...stroke, legendId: null } : stroke) };
    case 'select': {
      const legend = state.legends.find(item => item.id === action.id);
      return { ...state, activeLegendId: legend?.id ?? null,
        drawing: legend ? { ...state.drawing, color: legend.color } : state.drawing };
    }
    case 'drawing':
      return { ...state, drawing: action.drawing, activeLegendId: action.manual ? null : state.activeLegendId };
    case 'commit':
      // Resolve against current session state, including deletion during a gesture.
      return { ...state, annotations: [...state.annotations, { ...action.stroke,
        legendId: state.legends.some(item => item.id === action.stroke.legendId) ? action.stroke.legendId : null }] };
  }
}
