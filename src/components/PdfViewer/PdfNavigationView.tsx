import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { clampZoom, clientToPdf, fitScale, MAX_ZOOM, MIN_ZOOM, pdfToClient, type Point, type ZoomMode } from "../../services/coordinates";
import PdfPage from "./PdfPage";
import { useSpacePan } from "./useSpacePan";

import AnnotationOverlay from "../Annotations/AnnotationOverlay";
import DrawingControls from "../Annotations/DrawingControls";
import LegendControls from "../Annotations/LegendControls";
import EditingControls from "../Annotations/EditingControls";
import { isEditingControl } from '../../services/annotationEditing';
import { emptySession, type AnnotationSession, type SessionAction } from "../../services/annotationSession";

import { SessionHistory } from "../../services/sessionHistory";

const GUTTER = 32;
const LABEL_HEIGHT = 28;

export default function PdfNavigationView({ pages, session: controlled, onAction, history: suppliedHistory, onHistory, disabled = false }: { pages: PDFPageProxy[]; session?: AnnotationSession; onAction?: (action: SessionAction, generation?: number) => void; history?: SessionHistory; onHistory?: (direction: 'undo' | 'redo') => boolean; disabled?: boolean }) {
  const [local] = useState(() => new SessionHistory(controlled ?? emptySession));
  const [, refresh] = useState(0);
  const history = suppliedHistory ?? local;
  const session = controlled ?? history.present;
  const dispatch = (action: SessionAction, generation?: number) => {
    if (disabled) return;
    if (onAction) onAction(action, generation);
    else if (history.apply(action, generation)) refresh(v => v + 1);
  };
  function traverse(direction: 'undo' | 'redo') {
    if (disabled) return;
    const changed = onHistory ? onHistory(direction) : history.traverse(direction);
    if (changed) { setSelectedId(null); refresh(v => v + 1); }
  }
  const { drawing, annotations, activeLegendId } = session;
  const [tool, setTool] = useState<'highlight' | 'edit'>('highlight');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewRevision, setViewRevision] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { if (selectedId && !annotations.some(s => s.id === selectedId)) setSelectedId(null); }, [annotations, selectedId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (disabled) return;
      const key = event.key.toLowerCase();
      if (!isEditingControl(event.target) && event.ctrlKey && !event.metaKey && !event.altKey
        && ((key === 'z') || (key === 'y' && !event.shiftKey))) {
        event.preventDefault(); traverse(key === 'y' || event.shiftKey ? 'redo' : 'undo'); return;
      }
      if (tool !== 'edit') return;
      if (event.key === 'Escape' && !(event.target instanceof Element && event.target.closest('dialog, [role="dialog"]'))) setSelectedId(null);
      if (isEditingControl(event.target)) return;
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId
        && event.target instanceof Node && root.current?.contains(event.target)) {
        event.preventDefault(); dispatch({ type: 'remove-stroke', id: selectedId });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [disabled, tool, selectedId, dispatch]);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [current, setCurrent] = useState(1);
  useEffect(() => {
    if (selectedId && annotations.find(s => s.id === selectedId)?.page !== current) setSelectedId(null);
  }, [current]);
  const [pageInput, setPageInput] = useState("1");
  const [mode, setMode] = useState<ZoomMode>("page");
  const [zoom, setZoom] = useState(1);
  useEffect(() => { setViewRevision(v => v+1); }, [size]);
  const anchor = useRef<{ page: number; point: Point; x: number; y: number } | null>(null);
  const pendingPage = useRef<number | null>(null);
  const pan = useSpacePan(host);
  const scales = pages.map(page => mode === "manual" ? zoom : fitScale(
    page.getViewport({ scale: 1 }),
    { width: size.width - GUTTER, height: size.height - GUTTER - LABEL_HEIGHT }, mode,
  ));
  const activeScale = scales[current - 1];

  function pageCanvas(number: number) {
    return host.current?.querySelector<HTMLCanvasElement>(`[data-page="${number}"] canvas`);
  }

  function updateCurrent() {
    const element = host.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    let best = 1, visible = -1;
    element.querySelectorAll<HTMLElement>("[data-page]").forEach(page => {
      const rect = page.getBoundingClientRect();
      const overlap = Math.max(0, Math.min(rect.bottom, bounds.top + element.clientHeight) - Math.max(rect.top, bounds.top));
      if (overlap > visible) { visible = overlap; best = Number(page.dataset.page); }
    });
    setCurrent(best);
    setPageInput(String(best));
  }

  function navigate(number: number) {
    setViewRevision(v => v+1);
    setSelectedId(null);
    if (!Number.isInteger(number) || number < 1 || number > pages.length) {
      setPageInput(String(current));
      return;
    }
    const element = host.current;
    const target = element?.querySelector<HTMLElement>(`[data-page="${number}"]`);
    if (element && target) {
      element.scrollTop += target.getBoundingClientRect().top - element.getBoundingClientRect().top - 16;
      element.scrollLeft = 0;
    }
    setCurrent(number);
    setPageInput(String(number));
  }

  function changeZoom(scale: number, pointer?: Point, pageNumber = current) {
    const next = clampZoom(scale);
    if (mode === "manual" && zoom === next) return;
    const element = host.current, canvas = pageCanvas(pageNumber);
    if (element && canvas) {
      const rect = element.getBoundingClientRect();
      const x = pointer ? pointer.x - rect.left : element.clientWidth / 2, y = pointer ? pointer.y - rect.top : element.clientHeight / 2;
      anchor.current = { page: pageNumber, x, y, point: clientToPdf(
        { x: rect.left + x, y: rect.top + y }, canvas.getBoundingClientRect(),
        pages[pageNumber - 1].getViewport({ scale: scales[pageNumber - 1] }),
      ) };
    }
    setMode("manual"); setZoom(next);
  }

  // Native non-passive listener is required to suppress browser Ctrl-wheel zoom.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (!event.deltaY) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-page]') : null;
      const number = target ? Number(target.dataset.page) : current;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      changeZoom(scales[number - 1] * Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002),
        { x: event.clientX, y: event.clientY }, number);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  });

  function fit(next: "page" | "width") {
    pendingPage.current = next === mode ? null : current;
    setMode(next);
    // Also realign when the already-selected fit button is clicked.
    navigate(current);
  }

  useLayoutEffect(() => {
    const element = host.current;
    if (!element) return;
    const measure = () => {
      if (element.clientWidth && element.clientHeight) setSize(previous =>
        previous.width === element.clientWidth && previous.height === element.clientHeight
          ? previous : { width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const saved = anchor.current;
    const element = host.current;
    if (saved && element) {
      const canvas = pageCanvas(saved.page);
      if (canvas) {
        // PdfPage's child layout effect has installed the new canvas dimensions.
        const viewport = pages[saved.page - 1].getViewport({ scale: scales[saved.page - 1] });
        const position = pdfToClient(saved.point, canvas.getBoundingClientRect(), viewport);
        const bounds = element.getBoundingClientRect();
        element.scrollLeft += position.x - bounds.left - saved.x;
        element.scrollTop += position.y - bounds.top - saved.y;
      }
      anchor.current = null;
      pendingPage.current = null;
    } else if (pendingPage.current !== null) {
      navigate(pendingPage.current);
      pendingPage.current = null;
    } else if (mode !== "manual") {
      navigate(current);
    }
  }, [mode, zoom, size]);

  function selectStroke(id: string | null) {
    const stroke = annotations.find(s => s.id === id);
    if (stroke && stroke.page !== current) navigate(stroke.page);
    setSelectedId(stroke?.id ?? null);
  }

  return <div ref={root} className="pdf-navigation">
    <div className="pdf-controls" role="toolbar" aria-label="PDF navigation">
      <div className="control-group" role="group" aria-label="Pages">
      <button disabled={current === 1} onClick={() => navigate(current - 1)}>Previous page</button>
      <form onSubmit={event => { event.preventDefault(); navigate(Number(pageInput)); }}>
        <label>Page <input aria-label="Page number" inputMode="numeric" value={pageInput}
          onChange={event => setPageInput(event.target.value)} onBlur={() => { if (pageInput !== String(current)) navigate(Number(pageInput)); }} /></label>
        <span> of {pages.length}</span>
      </form>
      <button disabled={current === pages.length} onClick={() => navigate(current + 1)}>Next page</button>
      </div><div className="control-group" role="group" aria-label="Zoom">
      <button aria-label="Zoom out" disabled={mode === "manual" && zoom <= MIN_ZOOM} onClick={() => changeZoom(activeScale / 1.25)}>−</button>
      <output aria-label="Zoom level">{Math.round(activeScale * 100)}%</output>
      <button aria-label="Zoom in" disabled={mode === "manual" && zoom >= MAX_ZOOM} onClick={() => changeZoom(activeScale * 1.25)}>+</button>
      <button onClick={() => changeZoom(1)}>100%</button>
      <button aria-pressed={mode === "page"} onClick={() => fit("page")}>Fit to page</button>
      <button aria-pressed={mode === "width"} onClick={() => fit("width")}>Fit to width</button>
      </div>

    </div>
    <div className="annotation-tools">
      <div className="tool-modes" role="group" aria-label="History">
        <button disabled={disabled || !history.undoLabel} title={`Undo ${history.undoLabel ?? ''} (Ctrl+Z)`} aria-keyshortcuts="Control+z" onClick={() => traverse('undo')}>Undo</button>
        <button disabled={disabled || !history.redoLabel} title={`Redo ${history.redoLabel ?? ''} (Ctrl+Y / Ctrl+Shift+Z)`} aria-keyshortcuts="Control+y Control+Shift+z" onClick={() => traverse('redo')}>Redo</button>
      </div>
      <div className="tool-modes" role="group" aria-label="Annotation mode">
        <button aria-pressed={tool === 'highlight'} onClick={() => { setTool('highlight'); setSelectedId(null); }}>Highlight</button>
        <button aria-pressed={tool === 'edit'} onClick={() => setTool('edit')}>Select/Edit</button>
      </div>
      {tool === 'highlight' ? <DrawingControls value={drawing} onChange={(drawing, manual) => dispatch({ type: 'drawing', drawing, manual })} />
        : <EditingControls session={session} selectedId={selectedId} onSelect={selectStroke} dispatch={dispatch} />}
    </div>
    <LegendControls session={session} dispatch={dispatch} />
    <div ref={host} {...pan} className={`pdf-scroll ${pan.className}`} tabIndex={0}
      role="region" aria-label="PDF pages" aria-describedby="pan-hint" onScroll={updateCurrent}
      onPointerDown={event => {
        if (tool === 'edit' && event.button === 0 && event.target instanceof Element && !event.target.closest('.annotation-overlay')) setSelectedId(null);
      }}>
      <div className="pdf-pages">
        {pages.map((page, index) => {
          const viewport = page.getViewport({ scale: scales[index] });
          return <div key={page.pageNumber} data-page={page.pageNumber} style={{ width: viewport.width, minHeight: viewport.height + LABEL_HEIGHT }}>
            <PdfPage page={page} scale={scales[index]}>
              <AnnotationOverlay page={page.pageNumber} viewport={viewport} style={drawing} legendId={activeLegendId}
                history={history} tool={tool} selectedId={selectedId} onSelect={setSelectedId} onAction={dispatch} legends={session.legends} disabled={disabled} viewRevision={viewRevision}
                annotations={annotations.filter(stroke => stroke.page === page.pageNumber)}
                onCommit={(stroke, generation) => dispatch({ type: 'commit', stroke }, generation)} />
            </PdfPage>
          </div>;
        })}
      </div>
    </div>
    <footer id="pan-hint">{tool === 'edit' ? 'Click or choose a stroke to edit · Drag to move · Escape clears selection' : 'Drag to highlight · Shift for straight line'} · Space + drag to pan · Ctrl + wheel to zoom <span>Editable vectors</span></footer>
  </div>;
}
