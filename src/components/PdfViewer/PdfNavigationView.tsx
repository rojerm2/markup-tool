import NoteOverlay from '../Annotations/NoteOverlay';
import NoteControls from '../Annotations/NoteControls';
import { moveNote, type TextNote } from '../../services/notes';
import ShapeOverlay from '../Annotations/ShapeOverlay';
import ShapeControls from '../Annotations/ShapeControls';
import { SHAPE_DEFAULTS, moveShape, type Shape, type ShapeKind } from '../../services/shapes';
import RoundingControl from '../Annotations/RoundingControl';
import PageLegendOverlay from '../Annotations/PageLegendOverlay';
import PageLegendControls from '../Annotations/PageLegendControls';
import { viewportToPdf } from '../../services/coordinates';
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { clampZoom, clientToPdf, fitScale, MAX_ZOOM, MIN_ZOOM, pdfToClient, type Point, type ZoomMode } from "../../services/coordinates";
import PdfPage from "./PdfPage";
import { useSpacePan } from "./useSpacePan";

import AnnotationOverlay from "../Annotations/AnnotationOverlay";
import DrawingControls, { COLORS } from "../Annotations/DrawingControls";
import LegendControls from "../Annotations/LegendControls";
import EditingControls from "../Annotations/EditingControls";
import { isEditingControl } from '../../services/annotationEditing';
import { emptySession, type AnnotationSession, type SessionAction } from "../../services/annotationSession";

import { SessionHistory } from "../../services/sessionHistory";

const GUTTER = 32;
const LABEL_HEIGHT = 28;

export default function PdfNavigationView({ pages, session: controlled, onAction, history: suppliedHistory, onHistory, disabled = false, largerControls = false }: { pages: PDFPageProxy[]; session?: AnnotationSession; onAction?: (action: SessionAction, generation?: number) => void; history?: SessionHistory; onHistory?: (direction: 'undo' | 'redo') => boolean; disabled?: boolean; largerControls?: boolean }) {
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
    if (changed) { setSelectedNote(null); setSelectedPointer(null); setSelectedShape(null); setSelectedKey(null); setPlacing(false); setSelectedId(null); refresh(v => v + 1); }
  }
  const { drawing, annotations, activeLegendId } = session;
  const [placementRows,setPlacementRows]=useState<string[]|null>(null);
  const rows=placementRows?.filter(id=>session.legends.some(l=>l.id===id))??session.legends.map(l=>l.id);
  const [placing, setPlacing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string|null>(null);
  const [tool, setToolState] = useState<'pan' | 'highlight' | 'edit' | 'text' | 'arrow' | ShapeKind>('highlight');
  const [selectedNote,setSelectedNote]=useState<string|null>(null);
  const [selectedPointer,setSelectedPointer]=useState<string|null>(null);
  const [editingNote,setEditingNote]=useState<TextNote|null>(null);
  const [pointerPlacement,setPointerPlacement]=useState<string|null>(null);
  const [selectedShape, setSelectedShape] = useState<string|null>(null);
  const [shapeStyle,setShapeStyle] = useState<Pick<Shape,'color'|'width'|'fill'>>(SHAPE_DEFAULTS);
  const currentShape=session.shapes?.find(s=>s.id===selectedShape);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [roundingPreview, setRoundingPreview] = useState<number|null>(null);
  const roundingStroke = tool === 'edit' ? annotations.find(s=>s.id===selectedId) : undefined;
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
      if(event.key==='Escape') {setPointerPlacement(null);setEditingNote(null);setSelectedNote(null);setSelectedPointer(null);setPlacing(false);setSelectedKey(null);setSelectedShape(null);}
      if(selectedNote && !isEditingControl(event.target) && event.target instanceof Node && root.current?.contains(event.target)) {
        const n=session.notes?.find(n=>n.id===selectedNote);
        if(n) {
          if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();if(n.type==='text'&&selectedPointer)dispatch({type:'put-note',before:n,note:{...n,pointers:n.pointers.filter(p=>p.id!==selectedPointer)}});else dispatch({type:'remove-note',id:n.id});return;}
          const delta:Record<string,[number,number]>={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]};
          if(delta[event.key]){event.preventDefault();const vp=pages[n.page-1].getViewport({scale:1}),p=viewportToPdf({x:0,y:0},vp),q=viewportToPdf({x:delta[event.key][0],y:delta[event.key][1]},vp),dx=q.x-p.x,dy=q.y-p.y;
            dispatch({type:'put-note',before:n,note:n.type==='text'&&selectedPointer?{...n,pointers:n.pointers.map(v=>v.id===selectedPointer?{...v,target:{x:v.target.x+dx,y:v.target.y+dy}}:v)}:moveNote(n,dx,dy)});return;}
        }
      }
      if(selectedShape && !isEditingControl(event.target) && event.target instanceof Node && root.current?.contains(event.target)) {
        const s=session.shapes?.find(s=>s.id===selectedShape);
        if(s) {
          if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();dispatch({type:'remove-shape',id:s.id});return;}
          const delta:Record<string,[number,number]>={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]};
          if(delta[event.key]){event.preventDefault();const vp=pages[s.page-1].getViewport({scale:1}),p=viewportToPdf({x:0,y:0},vp),q=viewportToPdf({x:delta[event.key][0],y:delta[event.key][1]},vp);dispatch({type:'put-shape',shape:moveShape(s,q.x-p.x,q.y-p.y),before:s});return;}
        }
      }
      if(selectedKey && !isEditingControl(event.target)) {
        const k=session.pageLegends?.find(k=>k.id===selectedKey);
        if(k && event.target instanceof Node && root.current?.contains(event.target)) {
          if(event.key==='Delete'||event.key==='Backspace'){event.preventDefault();dispatch({type:'remove-key',id:k.id});return;}
          const delta:Record<string,[number,number]>={ArrowLeft:[-2,0],ArrowRight:[2,0],ArrowUp:[0,-2],ArrowDown:[0,2]};
          if(delta[event.key]) {event.preventDefault();const vp=pages[k.page-1].getViewport({scale:1});const p=viewportToPdf({x:0,y:0},vp),q=viewportToPdf({x:delta[event.key][0],y:delta[event.key][1]},vp);dispatch({type:'put-key',key:{...k,x:k.x+q.x-p.x,y:k.y+q.y-p.y},before:k,legends:session.legends});return;}
        }
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
  const [panelOpen, setPanelOpen] = useState(true);
  function setTool(next: typeof tool) {
    setToolState(next);
    if (next !== 'edit' && window.innerWidth <= 800) {
      setPanelOpen(false);
      host.current?.focus({preventScroll:true});
    }
  }
  const panelButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  function togglePanel(open: boolean) {
    history.invalidate(); setViewRevision(v => v + 1); setPanelOpen(open);
    if (!open) panelButton.current?.focus();
  }
  useEffect(() => { history.invalidate(); setViewRevision(v => v + 1); }, [largerControls]);
  const pan = useSpacePan(host, tool === 'pan', `${viewRevision}:${tool}`, disabled);
  useEffect(() => { if (panelOpen && !editingNote) panel.current?.focus(); }, [panelOpen]);
  useEffect(() => { if (editingNote) { setPanelOpen(true); requestAnimationFrame(() => panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()); } }, [editingNote]);
  useEffect(()=>history.subscribeCancellation(()=>setPlacing(false)),[history]);
  useEffect(()=>{setPlacing(false);},[viewRevision,mode,zoom,disabled]);
  useEffect(()=>{const cancel=(e?:Event)=>{if(e?.type==='scroll'&&e.target instanceof Element&&e.target.closest('.workspace-panel'))return;setPlacing(false);};const key=(e:KeyboardEvent)=>{if(e.code==='Space'&&!isEditingControl(e.target))cancel();};window.addEventListener('blur',cancel);window.addEventListener('scroll',cancel,true);window.addEventListener('keydown',key);document.addEventListener('visibilitychange',cancel);return()=>{window.removeEventListener('blur',cancel);window.removeEventListener('scroll',cancel,true);window.removeEventListener('keydown',key);document.removeEventListener('visibilitychange',cancel);};},[]);
  useEffect(()=>{if(selectedKey&&!session.pageLegends?.some(k=>k.id===selectedKey))setSelectedKey(null);},[session.pageLegends,selectedKey]);
  const scales = pages.map(page => mode === "manual" ? zoom : fitScale(
    page.getViewport({ scale: 1 }),
    { width: size.width - GUTTER, height: size.height - GUTTER - LABEL_HEIGHT }, mode,
  ));
  const [rasterPages, setRasterPages] = useState<number[]>(() => pages.slice(0, 3).map(p => p.pageNumber));
  function updateRasterPages() {
    const element = host.current;
    if (!element || !element.clientHeight || pages.length <= 3) return;
    const bounds = element.getBoundingClientRect(), overscan = element.clientHeight / 2;
    const nearby = Array.from(element.querySelectorAll<HTMLElement>('[data-page]')).map(node => {
      const rect = node.getBoundingClientRect();
      return { page: Number(node.dataset.page), top: rect.top, bottom: rect.bottom,
        distance: Math.abs((rect.top + rect.bottom) / 2 - (bounds.top + bounds.bottom) / 2) };
    }).filter(p => p.bottom >= bounds.top - overscan && p.top <= bounds.bottom + overscan)
      .sort((a, b) => a.distance - b.distance).slice(0, 8).map(p => p.page).sort((a,b) => a-b);
    if (!nearby.length) return;
    setRasterPages(previous => previous.join(',') === nearby.join(',') ? previous : nearby);
  }
  useLayoutEffect(updateRasterPages, [mode, zoom, size, current, pages]);
  useEffect(()=>{const cancel=(e?:Event)=>{if(e?.type==='scroll'&&e.target instanceof Element&&e.target.closest('.note-properties, .workspace-panel'))return;setPointerPlacement(null);setEditingNote(null);};const a=history.subscribeCancellation(cancel),b=history.subscribeSnapshotCancellation(cancel);document.addEventListener('visibilitychange',cancel);window.addEventListener('blur',cancel);window.addEventListener('scroll',cancel,true);return()=>{a();b();document.removeEventListener('visibilitychange',cancel);window.removeEventListener('blur',cancel);window.removeEventListener('scroll',cancel,true);};},[history]);
  useEffect(()=>{setPointerPlacement(null);setEditingNote(null);},[tool,viewRevision,mode,zoom,disabled]);
  useEffect(()=>{if(selectedNote&&!session.notes?.some(n=>n.id===selectedNote))setSelectedNote(null);},[session.notes,selectedNote]);
  const activeScale = scales[current - 1];

  function pageCanvas(number: number) {
    return host.current?.querySelector<HTMLElement>(`[data-page="${number}"] canvas`)
      ?? host.current?.querySelector<HTMLElement>(`[data-page="${number}"] .page-surface`);
  }

  function updateCurrent() {
    updateRasterPages();
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

  useEffect(()=>{if(selectedShape&&!session.shapes?.some(s=>s.id===selectedShape))setSelectedShape(null);},[session.shapes,selectedShape]);
  function selectShape(id:string|null){setSelectedNote(null);history.invalidate();const s=session.shapes?.find(s=>s.id===id);if(s&&s.page!==current)navigate(s.page);setSelectedShape(s?.id??null);setSelectedId(null);setSelectedKey(null);history.invalidate();setPlacing(false);setTool('edit');}

  function selectStroke(id: string | null) {
    setSelectedNote(null);
    const stroke = annotations.find(s => s.id === id);
    if (stroke && stroke.page !== current) navigate(stroke.page);
    setSelectedShape(null); setSelectedKey(null); setSelectedId(stroke?.id ?? null);
  }

  function selectNote(id:string,pointer?:string){if(id!==selectedNote||(pointer??null)!==selectedPointer)history.invalidate();const n=session.notes?.find(n=>n.id===id);if(n&&n.page!==current)navigate(n.page);setSelectedNote(id||null);setSelectedPointer(pointer??null);setSelectedShape(null);setSelectedKey(null);setSelectedId(null);setTool('edit');}
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
    <div className="workspace-bar">
      <button ref={panelButton} aria-expanded={panelOpen} aria-controls="workspace-panel" onClick={() => togglePanel(!panelOpen)}>Tools / Properties</button>
      <span role="status">{tool === 'pan' ? 'Hand / Pan' : tool === 'edit' ? 'Select / Edit' : tool.charAt(0).toUpperCase() + tool.slice(1)}{activeLegendId ? ` / ${session.legends.find(l => l.id === activeLegendId)?.name ?? ''}` : tool === 'highlight' ? ` / ${COLORS.find(c=>c.value===drawing.color)?.name??'Saved color'}` : ''}</span>
      <button aria-pressed={tool === 'pan'} onClick={() => { history.invalidate(); setPlacing(false); setPointerPlacement(null); setSelectedNote(null); setSelectedShape(null); setSelectedKey(null); setSelectedId(null); setTool('pan'); }}>Hand / Pan</button>
    </div>
    <div className="workspace-body">
    <aside ref={panel} id="workspace-panel" className="workspace-panel" aria-label="Tools and properties" tabIndex={-1} hidden={!panelOpen} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); togglePanel(false); } }}>
      <div className="panel-heading"><strong>Tools / Properties</strong><button onClick={() => togglePanel(false)}>Close panel</button></div>
    <div className="annotation-tools">
      <div className="tool-modes" role="group" aria-label="History">
        <button disabled={disabled || !history.undoLabel} title={`Undo ${history.undoLabel ?? ''} (Ctrl+Z)`} aria-keyshortcuts="Control+z" onClick={() => traverse('undo')}>Undo</button>
        <button disabled={disabled || !history.redoLabel} title={`Redo ${history.redoLabel ?? ''} (Ctrl+Y / Ctrl+Shift+Z)`} aria-keyshortcuts="Control+y Control+Shift+z" onClick={() => traverse('redo')}>Redo</button>
      </div>
      <div className="tool-modes" role="group" aria-label="Annotation mode">
        <button aria-pressed={tool === 'highlight'} onClick={() => { setPlacing(false); setSelectedKey(null); history.invalidate(); setSelectedShape(null); setTool('highlight'); setSelectedNote(null); setSelectedId(null); }}>Highlight</button>
        <button aria-pressed={tool === 'edit'} onClick={() => {history.invalidate();setPlacing(false);setTool('edit');}}>Select/Edit</button>
      </div>
      <label className="shape-tool-label">Shape <select aria-label="Shape tool" value={['rectangle','ellipse','line'].includes(tool)?tool:''} onChange={e=>{if(!e.target.value)return;history.invalidate();setPlacing(false);setSelectedKey(null);setSelectedId(null);setSelectedShape(null);setSelectedNote(null);setTool(e.target.value as ShapeKind);}}><option value="">Draw?</option><option value="rectangle">Rectangle</option><option value="ellipse">Ellipse</option><option value="line">Line</option></select></label>
      <button aria-pressed={tool==='text'} onClick={()=>{history.invalidate();setPlacing(false);setSelectedNote(null);setSelectedShape(null);setSelectedKey(null);setSelectedId(null);setTool('text');}}>Text</button>
      <button aria-pressed={tool==='arrow'} onClick={()=>{history.invalidate();setPlacing(false);setSelectedNote(null);setSelectedShape(null);setSelectedKey(null);setSelectedId(null);setTool('arrow');}}>Arrow</button>
      {(tool==='edit'||tool==='text'||tool==='arrow')&&<NoteControls notes={session.notes??[]} selected={selectedNote} pointer={selectedPointer} onSelect={selectNote} editing={editingNote} onEdit={setEditingNote} onClose={()=>setEditingNote(null)} onPointer={()=>{history.invalidate();setPointerPlacement(selectedNote);if(window.innerWidth<=800)setPanelOpen(false);}} placing={!!pointerPlacement} history={history} dispatch={dispatch} disabled={disabled} revision={`${viewRevision}:${mode}:${zoom}:${tool}`}/>}
      {tool === 'highlight' ? <DrawingControls value={drawing} onChange={(drawing, manual) => dispatch({ type: 'drawing', drawing, manual })} />
        : tool === 'edit' && !currentShape && !selectedNote ? <EditingControls session={session} selectedId={selectedId} onSelect={selectStroke} dispatch={dispatch} /> : null}
      {(tool==='edit'&&!selectedNote||['rectangle','ellipse','line'].includes(tool)) && <ShapeControls showProperties={!!currentShape||['rectangle','ellipse','line'].includes(tool)} line={tool==='line'} shapes={session.shapes??[]} selected={selectedShape} onSelect={selectShape} value={currentShape??shapeStyle} onChange={style=>{if(currentShape)dispatch({type:'put-shape',shape:{...currentShape,...style},before:currentShape});else setShapeStyle(style);}} onDelete={currentShape?()=>dispatch({type:'remove-shape',id:currentShape.id}):undefined} />}
      {(tool === 'highlight' || roundingStroke) && <RoundingControl key={`${tool}:${selectedId}:${viewRevision}:${mode}:${zoom}:${disabled}`} value={roundingStroke?.rounding ?? (tool === 'highlight' ? drawing.rounding : undefined) ?? 100} history={history} identity={roundingStroke ?? drawing} onPreview={setRoundingPreview}
        onCommit={(rounding,generation)=>{if(roundingStroke)dispatch({type:'edit-stroke',id:roundingStroke.id,before:roundingStroke,edit:{rounding}},generation);else {const next={...drawing};if(rounding===100)delete next.rounding;else next.rounding=rounding;dispatch({type:'drawing',drawing:next,manual:false},generation);}}} />}
    </div>
    <LegendControls session={session} dispatch={dispatch} />
    <PageLegendControls rows={rows} onRows={setPlacementRows} session={session} selected={selectedKey} pages={pages} current={current} placing={placing}
      history={history} revision={viewRevision} disabled={disabled} dispatch={dispatch}
      onPlace={()=>{setSelectedNote(null);history.invalidate();if(!placing&&window.innerWidth<=800)setPanelOpen(false);setPlacing(!placing);setSelectedKey(null);setSelectedId(null);}}
      onSelect={id=>{setSelectedNote(null);const k=session.pageLegends?.find(k=>k.id===id);if(k&&k.page!==current)navigate(k.page);setSelectedShape(null);setSelectedKey(id||null);setSelectedId(null);setTool('edit');}}/>
    </aside>
    <div ref={host} {...pan} className={`pdf-scroll ${pan.className}`} tabIndex={0}
      role="region" aria-label="PDF pages" aria-describedby="pan-hint" onScroll={updateCurrent}
      onPointerDown={event => {
        if (tool === 'edit' && event.button === 0 && event.target instanceof Element && !event.target.closest('.annotation-overlay')) setSelectedId(null);
      }}>
      <div className="pdf-pages">
        {pages.map((page, index) => {
          const viewport = page.getViewport({ scale: scales[index] });
          return <div key={page.pageNumber} data-page={page.pageNumber} style={{ width: viewport.width, minHeight: viewport.height + LABEL_HEIGHT }}>
            <PdfPage page={page} scale={scales[index]} active={rasterPages.includes(page.pageNumber)}
              pixelBudget={Math.min(16_000_000, 32_000_000 / Math.max(1, rasterPages.length))}>
              <AnnotationOverlay page={page.pageNumber} viewport={viewport} style={drawing} legendId={activeLegendId}
                history={history} tool={tool==='edit'?'edit':'highlight'} selectedId={selectedId} onSelect={id=>{setSelectedNote(null);setSelectedShape(null);setSelectedId(id);setSelectedKey(null);}} onAction={dispatch} legends={session.legends} disabled={disabled||!!editingNote||placing||!!pointerPlacement||(tool!=='highlight'&&tool!=='edit')} viewRevision={viewRevision}
                annotations={annotations.filter(stroke => stroke.page === page.pageNumber).map(s=>s===roundingStroke && roundingPreview!==null ? {...s,rounding:roundingPreview} : s)}
                onCommit={(stroke, generation) => dispatch({ type: 'commit', stroke }, generation)} />
              <ShapeOverlay page={page.pageNumber} viewport={viewport} shapes={(session.shapes??[]).filter(s=>s.page===page.pageNumber)} tool={tool==='text'||tool==='arrow'||tool==='pan'?'highlight':tool} style={{...shapeStyle,fill:tool==='line'?null:shapeStyle.fill}} selected={selectedShape}
                onSelect={id=>{setSelectedNote(null);setSelectedShape(id);setSelectedId(null);setSelectedKey(null);}} dispatch={dispatch} history={history} disabled={disabled||!!editingNote||placing||!!pointerPlacement} revision={viewRevision}/>
              <NoteOverlay page={page.pageNumber} viewport={viewport} notes={(session.notes??[]).filter(n=>n.page===page.pageNumber)} tool={tool==='pan'?'highlight':tool} selected={selectedNote} pointer={selectedPointer} placing={pointerPlacement} onSelect={selectNote} onEdit={n=>{setSelectedNote(n.id);setEditingNote(n);}} onPlaced={()=>setPointerPlacement(null)} dispatch={dispatch} history={history} disabled={disabled||placing||!!editingNote} revision={viewRevision}/>
              <PageLegendOverlay rows={rows} page={page.pageNumber} viewport={viewport} session={session} history={history} placing={placing}
                onPlaced={()=>{setPlacing(false);setPanelOpen(true);}} selected={selectedKey} onSelect={id=>{setSelectedNote(null);setSelectedShape(null);setSelectedKey(id);setSelectedId(null);setTool('edit');}}
                dispatch={dispatch} editing={tool==='edit'&&!pointerPlacement} disabled={disabled||!!editingNote||!!pointerPlacement} revision={viewRevision}/>
            </PdfPage>
          </div>;
        })}
      </div>
    </div>
    </div>
    <footer id="pan-hint">{placing ? 'Click the page to place the legend. Escape cancels.' : pointerPlacement ? 'Click a target on the note page. Escape cancels.' : tool === 'pan' ? 'Drag the plan to move the view' : tool === 'text' ? 'Click the page, type your note, then Apply text' : tool === 'arrow' ? 'Drag from the start to the arrow target' : tool === 'edit' ? currentShape ? 'Drag to move; handles resize; arrow keys nudge' : 'Click or choose a stroke to edit · Drag to move · Escape clears selection' : tool === 'highlight' ? 'Drag to highlight · Shift for straight line' : 'Drag a shape; Shift constrains; select to move or resize'} · Space + drag to pan · Ctrl + wheel to zoom</footer>
  </div>;
}
