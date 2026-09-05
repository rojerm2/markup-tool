import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import AnnotationOverlay from '../src/components/Annotations/AnnotationOverlay';
import type { Highlight } from '../src/types/annotation';
import type { PageViewport } from '../src/services/coordinates';

let captured: number | null;
function viewport(scale = 1, rotation = 0): PageViewport {
  // CropBox [20,30,220,130], with independent expected affine maps.
  const matrices: Record<number, number[]> = { 0: [1,0,0,-1,-20,130], 90: [0,1,1,0,-30,-20], 180: [-1,0,0,1,220,-30], 270: [0,-1,-1,0,130,220] };
  const [a,b,c,d,e,f] = matrices[rotation].map(n => n * scale);
  return { width: (rotation % 180 ? 100 : 200) * scale, height: (rotation % 180 ? 200 : 100) * scale,
    transform: [a,b,c,d,e,f],
    convertToViewportPoint: (x: number, y: number) => [a*x+c*y+e,b*x+d*y+f],
    convertToPdfPoint: (x: number, y: number) => [(d*(x-e)-c*(y-f))/(a*d-b*c),(-b*(x-e)+a*(y-f))/(a*d-b*c)],
  } as PageViewport;
}
beforeEach(() => {
  captured = null;
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; } });
  Object.defineProperties(SVGElement.prototype, {
    setPointerCapture: { configurable: true, value: (id: number) => { captured = id; } },
    hasPointerCapture: { configurable: true, value: (id: number) => captured === id },
    releasePointerCapture: { configurable: true, value: () => { captured = null; } },
  });
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: SVGElement) {
    const width = Number(this.getAttribute('width')), height = Number(this.getAttribute('height'));
    return { left: 50, top: 70, right: 50+width, bottom: 70+height, width, height } as DOMRect;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function draw(svg: Element) {
  fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: 70, clientY: 90 });
  fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 90, clientY: 110 });
  fireEvent.pointerUp(svg, { pointerId: 4, clientX: 100, clientY: 120 });
}
it.each([0,90,180,270])('stores raw cropped points and projects unchanged data after zoom/rotation %i', rotation => {
  const commit = vi.fn();
  const view = render(<AnnotationOverlay page={2} viewport={viewport(1,90)} annotations={[]} onCommit={commit} />);
  draw(screen.getByLabelText('Highlights for page 2'));
  const stroke = commit.mock.calls[0][0] as Highlight;
  expect(stroke.points).toEqual([{ x:40,y:50 },{ x:60,y:70 },{ x:70,y:80 }]);
  expect(stroke.page).toBe(2); expect(captured).toBeNull();
  const snapshot = JSON.stringify(stroke);
  for (const scale of [.1,1,2,8]) {
    const vp = viewport(scale, rotation);
    view.rerender(<AnnotationOverlay page={2} viewport={vp} annotations={[stroke]} onCommit={commit} />);
    const line = view.container.querySelector('polyline')!;
    const expected = { 0:[20,80],90:[20,20],180:[180,20],270:[80,180] }[rotation]!;
    expect(line.getAttribute('points')!.split(' ')[0]).toBe(`${expected[0]*scale},${expected[1]*scale}`);
    expect(Number(line.getAttribute('stroke-width'))).toBeCloseTo(10*scale);
    expect(JSON.stringify(stroke)).toBe(snapshot);
  }
});
it('commits once, ignores other pointers and discards clicks and cancelled gestures', () => {
  const commit = vi.fn();
  const view = render(<AnnotationOverlay page={1} viewport={viewport()} annotations={[]} onCommit={commit} />);
  const svg = screen.getByLabelText('Highlights for page 1');
  for (const end of [() => fireEvent.pointerCancel(svg), () => fireEvent.lostPointerCapture(svg), () => fireEvent.blur(window), () => fireEvent.keyDown(window,{code:'Space'}), () => fireEvent.keyDown(window,{code:'Escape'}), () => fireEvent.scroll(window)]) {
    fireEvent.pointerDown(svg,{button:0,pointerId:4,clientX:70,clientY:90});
    fireEvent.pointerMove(svg,{buttons:1,pointerId:4,clientX:90,clientY:110});
    end(); fireEvent.pointerUp(svg,{pointerId:4});
    expect(commit).not.toHaveBeenCalled(); expect(svg.querySelector('polyline')).toBeNull();
  }
  fireEvent.pointerDown(svg,{button:0,pointerId:4,clientX:70,clientY:90});
  fireEvent.pointerUp(svg,{pointerId:9,clientX:80,clientY:100});
  expect(commit).not.toHaveBeenCalled();
  fireEvent.pointerUp(svg,{pointerId:4,clientX:70,clientY:90});
  expect(commit).not.toHaveBeenCalled();
  draw(svg); fireEvent.pointerUp(svg,{pointerId:4}); expect(commit).toHaveBeenCalledOnce();
  fireEvent.pointerDown(svg,{button:0,pointerId:4,clientX:70,clientY:90});
  view.rerender(<AnnotationOverlay page={1} viewport={viewport(2)} annotations={[]} onCommit={commit} />);
  expect(svg.querySelector('polyline')).toBeNull(); expect(captured).toBeNull();
});

it('toggles straight preview immediately and restores all freehand samples on Shift release', () => {
  const commit = vi.fn();
  render(<AnnotationOverlay page={1} viewport={viewport()} annotations={[]} onCommit={commit} />);
  const svg = screen.getByLabelText('Highlights for page 1');
  fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: 70, clientY: 90 });
  fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 130, clientY: 130 });
  const points = () => svg.querySelector('polyline')!.getAttribute('points');
  expect(points()).toBe('20,20 50,30 80,60');
  fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft' });
  expect(points()).toBe('20,20 80,60');
  fireEvent.keyUp(window, { key: 'Shift', code: 'ShiftLeft' });
  expect(points()).toBe('20,20 50,30 80,60');
  fireEvent.pointerUp(svg, { pointerId: 4, clientX: 140, clientY: 140, shiftKey: true });
  expect(commit.mock.calls[0][0].points).toEqual([{ x: 40, y: 110 }, { x: 110, y: 60 }]);
});

it('keeps pointer-down style through control changes and applies the new style to the next stroke', () => {
  const commit = vi.fn();
  const props = { page: 1, viewport: viewport(), annotations: [], onCommit: commit };
  const view = render(<AnnotationOverlay {...props} />);
  const svg = screen.getByLabelText('Highlights for page 1');
  fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: 70, clientY: 90, shiftKey: true });
  view.rerender(<AnnotationOverlay {...props} style={{ color: '#38bdf8', width: 20, opacity: .4 }} />);
  fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 100, clientY: 100, shiftKey: true });
  fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 130, clientY: 130, shiftKey: true });
  fireEvent.keyUp(window, { key: 'Shift' });
  fireEvent.pointerUp(svg, { pointerId: 4, clientX: 130, clientY: 130 });
  expect(commit.mock.calls[0][0]).toMatchObject({ color: '#facc15', width: 10 });
  expect(commit.mock.calls[0][0].points).toHaveLength(3);
  draw(svg);
  expect(commit.mock.calls[1][0]).toMatchObject({ color: '#38bdf8', width: 20 });
});

it('shares preview and committed opacity layers without merging vectors or changing cross-color order', () => {
  const commit = vi.fn();
  const yellow: Highlight = { id: 'yellow', legendId: null, page: 1, type: 'freehand', color: '#facc15', width: 10, opacity: .4, points: [{ x: 40, y: 110 }, { x: 70, y: 80 }] };
  const blue = { ...yellow, id: 'blue', color: '#38bdf8' };
  const props = { page: 1, viewport: viewport(), annotations: [yellow, blue], onCommit: commit };
  const view = render(<AnnotationOverlay {...props} />);
  const svg = screen.getByLabelText('Highlights for page 1');
  fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: 70, clientY: 90 });
  fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 100, clientY: 120 });
  const groups = () => [...svg.querySelectorAll('g')];
  const preview = svg.querySelector('[data-draft]')!;
  expect(preview.parentElement).toBe(groups()[0]);
  expect(preview.hasAttribute('opacity')).toBe(false);
  expect(groups().map(g => g.getAttribute('opacity'))).toEqual(['0.4', '0.4']);
  const geometry = preview.getAttribute('points');
  fireEvent.pointerUp(svg, { pointerId: 4, clientX: 100, clientY: 120 });
  const stroke = commit.mock.calls[0][0];
  view.rerender(<AnnotationOverlay {...props} annotations={[yellow, blue, stroke]} />);
  expect(groups()[0].children).toHaveLength(2);
  expect(groups()[1].children).toHaveLength(1);
  expect(groups()[0].lastElementChild!.getAttribute('points')).toBe(geometry);
  expect(svg.querySelector('[data-draft]')).toBeNull();
  view.rerender(<AnnotationOverlay {...props} annotations={[yellow, { ...yellow, id: 'dim', opacity: .2 }]} />);
  expect(groups()).toHaveLength(2);
});

it('discards straight drafts on cancellation and rejects a straight line ending at its start', () => {
  const commit = vi.fn();
  render(<AnnotationOverlay page={1} viewport={viewport()} annotations={[]} onCommit={commit} />);
  const svg = screen.getByLabelText('Highlights for page 1');
  for (const end of [() => fireEvent.pointerCancel(svg), () => fireEvent.blur(window), () => fireEvent.keyDown(window, { code: 'Escape' })]) {
    fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: 70, clientY: 90, shiftKey: true });
    fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 100, clientY: 120, shiftKey: true });
    end();
    fireEvent.keyUp(window, { key: 'Shift' });
    expect(svg.querySelector('polyline')).toBeNull();
  }
  fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: 70, clientY: 90, shiftKey: true });
  fireEvent.pointerMove(svg, { buttons: 1, pointerId: 4, clientX: 100, clientY: 120, shiftKey: true });
  fireEvent.pointerUp(svg, { pointerId: 4, clientX: 70, clientY: 90, shiftKey: true });
  expect(commit).not.toHaveBeenCalled();
});
