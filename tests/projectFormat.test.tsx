import { describe, expect, it } from 'vitest';
import { emptySession, sessionReducer } from '../src/services/annotationSession';
import { parseProject, serializeProject, sameSource, type SourceIdentity } from '../src/services/projectFormat';
export const source: SourceIdentity = { reference: 'plans/原本.pdf', filename: '原本.pdf', sha256: 'a'.repeat(64), size: 1234, pages: 2 };
export function fixture() {
  let session = sessionReducer(emptySession, { type: 'create', legend: { id: 'wall', name: 'Walls', color: '#facc15' } });
  session = sessionReducer(session, { type: 'create', legend: { id: 'door', name: 'Doors', color: '#facc15' } });
  for (const [i, legendId] of ['wall', 'door', null].entries()) session = sessionReducer(session, { type: 'commit', stroke: {
    id: `s${i}`, legendId, page: i === 2 ? 2 : 1, type: 'freehand', color: '#facc15', opacity: 0.4, width: 20,
    points: i === 1 ? [{ x: -20.5, y: 30 }, { x: 42, y: 60 }, { x: 88, y: 25 }] : [{ x: 10, y: 20 }, { x: 30, y: 40 }],
  } });
  return { format: 'pdf-markup-project' as const, version: 1 as const, source, session };
}
it('round trips mixed multipage vectors, stable relationships/order and settings; continued edits remain independent', () => {
  const value = fixture(); const restored = parseProject(serializeProject(value.source, value.session));
  expect(restored).toEqual({...value,version:2});
  const detached = sessionReducer(restored.session, { type: 'delete', id: 'door' });
  expect(detached.annotations.map(s => s.legendId)).toEqual(['wall', null, null]);
  expect(detached.annotations.map(s => s.points)).toEqual(value.session.annotations.map(s => s.points));
  expect(value.session.annotations[1].legendId).toBe('door');
  expect(parseProject(serializeProject(source, emptySession)).session).toEqual(emptySession);
});
describe('runtime validation', () => {
  const cases: [string, (v: ReturnType<typeof fixture>) => void][] = [
    ['version', v => { v.version = 3 as 1; }], ['format', v => { v.format = 'other' as typeof v.format; }],
    ['duplicate legends', v => { v.session.legends.push(v.session.legends[0]); }],
    ['duplicate names', v => { v.session.legends[1].name = 'WALLS'; }],
    ['blank name', v => { v.session.legends[0].name = ' '; }], ['untrimmed', v => { v.session.legends[0].name = ' Walls'; }],
    ['duplicate strokes', v => { v.session.annotations.push(v.session.annotations[0]); }],
    ['page zero', v => { v.session.annotations[0].page = 0; }], ['out of range', v => { v.session.annotations[0].page = 3; }],
    ['fractional page', v => { v.session.annotations[0].page = 1.5; }],
    ['dangling annotation', v => { v.session.annotations[0].legendId = 'missing'; }],
    ['dangling active', v => { v.session.activeLegendId = 'missing'; }],
    ['inconsistent drawing', v => { v.session.drawing.color = '#38bdf8'; }],
    ['color injection', v => { v.session.annotations[0].color = 'url(#x)'; }],
    ['opacity', v => { v.session.drawing.opacity = 2; }], ['width', v => { v.session.drawing.width = 0; }],
    ['nonfinite point', v => { v.session.annotations[0].points[0].x = Infinity; }],
    ['short geometry', v => { v.session.annotations[0].points = []; }],
    ['hash', v => { v.source = { ...v.source, sha256: 'no' }; }],
    ['type', v => { v.session.annotations[0].type = 'line' as 'freehand'; }],
  ];
  it.each(cases)('rejects %s without changing live data', (_, mutate) => {
    const value = structuredClone(fixture()); mutate(value);
    expect(() => parseProject(JSON.stringify(value))).toThrow(/Invalid project/);
  });
  it('rejects missing fields, invalid JSON and input/count bounds', () => {
    for (const text of ['{', '{}', 'null', '[]', ' '.repeat(16 * 1024 * 1024 + 1)]) expect(() => parseProject(text)).toThrow();
    const value = fixture(); value.session.legends = Array.from({ length: 1001 }, (_, i) => ({ id: `${i}`, name: `${i}`, color: '#facc15' }));
    expect(() => parseProject(JSON.stringify(value))).toThrow(/legends/);
  });
});
it('relocation ignores path/name but rejects changed content, size or page count', () => {
  expect(sameSource(source, { ...source, reference: 'D:\\different\\x.pdf', filename: 'x.pdf' })).toBe(true);
  for (const changed of [{ sha256: 'b'.repeat(64) }, { size: 1 }, { pages: 1 }]) expect(sameSource(source, { ...source, ...changed })).toBe(false);
});
