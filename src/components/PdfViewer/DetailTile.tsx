import { useLayoutEffect, useRef } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

// A bounded, sharp tile supplements the page overview when the whole sheet is
// too large to rasterize at display resolution. Markup remains vector-based.
export default function DetailTile({ page, scale, active, pixelBudget }: {
  page: PDFPageProxy; scale: number; active: boolean; pixelBudget: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const host = ref.current, scroller = host?.closest<HTMLElement>('.pdf-scroll');
    if (!host || !scroller || !active) return;
    const viewport = page.getViewport({ scale }), dpr = window.devicePixelRatio || 1;
    const overviewRatio = Math.min(dpr, 8192 / Math.max(viewport.width, viewport.height), Math.sqrt(pixelBudget / (viewport.width * viewport.height)));
    if (overviewRatio >= dpr * .85) return;
    let timer: ReturnType<typeof setTimeout> | undefined, disposed = false, key = '';
    let pending: ReturnType<PDFPageProxy['render']> | undefined;
    let pendingCanvas: HTMLCanvasElement | undefined;
    function cancelPending() {
      const task = pending, canvas = pendingCanvas;
      pending = undefined; pendingCanvas = undefined;
      task?.cancel();
      if (canvas) void (task?.promise ?? Promise.resolve()).catch(() => {}).then(() => { canvas.width = 0; canvas.height = 0; });
    }
    function render() {
      if (disposed || !host || !scroller) return;
      const pageRect = host.getBoundingClientRect(), view = scroller.getBoundingClientRect();
      if (!pageRect.width || !pageRect.height) return;
      const unitX = viewport.width / pageRect.width, unitY = viewport.height / pageRect.height;
      const left = Math.max(0, Math.floor((view.left - pageRect.left) * unitX / 128) * 128 - 128);
      const top = Math.max(0, Math.floor((view.top - pageRect.top) * unitY / 128) * 128 - 128);
      const right = Math.min(viewport.width, Math.ceil((view.left + scroller.clientWidth - pageRect.left) * unitX / 128) * 128 + 128);
      const bottom = Math.min(viewport.height, Math.ceil((view.top + scroller.clientHeight - pageRect.top) * unitY / 128) * 128 + 128);
      const width = right - left, height = bottom - top;
      if (width <= 0 || height <= 0) { cancelPending(); host.replaceChildren(); key = ''; return; }
      const nextKey = `${left}:${top}:${right}:${bottom}`;
      if (key === nextKey) return;
      cancelPending(); key = nextKey;
      const canvas = document.createElement('canvas');
      canvas.className = 'pdf-detail-tile'; canvas.setAttribute('aria-hidden', 'true');
      const ratio = Math.min(dpr, 8192 / Math.max(width, height), Math.sqrt(Math.min(pixelBudget, 8_000_000) / (width * height)));
      canvas.width = Math.max(1, Math.ceil(width * ratio)); canvas.height = Math.max(1, Math.ceil(height * ratio));
      Object.assign(canvas.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, pointerEvents: 'none' });
      const context = canvas.getContext('2d');
      if (!context) { key = ''; return; }
      try {
        const task = page.render({ canvas, canvasContext: context, viewport, transform: [ratio, 0, 0, ratio, -left * ratio, -top * ratio] });
        pending = task; pendingCanvas = canvas;
        void task.promise.then(() => {
          if (disposed || pending !== task) return;
          for (const old of host.querySelectorAll('canvas')) { old.width = 0; old.height = 0; }
          host.replaceChildren(canvas); pending = undefined; pendingCanvas = undefined;
        }).catch(error => {
          if (disposed || pending !== task) return;
          pending = undefined; pendingCanvas = undefined; canvas.width = 0; canvas.height = 0; key = '';
          console.warn('High-detail tile unavailable', error);
        });
      } catch (error) { canvas.width = 0; canvas.height = 0; key = ''; console.warn('High-detail tile unavailable', error); }
    }
    const schedule = () => { clearTimeout(timer); timer = setTimeout(render, 80); };
    scroller.addEventListener('scroll', schedule, { passive: true }); window.addEventListener('resize', schedule);
    render();
    return () => {
      disposed = true; clearTimeout(timer); cancelPending();
      scroller.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule);
      for (const canvas of host.querySelectorAll('canvas')) { canvas.width = 0; canvas.height = 0; }
      host.replaceChildren();
    };
  }, [page, scale, active, pixelBudget]);
  return <div ref={ref} aria-hidden="true" className="pdf-detail-layer" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }} />;
}
