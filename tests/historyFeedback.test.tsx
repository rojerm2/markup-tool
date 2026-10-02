import { expect, it } from 'vitest';
import { historyChangeRegions } from '../src/services/historyFeedback';
import { emptySession } from '../src/services/annotationSession';
import type { Highlight } from '../src/types/annotation';
import { TEXT_DEFAULTS } from '../src/services/notes';

const stroke: Highlight = { id: 'a', page: 2, type: 'freehand', legendId: null, color: '#facc15', opacity: .4, width: 10, points: [{ x: 20, y: 40 }, { x: 100, y: 40 }] };
it('locates deleted highlights and both positions of a moved highlight without changing saved data', () => {
  const before = { ...emptySession, annotations: [stroke] }, snapshot = JSON.stringify(before);
  expect(historyChangeRegions(before, emptySession)).toEqual([{ page: 2, x: 11, y: 31, width: 98, height: 18 }]);
  const moved = { ...stroke, points: stroke.points.map(p => ({ x: p.x + 200, y: p.y + 100 })) };
  const regions = historyChangeRegions(before, { ...before, annotations: [moved] });
  expect(regions).toHaveLength(2); expect(regions[1].x).toBe(211);
  expect(JSON.stringify(before)).toBe(snapshot);
  expect(historyChangeRegions(before, { ...before, drawing: { ...before.drawing, width: 80 } })).toEqual([]);
});
it('includes rotated text, arrows, shapes, and changed page-legend contents', () => {
  const legend = { id: 'l', name: 'Walls', color: '#facc15' };
  const before = { ...emptySession, legends: [legend],
    notes: [{ ...TEXT_DEFAULTS, id: 'note', type: 'text' as const, page: 1, x: 100, y: 200, rotation: 90 as const, text: 'Hello' }],
    shapes: [{ id: 'shape', type: 'line' as const, page: 3, a: { x: 10, y: 20 }, b: { x: 30, y: 40 }, color: '#38bdf8', width: 2, fill: null }],
    pageLegends: [{ id: 'key', page: 4, x: 20, y: 30, rotation: 0 as const, width: 160, fontSize: 12 as const, title: '', background: true, border: true, layout: 'list' as const, categoryIds: ['l'] }],
  };
  expect(historyChangeRegions(before, emptySession).map(r => r.page)).toEqual([3, 1, 4]);
  const regions = historyChangeRegions(before, { ...before, legends: [{ ...legend, name: 'Doors' }] });
  expect(regions.map(r => r.page)).toEqual([4, 4]);
});
it('handles very long freehand paths without exceeding function argument limits', () => {
  const long = { ...stroke, points: Array.from({ length: 150000 }, (_, x) => ({ x, y: 40 })) };
  expect(historyChangeRegions({ ...emptySession, annotations: [long] }, emptySession)[0].width).toBe(150017);
});
