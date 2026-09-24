import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist";
import PdfNavigationView from "../src/components/PdfViewer/PdfNavigationView";

let width = 800, height = 600;
let resize: () => void;
let captured: number | null;
function rect(left: number, top: number, w: number, h: number): DOMRect {
  return { left, top, width: w, height: h, right: left + w, bottom: top + h, x: left, y: top, toJSON() {} };
}
function page(number: number, w = 600, h = 800) {
  return { pageNumber: number,
    getViewport: ({ scale }: { scale: number }) => ({ width: w * scale, height: h * scale,
      convertToViewportPoint: (x: number, y: number) => [x * scale, (h - y) * scale],
      convertToPdfPoint: (x: number, y: number) => [x / scale, h - y / scale],
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  } as unknown as PDFPageProxy;
}
beforeEach(() => {
  width = 800; height = 600; captured = null;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  });
  vi.stubGlobal("PointerEvent", class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1; }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => height);
  Object.defineProperties(Element.prototype, {
    setPointerCapture: { configurable: true, value: (id: number) => { captured = id; } },
    hasPointerCapture: { configurable: true, value: (id: number) => captured === id },
    releasePointerCapture: { configurable: true, value: () => { captured = null; } },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const host = document.querySelector<HTMLElement>(".pdf-scroll");
    if (this === host) return rect(0, 100, width, height);
    const wrapper = this.closest<HTMLElement>("[data-page]");
    if (!host || !wrapper) return rect(0, 0, 0, 0);
    let top = 116 - host.scrollTop;
    for (const sibling of Array.from(wrapper.parentElement!.children) as HTMLElement[]) {
      if (sibling === wrapper) break;
      top += Number.parseFloat(sibling.style.minHeight) + 16;
    }
    const w = Number.parseFloat(wrapper.style.width), h = Number.parseFloat(wrapper.style.minHeight);
    return rect(Math.max(16, (width - w) / 2) - host.scrollLeft, top + (this.tagName === "CANVAS" ? 28 : 0), w, h - (this.tagName === "CANVAS" ? 28 : 0));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("navigates with buttons/input, rejects invalid pages, and tracks scrolling", () => {
  render(<PdfNavigationView pages={[page(1), page(2), page(3)]} />);
  const input = screen.getByRole("textbox", { name: "Page number" }) as HTMLInputElement;
  expect(screen.getByRole("button", { name: "Previous page" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(input.value).toBe("2");
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled")).toBe(true);
  for (const invalid of ["0", "4", "1.5", "abc", ""]) {
    fireEvent.change(input, { target: { value: invalid } }); fireEvent.submit(input.closest("form")!);
    expect(input.value).toBe("3");
  }
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.scrollTop = 0; fireEvent.scroll(host);
  expect(input.value).toBe("1");
});

it("fits mixed page sizes, responds to resize, and keeps manual zoom across resize", () => {
  render(<PdfNavigationView pages={[page(1), page(2, 1200, 600)]} />);
  const canvas = () => screen.getByLabelText("PDF page 1") as HTMLCanvasElement;
  expect(canvas().style.height).toBe("540px");
  fireEvent.click(screen.getByRole("button", { name: "Fit to page" }));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  act(() => { width = 700; resize(); });
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  act(() => { width = 800; resize(); });
  fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
  expect(canvas().style.width).toBe("768px");
  expect((screen.getByLabelText("PDF page 2") as HTMLCanvasElement).style.width).toBe("768px");
  act(() => { width = 500; resize(); });
  expect(canvas().style.width).toBe("468px");
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  expect(canvas().style.width).toBe("600px");
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.scrollTop = 120;
  act(() => { width = 400; resize(); });
  expect(canvas().style.width).toBe("600px");
  expect(host.scrollTop).toBe(120);
});

it("anchors zoom to the viewed PDF point, cancels old rasters and bounds zoom/allocation", () => {
  const first = page(1);
  render(<PdfNavigationView pages={[first]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.scrollTop = 200;
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByLabelText("Zoom level").textContent).toBe("125%");
  // Viewport center (y=300) was 456 CSS pixels into the page at 100%.
  expect(host.scrollTop).toBeCloseTo(314);
  expect(vi.mocked(first.render).mock.results[0].value.cancel).toHaveBeenCalledOnce();
  for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByLabelText("Zoom level").textContent).toBe("800%");
  expect(screen.getByRole("button", { name: "Zoom in" }).hasAttribute("disabled")).toBe(true);
  const canvas = screen.getByLabelText("PDF page 1") as HTMLCanvasElement;
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000);
  expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(8192);
  for (let i = 0; i < 30; i++) fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(screen.getByLabelText("Zoom level").textContent).toBe("10%");
  expect(screen.getByRole("button", { name: "Zoom out" }).hasAttribute("disabled")).toBe(true);
});

it("pans only with Space, captures the pointer and releases on keyup, blur and cancel", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const host = screen.getByRole("region", { name: "PDF pages" });
  const canvas = screen.getByLabelText("PDF page 1");
  const down = () => fireEvent.pointerDown(canvas, { button: 0, pointerId: 7, clientX: 200, clientY: 200 });
  const move = () => fireEvent.pointerMove(host, { pointerId: 7, clientX: 150, clientY: 120 });
  down(); move(); expect(host.scrollTop).toBe(0);
  fireEvent.keyDown(window, { code: "Space" }); down(); move();
  expect([host.scrollLeft, host.scrollTop]).toEqual([50, 80]);
  expect(captured).toBe(7);
  fireEvent.keyUp(window, { code: "Space" });
  expect(captured).toBeNull(); move(); expect(host.scrollTop).toBe(80);
  for (const end of [() => fireEvent.blur(window), () => fireEvent.pointerCancel(host), () => fireEvent.pointerUp(host, { pointerId: 7 })]) {
    fireEvent.keyDown(window, { code: "Space" }); down(); expect(captured).toBe(7);
    end(); expect(captured).toBeNull();
  }
  fireEvent.keyUp(window, { code: "Space" });
  fireEvent.keyDown(screen.getByRole("textbox"), { code: "Space" }); down();
  expect(captured).toBeNull();
});


it("preserves toolbar activation and pans from page focus", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const host = screen.getByRole('region', { name: 'PDF pages' });
  const button = screen.getByRole('button', { name: '100%' });
  button.focus(); fireEvent.click(button);
  expect(fireEvent.keyDown(button, { code: 'Space' })).toBe(true);
  expect(host.className).not.toContain('can-pan');
  host.focus();
  expect(fireEvent.keyDown(host, { code: 'Space' })).toBe(false);
  const overlay = screen.getByLabelText('Highlights for page 1');
  fireEvent.pointerDown(overlay, { pointerId: 8, button: 0, clientX: 300, clientY: 300 });
  fireEvent.pointerMove(host, { pointerId: 8, buttons: 1, clientX: 200, clientY: 200 });
  fireEvent.keyUp(button, { code: 'Space' });
  fireEvent.pointerUp(overlay, { pointerId: 8 });
  expect(host.scrollLeft).toBe(100);
  expect(overlay.querySelector('polyline')).toBeNull();
  expect(fireEvent.keyDown(screen.getByRole('textbox'), { code: 'Space' })).toBe(true);
});

it("cancels only Ctrl-wheel, anchors to the pointer and respects wheel zoom limits", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole('button', { name: '100%' }));
  const canvas = screen.getByLabelText('PDF page 1');
  const host = screen.getByRole('region', { name: 'PDF pages' });
  host.scrollTop = 200;
  const before = canvas.getBoundingClientRect();
  const relativeY = 300 - before.top;
  expect(fireEvent.wheel(canvas, { deltaY: -100, clientX: 300, clientY: 300 })).toBe(true);
  expect(screen.getByLabelText('Zoom level').textContent).toBe('100%');
  expect(fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100, clientX: 300, clientY: 300 })).toBe(false);
  const after = screen.getByLabelText('PDF page 1').getBoundingClientRect();
  expect(after.top + relativeY * Math.exp(.2)).toBeCloseTo(300);
  for (let i = 0; i < 10; i++) fireEvent.wheel(host, { ctrlKey: true, deltaY: -500 });
  expect(screen.getByLabelText('Zoom level').textContent).toBe('800%');
  for (let i = 0; i < 10; i++) fireEvent.wheel(host, { ctrlKey: true, deltaY: 500 });
  expect(screen.getByLabelText('Zoom level').textContent).toBe('10%');
});


it('retains page-specific vectors through navigation, zoom and fit resize', () => {
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: SVGElement) {
    return this.closest('[data-page]')!.querySelector('canvas')!.getBoundingClientRect();
  });
  render(<PdfNavigationView pages={[page(1),page(2)]} />);
  fireEvent.click(screen.getByRole('button', {name:'100%'}));
  const svg = screen.getByLabelText('Highlights for page 1');
  const rect = svg.getBoundingClientRect();
  fireEvent.pointerDown(svg,{button:0,pointerId:4,clientX:rect.left+40,clientY:rect.top+50});
  fireEvent.pointerUp(svg,{pointerId:4,clientX:rect.left+80,clientY:rect.top+90});
  const line = () => svg.querySelector('polyline')!;
  expect(line().getAttribute('points')).toBe('40,50 80,90');
  fireEvent.click(screen.getByRole('button',{name:'Next page'}));
  expect(screen.getByLabelText('Highlights for page 2').querySelector('polyline')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Previous page'}));
  fireEvent.click(screen.getByRole('button',{name:'Zoom in'}));
  expect(line().getAttribute('points')).toBe('50,62.5 100,112.5');
  fireEvent.click(screen.getByRole('button',{name:'Fit to width'}));
  act(() => { width = 632; resize(); });
  expect(line().getAttribute('points')).toBe('40,50 80,90');
});

it('applies selected palette and width to new vectors, retaining old styling across zoom and resize', () => {
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: SVGElement) {
    return this.closest('[data-page]')!.querySelector('canvas')!.getBoundingClientRect();
  });
  render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole('button', { name: '100%' }));
  const svg = screen.getByLabelText('Highlights for page 1');
  const draw = () => {
    const bounds = svg.getBoundingClientRect();
    fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: bounds.left + 40, clientY: bounds.top + 50 });
    fireEvent.pointerUp(svg, { pointerId: 4, clientX: bounds.left + 80, clientY: bounds.top + 90 });
  };
  draw();
  fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
  fireEvent.click(screen.getByRole('button', { name: 'Blue' }));
  expect(screen.getByRole('button', { name: 'Blue' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Yellow' }).getAttribute('aria-pressed')).toBe('false');
  expect(screen.getByRole('button', { name: 'Thick' }).getAttribute('aria-pressed')).toBe('true');
  draw();
  const lines = () => [...svg.querySelectorAll('polyline')];
  expect(lines().map(p => [p.getAttribute('stroke'), p.getAttribute('stroke-width')])).toEqual([['#facc15', '10'], ['#38bdf8', '20']]);
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  expect(lines().map(p => p.getAttribute('stroke-width'))).toEqual(['12.5', '25']);
  fireEvent.click(screen.getByRole('button', { name: 'Fit to width' }));
  act(() => { width = 632; resize(); });
  expect(lines().map(p => p.getAttribute('stroke-width'))).toEqual(['10', '20']);
});

it('validates legends, snapshots assignment, detaches deleted drafts and preserves manual width', () => {
  vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: SVGElement) {
    return this.closest('[data-page]')!.querySelector('canvas')!.getBoundingClientRect();
  });
  render(<PdfNavigationView pages={[page(1)]} />);
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name, exact: true }));
  click('100%'); click('Legends (0)');
  const name = screen.getByLabelText('Legend name');
  const create = (value: string) => { fireEvent.change(name, { target: { value } }); click('Create legend'); };
  create('   '); expect(screen.getByRole('alert').textContent).toBe('Enter a legend name.');
  expect(name.getAttribute('aria-invalid')).toBe('true');
  click('Thick'); create('  Walls  ');
  const active = () => screen.getByLabelText('Active legend').textContent;
  expect(active()).toBe('Active: Walls');
  create('wALLS '); expect(screen.getByRole('alert').textContent).toContain('already exists');
  create('Doors');
  const svg = screen.getByLabelText('Highlights for page 1');
  const bounds = svg.getBoundingClientRect();
  const down = () => fireEvent.pointerDown(svg, { button: 0, pointerId: 4, clientX: bounds.left + 40, clientY: bounds.top + 50 });
  const up = () => fireEvent.pointerUp(svg, { pointerId: 4, clientX: bounds.left + 80, clientY: bounds.top + 90 });
  const lines = () => [...svg.querySelectorAll('polyline')];
  click('Select legend Walls'); down();
  const wallId = svg.querySelector('[data-draft]')!.getAttribute('data-legend-id');
  click('Select legend Doors'); click('Thin'); up();
  expect(lines()[0].getAttribute('data-legend-id')).toBe(wallId);
  expect(lines()[0].getAttribute('stroke-width')).toBe('20');
  down(); up();
  const doorId = lines()[1].getAttribute('data-legend-id');
  expect(doorId).not.toBe(wallId); expect(lines()[1].getAttribute('stroke-width')).toBe('5');
  click('Rename legend Walls'); fireEvent.change(name, { target: { value: '   ' } }); click('Save name');
  expect(screen.getByRole('alert').textContent).toBe('Enter a legend name.');
  fireEvent.change(name, { target: { value: ' doors ' } }); click('Save name');
  expect(screen.getByRole('alert').textContent).toContain('already exists');
  fireEvent.change(name, { target: { value: ' Exterior walls ' } }); click('Save name');
  expect(lines()[0].getAttribute('data-legend-id')).toBe(wallId);
  click('Yellow'); expect(active()).toBe('Unassigned · Manual color'); down(); up();
  expect(lines()[2].getAttribute('data-legend-id')).toBe('');
  expect(svg.querySelectorAll('g')).toHaveLength(1);
  click('Select legend Exterior walls'); down();
  const before = lines()[0].outerHTML;
  click('Delete legend Exterior walls');
  expect(active()).toBe('Unassigned · Manual color'); up();
  expect(lines()[0].outerHTML).toBe(before.replace(`data-legend-id="${wallId}"`, 'data-legend-id=""'));
  expect(lines()[3].getAttribute('data-legend-id')).toBe('');
  expect(lines()[1].getAttribute('data-legend-id')).toBe(doorId);
  click('Select legend Doors'); click('Delete legend Doors');
  expect(lines()).toHaveLength(4);
  expect(lines().every(line => line.getAttribute('data-legend-id') === '')).toBe(true);
  expect(screen.getByText(/No legends yet/)).toBeTruthy();
});

it('keeps Space editable in create and rename fields and available for button activation', () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Legends (0)' }));
  const input = screen.getByLabelText('Legend name');
  const host = screen.getByRole('region', { name: 'PDF pages' });
  expect(fireEvent.keyDown(input, { code: 'Space' })).toBe(true);
  expect(host.className).not.toContain('can-pan');
  fireEvent.click(screen.getByRole('button', { name: 'Legend color Blue' }));
  fireEvent.change(input, { target: { value: 'Wall area' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create legend' }));
  expect(screen.getByRole('button', { name: 'Blue', exact: true }).getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Rename legend Wall area' }));
  expect(fireEvent.keyDown(input, { code: 'Space' })).toBe(true);
  expect(host.className).not.toContain('can-pan');
  const button = screen.getByRole('button', { name: 'Select legend Wall area' });
  expect(fireEvent.keyDown(button, { code: 'Space' })).toBe(true);
  expect(host.className).not.toContain('can-pan');
  fireEvent.keyUp(button, { code: 'Space' });
  expect(host.className).not.toContain('can-pan');
});

it('standalone history records one Shift/freehand stroke, restores IDs, and preserves Space pan',()=>{
 render(<PdfNavigationView pages={[page(1)]}/>);const svg=screen.getByLabelText('Highlights for page 1');
 Object.defineProperty(svg,'getBoundingClientRect',{value:()=>rect(0,0,600,800)});
 const pointer=(type:string,x:number,shiftKey=false)=>fireEvent(svg,new PointerEvent(type,{bubbles:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:100,shiftKey}));
 pointer('pointerdown',40);for(let x=45;x<100;x+=5)pointer('pointermove',x,x>60);pointer('pointerup',100,true);
 const id=svg.querySelector('[data-annotation-id]')?.getAttribute('data-annotation-id');expect(id).toBeTruthy();
 fireEvent.keyDown(window,{key:'z',ctrlKey:true});expect(svg.querySelector('[data-annotation-id]')).toBeNull();expect(screen.getByRole('button',{name:'Undo',exact:true}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Redo',exact:true}));expect(svg.querySelector('[data-annotation-id]')?.getAttribute('data-annotation-id')).toBe(id);
 const toolbar=screen.getByRole('region',{name:'PDF pages',exact:true});fireEvent.keyDown(toolbar,{key:' ',code:'Space'});expect(screen.getByLabelText('PDF pages').className).toContain('can-pan');fireEvent.keyUp(window,{key:' ',code:'Space'});
});

it('bounds raster resources while navigating many pages and retains offscreen layout', () => {
  const pages=Array.from({length:100},(_,i)=>page(i+1));
  const view=render(<PdfNavigationView pages={pages} />);
  expect(view.container.querySelectorAll('[data-page]')).toHaveLength(100);
  expect(view.container.querySelectorAll('canvas').length).toBeLessThanOrEqual(8);
  const first=screen.getByLabelText('PDF page 1') as HTMLCanvasElement;
  const input=screen.getByLabelText('Page number');fireEvent.change(input,{target:{value:'100'}});fireEvent.submit(input.closest('form')!);
  expect(screen.getByLabelText('PDF page 100')).toBeTruthy();expect(screen.queryByLabelText('PDF page 1')).toBeNull();expect(first.width).toBe(0);expect(first.height).toBe(0);
  expect(view.container.querySelector('[data-page="1"] .page-surface')?.getAttribute('style')).toContain('height:');
  expect(view.container.querySelectorAll('canvas').length).toBeLessThanOrEqual(8);
  fireEvent.change(input,{target:{value:'1'}});fireEvent.submit(input.closest('form')!);expect(screen.getByLabelText('PDF page 1')).not.toBe(first);
  const finalCanvas=screen.getByLabelText('PDF page 1') as HTMLCanvasElement;view.unmount();expect(finalCanvas.width).toBe(0);
});

it.each(['Escape', 'blur', 'tool', 'panel', 'preference'])('Hand pans without annotation/history changes and releases capture on %s', reason => {
  const view=render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole('button', {name:'Hand / Pan'}));
  const host=screen.getByRole('region', {name:'PDF pages'});
  const svg=screen.getByLabelText('Highlights for page 1');
  fireEvent.pointerDown(svg,{pointerId:7,button:0,clientX:300,clientY:300});
  fireEvent.pointerMove(host,{pointerId:7,buttons:1,clientX:250,clientY:220});
  expect([host.scrollLeft,host.scrollTop]).toEqual([50,80]);
  expect(captured).toBe(7);
  if(reason==='Escape')fireEvent.keyDown(host,{key:'Escape'});
  if(reason==='blur')fireEvent.blur(window);
  if(reason==='tool')fireEvent.click(screen.getByRole('button',{name:'Highlight',exact:true}));
  if(reason==='panel')fireEvent.click(screen.getByRole('button',{name:'Close panel'}));
  if(reason==='preference')view.rerender(<PdfNavigationView pages={[page(1)]} largerControls />);
  expect(captured).toBeNull();
  fireEvent.pointerUp(svg,{pointerId:7});
  expect(svg.querySelector('[data-annotation-id]')).toBeNull();
  if(reason==='panel')fireEvent.click(screen.getByRole('button',{name:'Properties',exact:true}));
  expect(screen.getByRole('button',{name:'Undo',exact:true}).hasAttribute('disabled')).toBe(true);
});

it('closes the panel with Escape, restores its trigger focus, and reopens without trapping focus',()=>{
  render(<PdfNavigationView pages={[page(1)]}/>);
  const panel=screen.getByRole('complementary',{name:'Tools and properties'});
  panel.focus();fireEvent.keyDown(panel,{key:'Escape'});
  const trigger=screen.getByRole('button',{name:'Properties',exact:true});
  expect(document.activeElement).toBe(trigger);expect(trigger.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(trigger);expect(document.activeElement).toBe(panel);
  screen.getByRole('region',{name:'PDF pages'}).focus();
  expect(document.activeElement).not.toBe(panel);
});

it.each(['panel','preference','hand'])('cancels unfinished highlights on %s without creating history',reason=>{
 const view=render(<PdfNavigationView pages={[page(1)]}/>);const svg=screen.getByLabelText('Highlights for page 1');
 Object.defineProperty(svg,'getBoundingClientRect',{value:()=>rect(0,0,600,800)});
 fireEvent.pointerDown(svg,{pointerId:7,button:0,clientX:50,clientY:50});
 fireEvent.pointerMove(svg,{pointerId:7,buttons:1,clientX:100,clientY:100});expect(captured).toBe(7);
 if(reason==='panel')fireEvent.click(screen.getByRole('button',{name:'Close panel'}));
 if(reason==='hand')fireEvent.click(screen.getByRole('button',{name:'Hand / Pan'}));
 if(reason==='preference')view.rerender(<PdfNavigationView pages={[page(1)]} largerControls/>);
 expect(captured).toBeNull();fireEvent.pointerUp(svg,{pointerId:7});expect(svg.querySelector('[data-annotation-id]')).toBeNull();
 if(reason==='panel')fireEvent.click(screen.getByRole('button',{name:'Properties',exact:true}));
 expect(screen.getByRole('button',{name:'Undo',exact:true}).hasAttribute('disabled')).toBe(true);
});

it('releases Space capture when switching between annotation tools',()=>{
 render(<PdfNavigationView pages={[page(1)]}/>);
 const host=screen.getByRole('region',{name:'PDF pages'});
 fireEvent.keyDown(host,{code:'Space'});
 fireEvent.pointerDown(host,{pointerId:7,button:0,clientX:300,clientY:300});
 expect(captured).toBe(7);
 fireEvent.click(screen.getByRole('button',{name:'Text',exact:true}));
 expect(captured).toBeNull();expect(host.className).not.toContain('can-pan');
});

it('closes a narrow drawer on a drawing tool choice and moves focus to the plan',()=>{
 vi.stubGlobal('innerWidth',420);
 render(<PdfNavigationView pages={[page(1)]}/>);
 fireEvent.click(screen.getByRole('button',{name:'Text',exact:true}));
 expect(screen.getByRole('button',{name:'Properties',exact:true}).getAttribute('aria-expanded')).toBe('false');
 expect(document.activeElement).toBe(screen.getByRole('region',{name:'PDF pages'}));
});
