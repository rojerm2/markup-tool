import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist';
import PdfPage from '../src/components/PdfViewer/PdfPage';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('renders a sharp bounded visible tile at high zoom, moves it on pan, and cancels it on unmount', async () => {
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  let left=-4000,top=-5000;
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
    const scroller=this.classList.contains('pdf-scroll');const x=scroller?0:left,y=scroller?0:top,w=scroller?900:19200,h=scroller?700:25600;
    return {x,y,left:x,top:y,right:x+w,bottom:y+h,width:w,height:h,toJSON(){}};
  });
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(900);
  vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(700);
  const draw=vi.fn(()=>({promise:Promise.resolve(),cancel:vi.fn()}));
  const page={pageNumber:1,getViewport:({scale}:{scale:number})=>({width:600*scale,height:800*scale}),render:draw} as unknown as PDFPageProxy;
  const view=render(<div className="pdf-scroll"><PdfPage page={page} scale={32}/></div>);
  await waitFor(()=>expect(view.container.querySelector('.pdf-detail-tile')).not.toBeNull());
  const tile=view.container.querySelector<HTMLCanvasElement>('.pdf-detail-tile')!;
  expect(tile.width*tile.height).toBeLessThan(8_100_000);
  const full=view.container.querySelector<HTMLCanvasElement>('[aria-label="PDF page 1"]')!;
  expect(full.width*full.height).toBeLessThanOrEqual(16_000_000);
  const tileCall=draw.mock.calls.map(call=>call[0]).find(call=>call.canvas===tile)!;
  expect(tileCall.transform[0]).toBe(1); expect(tileCall.transform[4]).toBeLessThan(-3000);
  const old=tile.style.left; left-=500;top-=500;
  act(()=>view.container.querySelector('.pdf-scroll')!.dispatchEvent(new Event('scroll')));
  await waitFor(()=>expect(view.container.querySelector<HTMLCanvasElement>('.pdf-detail-tile')!.style.left).not.toBe(old));
  view.unmount(); expect(full.width).toBe(0); expect(tile.width).toBe(0);
});
