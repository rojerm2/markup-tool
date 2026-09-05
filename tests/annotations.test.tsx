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
