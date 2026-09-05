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
  | { type: 'commit'; stroke: Highlight };

export function sessionReducer(state: AnnotationSession, action: SessionAction): AnnotationSession {
  switch (action.type) {
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
