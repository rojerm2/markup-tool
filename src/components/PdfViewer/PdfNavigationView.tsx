import { useAppContextMenu, type MenuItem } from "../Toolbar/AppContextMenu";
import StrokeSizePreview from "../Annotations/StrokeSizePreview";
import ToolIcon from "../Toolbar/ToolIcon";
import NoteOverlay from "../Annotations/NoteOverlay";
import NoteControls from "../Annotations/NoteControls";
import { noteLocal, moveNote, type TextNote } from "../../services/notes";
import ShapeOverlay from "../Annotations/ShapeOverlay";
import ShapeControls from "../Annotations/ShapeControls";
import {
  SHAPE_DEFAULTS,
  pickShape,
  moveShape,
  type Shape,
  type ShapeKind,
} from "../../services/shapes";
import RoundingControl from "../Annotations/RoundingControl";
import PageLegendOverlay from "../Annotations/PageLegendOverlay";
import PageLegendControls from "../Annotations/PageLegendControls";
import { keyMatrix, layoutLegend } from "../../services/pageLegend";
import { pickHighlight } from "../../services/annotationEditing";
import { viewportToPdf } from "../../services/coordinates";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import {
  clampZoom,
  clientToPdf,
  fitScale,
  MAX_ZOOM,
  MIN_ZOOM,
  pdfToClient,
  type Point,
  type ZoomMode,
} from "../../services/coordinates";
import PdfPage from "./PdfPage";
import { useSpacePan } from "./useSpacePan";

import AnnotationOverlay from "../Annotations/AnnotationOverlay";
import DrawingControls, { COLORS } from "../Annotations/DrawingControls";
import LegendControls from "../Annotations/LegendControls";
import EditingControls from "../Annotations/EditingControls";
import { isEditingControl } from "../../services/annotationEditing";
import {
  emptySession,
  type AnnotationSession,
  type SessionAction,
} from "../../services/annotationSession";

import { SessionHistory } from "../../services/sessionHistory";
import {
  historyChangeRegions,
  type ChangeRegion,
} from "../../services/historyFeedback";
import HistoryChangeOverlay, {
  changeViewportBounds,
} from "../Annotations/HistoryChangeOverlay";
import { playActionSound } from "../../services/actionSounds";
import { isSpaceKey } from "../../services/canvasFocus";
import DocumentPanel from "./DocumentPanel";
import {
  defaultNavigation,
  type DocumentNavigation,
} from "../../services/documentNavigation";
import type { MarkupRow } from "../../services/markupList";
import { objectLocked, objectVisible } from "../../services/categoryPolicy";
import {
  copyMarkups,
  pasteMarkups,
  duplicateMarkups,
  deleteMarkups,
  moveMarkups,
  movementLimits,
  selectedObjects,
  MAX_SELECTION,
  type MarkupClipboard,
} from "../../services/bulkEditing";
import SelectionOverlay from "../Annotations/SelectionOverlay";

const GUTTER = 32;
const LABEL_HEIGHT = 28;

export default function PdfNavigationView({
  pages,
  session: controlled,
  onAction,
  history: suppliedHistory,
  onHistory,
  disabled = false,
  largerControls = false,
  fileActions = [],
  navigation,
  onNavigation,
}: {
  fileActions?: MenuItem[];
  pages: PDFPageProxy[];
  session?: AnnotationSession;
  onAction?: (action: SessionAction, generation?: number) => void;
  history?: SessionHistory;
  onHistory?: (direction: "undo" | "redo") => boolean;
  disabled?: boolean;
  largerControls?: boolean;
  navigation?: DocumentNavigation;
  onNavigation?: (navigation: DocumentNavigation) => void;
}) {
  const [localNavigation, setLocalNavigation] = useState(
    navigation ?? defaultNavigation,
  );
  const documentNavigation = navigation ?? localNavigation;
  const navigationCallback = useRef(onNavigation);
  navigationCallback.current = onNavigation;
  const [documentOpen, setDocumentOpen] = useState(false);
  const documentButton = useRef<HTMLButtonElement>(null);
  const [local] = useState(
    () => new SessionHistory(controlled ?? emptySession),
  );
  const [, refresh] = useState(0);
  const history = suppliedHistory ?? local;
  const session = controlled ?? history.present;
  const visible = (id: string) => objectVisible(session, id);
  const lockedObject = (id: string) => objectLocked(session, id);
  const workspaceSession = {
    ...session,
    pageLegends: session.pageLegends?.filter((k) => visible(k.id)),
  };
  const [historyFeedback, setHistoryFeedback] = useState<{
    id: number;
    message: string;
    regions: ChangeRegion[];
  } | null>(null);
  const feedbackId = useRef(0);
  const dispatch = (action: SessionAction, generation?: number) => {
    if (disabled) return;
    const before = history.present;
    if (onAction) onAction(action, generation);
    else if (history.apply(action, generation)) refresh((v) => v + 1);
    if (
      history.present !== before &&
      ![
        "drawing",
        "select",
        "create",
        "rename",
        "delete",
        "edit-stroke",
      ].includes(action.type)
    )
      playActionSound("markup");
  };

  function traverse(direction: "undo" | "redo") {
    if (disabled) return;
    const before = history.present,
      label = direction === "undo" ? history.undoLabel : history.redoLabel;
    const changed = onHistory
      ? onHistory(direction)
      : history.traverse(direction);
    if (changed) {
      const regions = historyChangeRegions(before, history.present),
        affected = [...new Set(regions.map((r) => r.page))];
      setHistoryFeedback({
        id: ++feedbackId.current,
        regions,
        message: `${direction === "undo" ? "Undid" : "Redid"} ${label}${affected.length ? ` · ${affected.length === 1 ? `Page ${affected[0]}` : `${affected.length} pages`}` : ""}`,
      });
      playActionSound(direction);
      setMultiSelection([]);
      setBulkMessage(null);
      setSelectedNote(null);
      setSelectedPointer(null);
      setSelectedShape(null);
      setSelectedKey(null);
      setPlacing(false);
      setSelectedId(null);
      refresh((v) => v + 1);
    }
  }
  const { drawing, annotations, activeLegendId } = session;
  const [placementRows, setPlacementRows] = useState<string[] | null>(null);
  const rows =
    placementRows?.filter((id) => session.legends.some((l) => l.id === id)) ??
    session.legends.map((l) => l.id);
  const [placing, setPlacing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [tool, setToolState] = useState<
    "pan" | "highlight" | "edit" | "text" | "arrow" | ShapeKind
  >("highlight");
  const [selectedNote, setSelectedNote] = useState<string | null>(null);
  const [selectedPointer, setSelectedPointer] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<TextNote | null>(null);
  const [pointerPlacement, setPointerPlacement] = useState<string | null>(null);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [shapeStyle, setShapeStyle] =
    useState<Pick<Shape, "color" | "width" | "fill">>(SHAPE_DEFAULTS);
  const currentShape = session.shapes?.find((s) => s.id === selectedShape);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [multiSelection, setMultiSelection] = useState<string[]>([]);
  const [clipboard, setClipboard] = useState<MarkupClipboard | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const selectionIds = multiSelection.length
    ? multiSelection
    : [selectedId ?? selectedShape ?? selectedNote ?? selectedKey].filter(
        (id): id is string => !!id,
      );
  const groupObjects = useMemo(() => {
    if (multiSelection.length < 2) return [];
    try {
      return selectedObjects(session, multiSelection);
    } catch {
      return [];
    }
  }, [session, multiSelection]);
  const groupLimits = useMemo(
    () =>
      groupObjects.length
        ? movementLimits(groupObjects, session.legends, (p) =>
            pages[p - 1].getViewport({ scale: 1 }),
          )
        : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
    [groupObjects, session.legends, pages],
  );
  useEffect(() => {
    if (multiSelection.length && !groupObjects.length) setMultiSelection([]);
  }, [groupObjects, multiSelection.length]);
  useEffect(() => {
    if (tool !== "edit") setMultiSelection([]);
  }, [tool]);
  useEffect(() => {
    if (
      [selectedId, selectedShape, selectedNote, selectedKey].some(
        (id) => id && (!visible(id) || lockedObject(id)),
      )
    ) {
      history.invalidate();
      setSelectedId(null);
      setSelectedShape(null);
      setSelectedNote(null);
      setSelectedPointer(null);
      setSelectedKey(null);
      setEditingNote(null);
      setPointerPlacement(null);
    }
  }, [session.legends, session.objectCategories]);
  const [roundingPreview, setRoundingPreview] = useState<number | null>(null);
  const roundingStroke =
    tool === "edit" ? annotations.find((s) => s.id === selectedId) : undefined;
  const [viewRevision, setViewRevision] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const openMenu = useAppContextMenu();
  const [strokePreview, setStrokePreview] = useState<{
    width: number;
    color: string;
  } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = (event: Event) => {
      setStrokePreview((event as CustomEvent).detail);
      clearTimeout(timer);
      timer = setTimeout(() => setStrokePreview(null), 3500);
    };
    const node = root.current;
    node?.addEventListener("stroke-preview", show);
    return () => {
      clearTimeout(timer);
      node?.removeEventListener("stroke-preview", show);
    };
  }, []);
  useEffect(() => setStrokePreview(null), [tool, disabled]);
  useEffect(() => {
    if (selectedId && !annotations.some((s) => s.id === selectedId))
      setSelectedId(null);
  }, [annotations, selectedId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (disabled) return;
      const key = event.key.toLowerCase();
      if (
        !isEditingControl(event.target) &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        (key === "z" || (key === "y" && !event.shiftKey))
      ) {
        event.preventDefault();
        traverse(key === "y" || event.shiftKey ? "redo" : "undo");
        return;
      }
      if (event.key === "Escape") {
        setPointerPlacement(null);
        setEditingNote(null);
        setSelectedNote(null);
        setSelectedPointer(null);
        setPlacing(false);
        setSelectedKey(null);
        setSelectedShape(null);
      }
      if (
        selectedNote &&
        !isEditingControl(event.target) &&
        event.target instanceof Node &&
        root.current?.contains(event.target)
      ) {
        const n = session.notes?.find((n) => n.id === selectedNote);
        if (n) {
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            if (n.type === "text" && selectedPointer)
              dispatch({
                type: "put-note",
                before: n,
                note: {
                  ...n,
                  pointers: n.pointers.filter((p) => p.id !== selectedPointer),
                },
              });
            else dispatch({ type: "remove-note", id: n.id });
            return;
          }
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-2, 0],
            ArrowRight: [2, 0],
            ArrowUp: [0, -2],
            ArrowDown: [0, 2],
          };
          if (delta[event.key]) {
            event.preventDefault();
            const vp = pages[n.page - 1].getViewport({ scale: 1 }),
              p = viewportToPdf({ x: 0, y: 0 }, vp),
              q = viewportToPdf(
                { x: delta[event.key][0], y: delta[event.key][1] },
                vp,
              ),
              dx = q.x - p.x,
              dy = q.y - p.y;
            dispatch({
              type: "put-note",
              before: n,
              note:
                n.type === "text" && selectedPointer
                  ? {
                      ...n,
                      pointers: n.pointers.map((v) =>
                        v.id === selectedPointer
                          ? {
                              ...v,
                              target: {
                                x: v.target.x + dx,
                                y: v.target.y + dy,
                              },
                            }
                          : v,
                      ),
                    }
                  : moveNote(n, dx, dy),
            });
            return;
          }
        }
      }
      if (
        selectedShape &&
        !isEditingControl(event.target) &&
        event.target instanceof Node &&
        root.current?.contains(event.target)
      ) {
        const s = session.shapes?.find((s) => s.id === selectedShape);
        if (s) {
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            dispatch({ type: "remove-shape", id: s.id });
            return;
          }
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-2, 0],
            ArrowRight: [2, 0],
            ArrowUp: [0, -2],
            ArrowDown: [0, 2],
          };
          if (delta[event.key]) {
            event.preventDefault();
            const vp = pages[s.page - 1].getViewport({ scale: 1 }),
              p = viewportToPdf({ x: 0, y: 0 }, vp),
              q = viewportToPdf(
                { x: delta[event.key][0], y: delta[event.key][1] },
                vp,
              );
            dispatch({
              type: "put-shape",
              shape: moveShape(s, q.x - p.x, q.y - p.y),
              before: s,
            });
            return;
          }
        }
      }
      if (selectedKey && !isEditingControl(event.target)) {
        const k = session.pageLegends?.find((k) => k.id === selectedKey);
        if (
          k &&
          event.target instanceof Node &&
          root.current?.contains(event.target)
        ) {
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            dispatch({ type: "remove-key", id: k.id });
            return;
          }
          const delta: Record<string, [number, number]> = {
            ArrowLeft: [-2, 0],
            ArrowRight: [2, 0],
            ArrowUp: [0, -2],
            ArrowDown: [0, 2],
          };
          if (delta[event.key]) {
            event.preventDefault();
            const vp = pages[k.page - 1].getViewport({ scale: 1 });
            const p = viewportToPdf({ x: 0, y: 0 }, vp),
              q = viewportToPdf(
                { x: delta[event.key][0], y: delta[event.key][1] },
                vp,
              );
            dispatch({
              type: "put-key",
              key: { ...k, x: k.x + q.x - p.x, y: k.y + q.y - p.y },
              before: k,
              legends: session.legends,
            });
            return;
          }
        }
      }
      if (tool !== "edit") return;
      if (
        event.key === "Escape" &&
        !(
          event.target instanceof Element &&
          event.target.closest('dialog, [role="dialog"]')
        )
      )
        setSelectedId(null);
      if (isEditingControl(event.target)) return;
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedId &&
        event.target instanceof Node &&
        root.current?.contains(event.target)
      ) {
        event.preventDefault();
        dispatch({ type: "remove-stroke", id: selectedId });
      }
      const stroke = annotations.find((s) => s.id === selectedId);
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (
        stroke &&
        delta[event.key] &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.target instanceof Node &&
        root.current?.contains(event.target)
      ) {
        event.preventDefault();
        const distance = event.shiftKey ? 10 : 2,
          vp = pages[stroke.page - 1].getViewport({ scale: 1 });
        const p = viewportToPdf({ x: 0, y: 0 }, vp),
          q = viewportToPdf(
            {
              x: delta[event.key][0] * distance,
              y: delta[event.key][1] * distance,
            },
            vp,
          );
        dispatch({
          type: "move-stroke",
          before: stroke,
          legends: session.legends,
          points: stroke.points.map((point) => ({
            x: point.x + q.x - p.x,
            y: point.y + q.y - p.y,
          })),
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [disabled, tool, selectedId, dispatch]);
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [current, setCurrent] = useState(documentNavigation.view.page);
  useEffect(() => {
    if (
      selectedId &&
      annotations.find((s) => s.id === selectedId)?.page !== current
    )
      setSelectedId(null);
  }, [current]);
  const [pageInput, setPageInput] = useState(
    String(documentNavigation.view.page),
  );
  const [mode, setMode] = useState<ZoomMode>(documentNavigation.view.mode);
  const [zoom, setZoom] = useState(documentNavigation.view.zoom);
  const initialView = useRef<DocumentNavigation["view"] | null>(
    documentNavigation.view,
  );
  const navigationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const flushNavigation = useRef<() => void>(() => {});
  const latestBookmarks = useRef(documentNavigation.bookmarks);
  latestBookmarks.current = documentNavigation.bookmarks;
  useEffect(() => {
    setViewRevision((v) => v + 1);
  }, [size]);
  const anchor = useRef<{
    page: number;
    point: Point;
    x: number;
    y: number;
  } | null>(null);
  const pendingPage = useRef<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  function setTool(next: typeof tool) {
    setToolState(next);
    if (next !== "edit" && window.innerWidth <= 800) {
      setPanelOpen(false);
      host.current?.focus({ preventScroll: true });
    }
  }

  function selectGroup(ids: string[]) {
    if (ids.length > MAX_SELECTION) {
      setBulkMessage(`Select up to ${MAX_SELECTION} markups at once.`);
      return;
    }
    history.invalidate();
    setBulkMessage(null);
    setSelectedId(null);
    setSelectedShape(null);
    setSelectedNote(null);
    setSelectedKey(null);
    setSelectedPointer(null);
    setEditingNote(null);
    setPointerPlacement(null);
    setPlacing(false);
    setMultiSelection(ids.length > 1 ? ids : []);
    if (ids.length === 1) {
      const object = selectedObjects(history.present, ids)[0];
      if (object.kind === "highlight") setSelectedId(ids[0]);
      else if (object.kind === "shape") setSelectedShape(ids[0]);
      else if (object.kind === "note") setSelectedNote(ids[0]);
      else setSelectedKey(ids[0]);
    }
    setTool("edit");
  }

  function toggleSelection(id: string) {
    if (!visible(id) || lockedObject(id)) return;
    selectGroup(
      selectionIds.includes(id)
        ? selectionIds.filter((v) => v !== id)
        : [...selectionIds, id],
    );
  }

  function bulkOperation(task: () => void) {
    try {
      task();
    } catch (error) {
      setBulkMessage(error instanceof Error ? error.message : String(error));
      playActionSound("error");
    }
  }

  function copySelection() {
    bulkOperation(() => {
      const objects = selectedObjects(session, selectionIds),
        page = objects[0].value.page;
      setClipboard(
        copyMarkups(
          session,
          selectionIds,
          pages[page - 1].getViewport({ scale: 1 }),
        ),
      );
      setBulkMessage(
        `Copied ${selectionIds.length} markup${selectionIds.length === 1 ? "" : "s"}.`,
      );
    });
  }

  function pasteSelection() {
    bulkOperation(() => {
      if (!clipboard) return;
      const viewport = pages[current - 1].getViewport({ scale: 1 });
      const center =
        captureView().center ??
        viewportToPdf(
          { x: viewport.width / 2, y: viewport.height / 2 },
          viewport,
        );
      const result = pasteMarkups(
        session,
        clipboard,
        current,
        viewport,
        center,
      );
      dispatch(result.action);
      selectGroup(result.ids);
      setBulkMessage(
        `Pasted ${result.ids.length} markup${result.ids.length === 1 ? "" : "s"} on page ${current}.`,
      );
    });
  }

  function duplicateSelection() {
    bulkOperation(() => {
      const result = duplicateMarkups(session, selectionIds, (p) =>
        pages[p - 1].getViewport({ scale: 1 }),
      );
      dispatch(result.action);
      selectGroup(result.ids);
      setBulkMessage(
        `Duplicated ${result.ids.length} markup${result.ids.length === 1 ? "" : "s"}.`,
      );
    });
  }

  function deleteSelection() {
    bulkOperation(() => {
      dispatch(deleteMarkups(session, selectionIds));
      selectGroup([]);
    });
  }

  function moveSelection(
    dx: number,
    dy: number,
    generation?: number,
    before = session,
  ) {
    bulkOperation(() => {
      if (history.present !== before) return;
      dispatch(
        moveMarkups(before, selectionIds, dx, dy, (p) =>
          pages[p - 1].getViewport({ scale: 1 }),
        ),
        generation,
      );
    });
  }
  const bulkKey = useRef<(e: KeyboardEvent) => void>(() => {});
  bulkKey.current = (e) => {
    if (
      disabled ||
      !(e.target instanceof Node) ||
      !root.current?.contains(e.target) ||
      (isEditingControl(e.target) &&
        !(e.target instanceof Element && e.target.closest(".markup-select")))
    )
      return;
    const key = e.key.toLowerCase(),
      control = (e.ctrlKey || e.metaKey) && !e.altKey;
    let action: (() => void) | undefined;
    if (control && key === "v" && clipboard) action = pasteSelection;
    else if (control && key === "c" && selectionIds.length)
      action = copySelection;
    else if (control && key === "d" && selectionIds.length)
      action = duplicateSelection;
    else if (control && key === "a" && host.current?.contains(e.target))
      action = () =>
        selectGroup(
          [
            ...session.annotations,
            ...(session.shapes ?? []),
            ...(session.notes ?? []),
            ...(session.pageLegends ?? []),
          ]
            .filter(
              (o) => o.page === current && visible(o.id) && !lockedObject(o.id),
            )
            .map((o) => o.id),
        );
    else if (
      multiSelection.length &&
      (e.key === "Delete" || e.key === "Backspace")
    )
      action = deleteSelection;
    else if (multiSelection.length && e.key === "Escape")
      action = () => selectGroup([]);
    else if (
      multiSelection.length &&
      !control &&
      !e.altKey &&
      host.current?.contains(e.target)
    ) {
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      if (delta[e.key]) {
        const [x, y] = delta[e.key],
          distance = e.shiftKey ? 10 : 2;
        action = () => moveSelection(x * distance, y * distance);
      }
    }
    if (action) {
      e.preventDefault();
      e.stopImmediatePropagation();
      action();
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => bulkKey.current(e);
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, []);
  const panelButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const focusPanel = useRef(false);

  function togglePanel(open: boolean) {
    history.invalidate();
    setViewRevision((v) => v + 1);
    setPanelOpen(open);
    if (!open) panelButton.current?.focus();
    focusPanel.current = open;
  }
  useLayoutEffect(() => {
    if (panelOpen && focusPanel.current) {
      panel.current?.focus();
      focusPanel.current = false;
    }
  }, [panelOpen]);
  useEffect(() => {
    history.invalidate();
    setViewRevision((v) => v + 1);
  }, [largerControls]);
  const pan = useSpacePan(
    host,
    tool === "pan",
    `${viewRevision}:${tool}`,
    disabled,
  );
  useEffect(() => {
    if (editingNote) {
      setPanelOpen(true);
      requestAnimationFrame(() =>
        panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(),
      );
    }
  }, [editingNote]);
  useEffect(
    () => history.subscribeCancellation(() => setPlacing(false)),
    [history],
  );
  useEffect(() => {
    setPlacing(false);
  }, [viewRevision, mode, zoom, disabled]);
  useEffect(() => {
    const cancel = (e?: Event) => {
      if (
        e?.type === "scroll" &&
        e.target instanceof Element &&
        e.target.closest(".workspace-panel, .document-panel")
      )
        return;
      setPlacing(false);
    };
    const key = (e: KeyboardEvent) => {
      if (isSpaceKey(e) && !isEditingControl(e.target)) cancel();
    };
    window.addEventListener("blur", cancel);
    window.addEventListener("scroll", cancel, true);
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", cancel, true);
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, []);
  useEffect(() => {
    if (selectedKey && !session.pageLegends?.some((k) => k.id === selectedKey))
      setSelectedKey(null);
  }, [session.pageLegends, selectedKey]);
  const scales = pages.map((page) =>
    mode === "manual"
      ? zoom
      : fitScale(
          page.getViewport({ scale: 1 }),
          {
            width: size.width - GUTTER,
            height: size.height - GUTTER - LABEL_HEIGHT,
          },
          mode,
        ),
  );
  const [rasterPages, setRasterPages] = useState<number[]>(() =>
    pages.slice(0, 3).map((p) => p.pageNumber),
  );

  function updateRasterPages() {
    const element = host.current;
    if (!element || !element.clientHeight || pages.length <= 3) return;
    const bounds = element.getBoundingClientRect(),
      overscan = element.clientHeight / 2;
    const nearby = Array.from(
      element.querySelectorAll<HTMLElement>("[data-page]"),
    )
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          page: Number(node.dataset.page),
          top: rect.top,
          bottom: rect.bottom,
          distance: Math.abs(
            (rect.top + rect.bottom) / 2 - (bounds.top + bounds.bottom) / 2,
          ),
        };
      })
      .filter(
        (p) =>
          p.bottom >= bounds.top - overscan &&
          p.top <= bounds.bottom + overscan,
      )
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 8)
      .map((p) => p.page)
      .sort((a, b) => a - b);
    if (!nearby.length) return;
    setRasterPages((previous) =>
      previous.join(",") === nearby.join(",") ? previous : nearby,
    );
  }
  useLayoutEffect(updateRasterPages, [mode, zoom, size, current, pages]);
  useEffect(() => {
    const cancel = (e?: Event) => {
      if (
        e?.type === "scroll" &&
        e.target instanceof Element &&
        e.target.closest(".note-properties, .workspace-panel, .document-panel")
      )
        return;
      setPointerPlacement(null);
      setEditingNote(null);
    };
    const a = history.subscribeCancellation(cancel),
      b = history.subscribeSnapshotCancellation(cancel);
    document.addEventListener("visibilitychange", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("scroll", cancel, true);
    return () => {
      a();
      b();
      document.removeEventListener("visibilitychange", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", cancel, true);
    };
  }, [history]);
  useEffect(() => {
    setPointerPlacement(null);
    setEditingNote(null);
  }, [tool, viewRevision, mode, zoom, disabled]);
  useEffect(() => {
    if (selectedNote && !session.notes?.some((n) => n.id === selectedNote))
      setSelectedNote(null);
  }, [session.notes, selectedNote]);
  const activeScale = scales[current - 1];

  useEffect(() => {
    if (!historyFeedback) return;
    const timer = window.setTimeout(() => setHistoryFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [historyFeedback]);
  useLayoutEffect(() => {
    if (!historyFeedback?.regions.length) return;
    const region =
      historyFeedback.regions.find((r) => r.page === current) ??
      historyFeedback.regions[0];
    const element = host.current,
      canvas = pageCanvas(region.page);
    if (!element || !canvas) return;
    const box = changeViewportBounds(
      region,
      pages[region.page - 1].getViewport({ scale: scales[region.page - 1] }),
    );
    const page = canvas.getBoundingClientRect(),
      view = element.getBoundingClientRect();
    const x = page.left + box.x + box.width / 2,
      y = page.top + box.y + box.height / 2;
    if (x < view.left + 20 || x > view.left + element.clientWidth - 20)
      element.scrollLeft += x - view.left - element.clientWidth / 2;
    if (y < view.top + 20 || y > view.top + element.clientHeight - 20)
      element.scrollTop += y - view.top - element.clientHeight / 2;
    updateCurrent();
  }, [historyFeedback?.id]);

  function pageCanvas(number: number) {
    return (
      host.current?.querySelector<HTMLElement>(
        `[data-page="${number}"] canvas`,
      ) ??
      host.current?.querySelector<HTMLElement>(
        `[data-page="${number}"] .page-surface`,
      )
    );
  }

  function updateCurrent() {
    updateRasterPages();
    const element = host.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    let best = 1,
      visible = -1;
    element.querySelectorAll<HTMLElement>("[data-page]").forEach((page) => {
      const rect = page.getBoundingClientRect();
      const overlap = Math.max(
        0,
        Math.min(rect.bottom, bounds.top + element.clientHeight) -
          Math.max(rect.top, bounds.top),
      );
      if (overlap > visible) {
        visible = overlap;
        best = Number(page.dataset.page);
      }
    });
    setCurrent(best);
    setPageInput(String(best));
    queueNavigation(best);
  }

  function navigate(number: number, clearSelection = true) {
    if (!Number.isInteger(number) || number < 1 || number > pages.length) {
      setPageInput(String(current));
      return;
    }
    setViewRevision((v) => v + 1);
    if (clearSelection) {
      setMultiSelection([]);
      setSelectedId(null);
      setSelectedShape(null);
      setSelectedNote(null);
      setSelectedKey(null);
      setSelectedPointer(null);
      setEditingNote(null);
    }
    const element = host.current;
    const target = element?.querySelector<HTMLElement>(
      `[data-page="${number}"]`,
    );
    if (element && target) {
      element.scrollTop +=
        target.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        16;
      element.scrollLeft = 0;
    }
    setCurrent(number);
    setPageInput(String(number));
    queueNavigation(number);
  }

  function captureView(page = current): DocumentNavigation["view"] {
    const element = host.current,
      canvas = pageCanvas(page);
    let center: Point | undefined;
    if (element?.clientHeight && element.clientWidth && canvas) {
      const rect = element.getBoundingClientRect();
      center = clientToPdf(
        {
          x: rect.left + element.clientWidth / 2,
          y: rect.top + element.clientHeight / 2,
        },
        canvas.getBoundingClientRect(),
        pages[page - 1].getViewport({ scale: scales[page - 1] }),
      );
      if (![center.x, center.y].every(Number.isFinite)) center = undefined;
    }
    return { page, mode, zoom, ...(center ? { center } : {}) };
  }

  function reportNavigation(
    view: DocumentNavigation["view"],
    bookmarks = latestBookmarks.current,
  ) {
    const value = { bookmarks, view };
    if (navigationCallback.current) navigationCallback.current(value);
    else setLocalNavigation(value);
  }

  function queueNavigation(page = current) {
    if (!navigationCallback.current) return;
    clearTimeout(navigationTimer.current);
    const view = captureView(page);
    flushNavigation.current = () => {
      clearTimeout(navigationTimer.current);
      reportNavigation(view);
    };
    navigationTimer.current = setTimeout(() => flushNavigation.current(), 300);
  }
  useEffect(() => {
    const unsubscribe = history.subscribeSnapshotCancellation(() =>
      flushNavigation.current(),
    );
    return () => {
      unsubscribe();
      clearTimeout(navigationTimer.current);
    };
  }, [history]);

  function centerAt(page: number, point: Point) {
    const element = host.current,
      canvas = pageCanvas(page);
    if (!element || !canvas) return;
    const position = pdfToClient(
      point,
      canvas.getBoundingClientRect(),
      pages[page - 1].getViewport({ scale: scales[page - 1] }),
    );
    const rect = element.getBoundingClientRect();
    element.scrollLeft += position.x - rect.left - element.clientWidth / 2;
    element.scrollTop += position.y - rect.top - element.clientHeight / 2;
    updateRasterPages();
  }

  function revealMarkup(row: MarkupRow) {
    history.invalidate();
    navigate(row.page);
    centerAt(row.page, row.center);
    if (!visible(row.id) || lockedObject(row.id)) {
      setSelectedId(null);
      setSelectedShape(null);
      setSelectedNote(null);
      setSelectedKey(null);
      setTool("pan");
      queueNavigation(row.page);
      host.current?.focus({ preventScroll: true });
      return;
    }
    setPlacing(false);
    setPointerPlacement(null);
    setSelectedPointer(null);
    setSelectedNote(
      row.type === "text" || row.type === "arrow" ? row.id : null,
    );
    setSelectedShape(row.type === "shape" ? row.id : null);
    setSelectedKey(row.type === "legend" ? row.id : null);
    setSelectedId(row.type === "highlight" ? row.id : null);
    setTool("edit");
    queueNavigation(row.page);
    host.current?.focus({ preventScroll: true });
  }

  function submitPage() {
    const number = Number(pageInput);
    navigate(number);
    host.current?.focus({ preventScroll: true });
    // Focus triggers blur synchronously, before React publishes the new page.
    setPageInput(
      String(
        Number.isInteger(number) && number >= 1 && number <= pages.length
          ? number
          : current,
      ),
    );
  }

  function changeZoom(scale: number, pointer?: Point, pageNumber = current) {
    const next = clampZoom(scale);
    if (mode === "manual" && zoom === next) return;
    const element = host.current,
      canvas = pageCanvas(pageNumber);
    if (element && canvas) {
      const rect = element.getBoundingClientRect();
      const x = pointer ? pointer.x - rect.left : element.clientWidth / 2,
        y = pointer ? pointer.y - rect.top : element.clientHeight / 2;
      anchor.current = {
        page: pageNumber,
        x,
        y,
        point: clientToPdf(
          { x: rect.left + x, y: rect.top + y },
          canvas.getBoundingClientRect(),
          pages[pageNumber - 1].getViewport({ scale: scales[pageNumber - 1] }),
        ),
      };
    }
    setMode("manual");
    setZoom(next);
  }

  // Native non-passive listener is required to suppress browser Ctrl-wheel zoom.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      if (!event.deltaY) return;
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-page]")
          : null;
      const number = target ? Number(target.dataset.page) : current;
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientHeight
            : 1);
      changeZoom(
        scales[number - 1] *
          Math.exp(-Math.max(-500, Math.min(500, delta)) * 0.002),
        { x: event.clientX, y: event.clientY },
        number,
      );
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
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
      if (element.clientWidth && element.clientHeight)
        setSize((previous) =>
          previous.width === element.clientWidth &&
          previous.height === element.clientHeight
            ? previous
            : { width: element.clientWidth, height: element.clientHeight },
        );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const saved = anchor.current;
    const element = host.current;
    if (initialView.current) {
      if (
        element?.clientWidth &&
        element.clientHeight &&
        (size.width !== element.clientWidth ||
          size.height !== element.clientHeight)
      )
        return;
      const restored = initialView.current;
      initialView.current = null;
      navigate(restored.page, false);
      if (restored.center) centerAt(restored.page, restored.center);
      queueNavigation(restored.page);
      return;
    }
    if (saved && element) {
      const canvas = pageCanvas(saved.page);
      if (canvas) {
        // PdfPage's child layout effect has installed the new canvas dimensions.
        const viewport = pages[saved.page - 1].getViewport({
          scale: scales[saved.page - 1],
        });
        const position = pdfToClient(
          saved.point,
          canvas.getBoundingClientRect(),
          viewport,
        );
        const bounds = element.getBoundingClientRect();
        element.scrollLeft += position.x - bounds.left - saved.x;
        element.scrollTop += position.y - bounds.top - saved.y;
      }
      anchor.current = null;
      pendingPage.current = null;
    } else if (pendingPage.current !== null) {
      navigate(pendingPage.current, false);
      pendingPage.current = null;
    } else if (mode !== "manual") {
      navigate(current, false);
    }
    queueNavigation();
  }, [mode, zoom, size]);

  useEffect(() => {
    if (selectedShape && !session.shapes?.some((s) => s.id === selectedShape))
      setSelectedShape(null);
  }, [session.shapes, selectedShape]);

  function selectShape(id: string | null) {
    setMultiSelection([]);
    if (id && (!visible(id) || lockedObject(id))) return;
    setSelectedNote(null);
    history.invalidate();
    const s = session.shapes?.find((s) => s.id === id);
    if (s && s.page !== current) navigate(s.page);
    setSelectedShape(s?.id ?? null);
    setSelectedId(null);
    setSelectedKey(null);
    history.invalidate();
    setPlacing(false);
    setTool("edit");
  }

  function selectStroke(id: string | null) {
    setMultiSelection([]);
    if (id && (!visible(id) || lockedObject(id))) return;
    setSelectedNote(null);
    const stroke = annotations.find((s) => s.id === id);
    if (stroke && stroke.page !== current) navigate(stroke.page);
    setSelectedShape(null);
    setSelectedKey(null);
    setSelectedId(stroke?.id ?? null);
  }

  function selectNote(id: string, pointer?: string, additive = false) {
    if (additive) {
      toggleSelection(id);
      return;
    }
    setMultiSelection([]);
    if (id && (!visible(id) || lockedObject(id))) return;
    if (id !== selectedNote || (pointer ?? null) !== selectedPointer)
      history.invalidate();
    const n = session.notes?.find((n) => n.id === id);
    if (n && n.page !== current) navigate(n.page);
    setSelectedNote(id || null);
    setSelectedPointer(pointer ?? null);
    setSelectedShape(null);
    setSelectedKey(null);
    setSelectedId(null);
    setTool("edit");
  }
  return (
    <div
      ref={root}
      className="pdf-navigation"
      onContextMenu={(e) => {
        let id = selectedNote ?? selectedKey ?? selectedShape ?? selectedId;
        let removeType:
          "remove-note" | "remove-key" | "remove-shape" | "remove-stroke" =
          selectedNote
            ? "remove-note"
            : selectedKey
              ? "remove-key"
              : selectedShape
                ? "remove-shape"
                : "remove-stroke";
        const node =
            e.target instanceof Element
              ? e.target.closest<HTMLElement>("[data-page]")
              : null,
          canvas = node?.querySelector("canvas");
        if (canvas) {
          const page = Number(node?.dataset.page),
            viewport = pages[page - 1].getViewport({ scale: scales[page - 1] }),
            rect = canvas.getBoundingClientRect(),
            client = { x: e.clientX, y: e.clientY },
            p = clientToPdf(client, rect, viewport);
          const key = [...(session.pageLegends ?? [])].reverse().find((k) => {
            if (k.page !== page || !visible(k.id) || lockedObject(k.id))
              return false;
            const [a, b, c, d] = keyMatrix(k),
              x = a * (p.x - k.x) + b * (p.y - k.y),
              y = c * (p.x - k.x) + d * (p.y - k.y);
            return (
              x >= 0 &&
              x <= k.width &&
              y >= 0 &&
              y <= layoutLegend(k, session.legends).height
            );
          });
          const note = [...(session.notes ?? [])].reverse().find((n) => {
            if (n.page !== page || !visible(n.id) || lockedObject(n.id))
              return false;
            if (n.type === "text") {
              const local = noteLocal(n, p);
              return (
                local.x >= 0 &&
                local.x <= n.width &&
                local.y >= 0 &&
                local.y <= n.height
              );
            }
            return !!pickShape(
              [
                {
                  ...n,
                  type: "line",
                  width: Math.max(n.width, n.head),
                  fill: null,
                },
              ],
              client,
              rect,
              viewport,
            );
          });
          const shape = pickShape(
            (session.shapes ?? []).filter(
              (s) => s.page === page && visible(s.id) && !lockedObject(s.id),
            ),
            client,
            rect,
            viewport,
          );
          const stroke = pickHighlight(
            annotations.filter(
              (s) => s.page === page && visible(s.id) && !lockedObject(s.id),
            ),
            client,
            rect,
            viewport,
          );
          id = key?.id ?? note?.id ?? shape?.id ?? stroke?.id ?? null;
          removeType = key
            ? "remove-key"
            : note
              ? "remove-note"
              : shape
                ? "remove-shape"
                : "remove-stroke";
          history.invalidate();
          setMultiSelection([]);
          setPlacing(false);
          setSelectedKey(key?.id ?? null);
          setSelectedNote(key ? null : (note?.id ?? null));
          setSelectedPointer(null);
          setSelectedShape(key || note ? null : (shape?.id ?? null));
          setSelectedId(key || note || shape ? null : (stroke?.id ?? null));
          if (id) setTool("edit");
        }
        openMenu(e, [
          {
            label: "Undo",
            disabled: disabled || !history.undoLabel,
            action: () => traverse("undo"),
          },
          {
            label: "Redo",
            disabled: disabled || !history.redoLabel,
            action: () => traverse("redo"),
          },
          {
            label: "Highlight",
            action: () => {
              history.invalidate();
              setPlacing(false);
              setTool("highlight");
            },
          },
          {
            label: "Select / edit markup",
            action: () => {
              history.invalidate();
              setPlacing(false);
              setTool("edit");
            },
          },
          ...(id
            ? [
                {
                  label: "Delete selected markup",
                  disabled,
                  action: () => dispatch({ type: removeType, id }),
                } as MenuItem,
              ]
            : []),
          { label: "Properties", action: () => togglePanel(true) },
          { label: "Fit to page", action: () => fit("page") },
          { label: "Fit to width", action: () => fit("width") },
          ...fileActions,
        ]);
      }}
    >
      <div className="primary-tools" role="toolbar" aria-label="Markup tools">
        <div
          className="tool-modes"
          role="group"
          aria-label="History"
          data-own-feedback
        >
          <button
            disabled={disabled || !history.undoLabel}
            title={`Undo ${history.undoLabel ?? ""} (Ctrl+Z)`}
            aria-keyshortcuts="Control+z"
            onClick={() => traverse("undo")}
          >
            <ToolIcon name="undo" />
            Undo
          </button>
          <button
            disabled={disabled || !history.redoLabel}
            title={`Redo ${history.redoLabel ?? ""} (Ctrl+Y / Ctrl+Shift+Z)`}
            aria-keyshortcuts="Control+y Control+Shift+z"
            onClick={() => traverse("redo")}
          >
            <ToolIcon name="redo" />
            Redo
          </button>
        </div>
        <div className="tool-modes" role="group" aria-label="Annotation mode">
          <button
            aria-pressed={tool === "highlight"}
            onClick={() => {
              setPlacing(false);
              setSelectedKey(null);
              history.invalidate();
              setSelectedShape(null);
              setTool("highlight");
              setSelectedNote(null);
              setSelectedId(null);
            }}
          >
            <ToolIcon name="highlight" />
            Highlight
          </button>
          <button
            aria-pressed={tool === "edit"}
            onClick={() => {
              history.invalidate();
              setPlacing(false);
              setTool("edit");
            }}
          >
            <ToolIcon name="select" />
            Select/Edit
          </button>
        </div>
        <label className="shape-tool-label">
          Shape{" "}
          <select
            aria-label="Shape tool"
            value={["rectangle", "ellipse", "line"].includes(tool) ? tool : ""}
            onChange={(e) => {
              if (!e.target.value) return;
              history.invalidate();
              setPlacing(false);
              setSelectedKey(null);
              setSelectedId(null);
              setSelectedShape(null);
              setSelectedNote(null);
              setTool(e.target.value as ShapeKind);
            }}
          >
            <option value="">Choose shape</option>
            <option value="rectangle">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="line">Line</option>
          </select>
        </label>
        <button
          aria-pressed={tool === "text"}
          onClick={() => {
            history.invalidate();
            setPlacing(false);
            setSelectedNote(null);
            setSelectedShape(null);
            setSelectedKey(null);
            setSelectedId(null);
            setTool("text");
          }}
        >
          <ToolIcon name="text" />
          Text
        </button>
        <button
          aria-pressed={tool === "arrow"}
          onClick={() => {
            history.invalidate();
            setPlacing(false);
            setSelectedNote(null);
            setSelectedShape(null);
            setSelectedKey(null);
            setSelectedId(null);
            setTool("arrow");
          }}
        >
          <ToolIcon name="arrow" />
          Arrow
        </button>
        <button
          aria-pressed={tool === "pan"}
          onClick={() => {
            history.invalidate();
            setPlacing(false);
            setPointerPlacement(null);
            setSelectedNote(null);
            setSelectedShape(null);
            setSelectedKey(null);
            setSelectedId(null);
            setTool("pan");
          }}
        >
          <ToolIcon name="hand" />
          Hand / Pan
        </button>
        <button
          ref={documentButton}
          aria-expanded={documentOpen}
          aria-controls="document-panel"
          onClick={() => {
            history.invalidate();
            setDocumentOpen(!documentOpen);
            if (!documentOpen && window.innerWidth < 1050) setPanelOpen(false);
          }}
        >
          <ToolIcon name="panel" />
          Pages & markups
        </button>
        <button
          className="properties-toggle"
          ref={panelButton}
          aria-expanded={panelOpen}
          aria-controls="workspace-panel"
          onClick={() => togglePanel(!panelOpen)}
        >
          <ToolIcon name="panel" />
          Properties
        </button>
        {historyFeedback && (
          <span
            className="history-feedback"
            role="status"
            key={historyFeedback.id}
          >
            {historyFeedback.message}
          </span>
        )}
      </div>
      {(selectionIds.length > 0 || clipboard || bulkMessage) && (
        <div
          className="selection-toolbar"
          role="toolbar"
          aria-label="Selected markups"
        >
          <span>{selectionIds.length} selected</span>
          <button
            disabled={disabled || !selectionIds.length}
            onClick={() => {
              copySelection();
              host.current?.focus({ preventScroll: true });
            }}
            title="Copy selected markups (Ctrl+C)"
          >
            Copy
          </button>
          <button
            disabled={disabled || !clipboard}
            onClick={() => {
              pasteSelection();
              host.current?.focus({ preventScroll: true });
            }}
            title="Paste on the current page (Ctrl+V)"
          >
            Paste
          </button>
          <button
            disabled={disabled || !selectionIds.length}
            onClick={() => {
              duplicateSelection();
              host.current?.focus({ preventScroll: true });
            }}
            title="Duplicate selected markups (Ctrl+D)"
          >
            Duplicate
          </button>
          <button
            disabled={disabled || !selectionIds.length}
            onClick={() => {
              deleteSelection();
              host.current?.focus({ preventScroll: true });
            }}
          >
            Delete selected
          </button>
          <select
            aria-label="Selection category"
            value=""
            disabled={disabled || !selectionIds.length}
            onChange={(e) => {
              const categoryId =
                e.target.value === "unassigned"
                  ? null
                  : e.target.value.replace(/^category:/, "");
              bulkOperation(() =>
                dispatch({
                  type: "assign-category",
                  ids: selectionIds,
                  categoryId,
                }),
              );
              host.current?.focus({ preventScroll: true });
            }}
          >
            <option value="" disabled>
              Assign category…
            </option>
            <option value="unassigned">Unassigned</option>
            {session.legends.map((l) => (
              <option key={l.id} value={`category:${l.id}`}>
                {l.name}
                {l.hidden ? " (Hidden)" : ""}
                {l.locked ? " (Locked)" : ""}
              </option>
            ))}
          </select>
          <button
            disabled={disabled || !selectionIds.length}
            onClick={() => {
              selectGroup([]);
              host.current?.focus({ preventScroll: true });
            }}
          >
            Clear selection
          </button>
          {bulkMessage && <span role="status">{bulkMessage}</span>}
        </div>
      )}
      <div className="workspace-body">
        {documentOpen && (
          <DocumentPanel
            selected={selectionIds}
            toggleSelection={toggleSelection}
            pages={pages}
            current={current}
            session={session}
            bookmarks={documentNavigation.bookmarks}
            disabled={disabled}
            close={() => {
              setDocumentOpen(false);
              documentButton.current?.focus();
            }}
            navigate={(page) => {
              navigate(page);
              host.current?.focus({ preventScroll: true });
            }}
            changeBookmarks={(bookmarks) => {
              latestBookmarks.current = bookmarks;
              reportNavigation(captureView(), bookmarks);
            }}
            reveal={revealMarkup}
          />
        )}
        <aside
          ref={panel}
          id="workspace-panel"
          className="workspace-panel"
          aria-label="Tools and properties"
          tabIndex={-1}
          hidden={!panelOpen}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              togglePanel(false);
            }
          }}
        >
          <div className="panel-heading">
            <strong>Properties</strong>
            <button
              onClick={() => togglePanel(false)}
              aria-label="Close panel"
              title="Close properties"
            >
              ×
            </button>
          </div>
          <p className="inspector-status" role="status">
            {tool === "pan"
              ? "Move around the page"
              : tool === "edit"
                ? "Select an annotation to edit"
                : tool.charAt(0).toUpperCase() + tool.slice(1)}
            {tool === "highlight"
              ? ` · ${session.legends.find((l) => l.id === activeLegendId)?.name ?? COLORS.find((c) => c.value === drawing.color)?.name ?? "Custom color"}`
              : ""}
          </p>
          <div className="annotation-tools">
            {(tool === "edit" || tool === "text" || tool === "arrow") && (
              <NoteControls
                notes={session.notes ?? []}
                selected={selectedNote}
                pointer={selectedPointer}
                onSelect={selectNote}
                editing={editingNote}
                onEdit={setEditingNote}
                onClose={() => setEditingNote(null)}
                onPointer={() => {
                  history.invalidate();
                  setPointerPlacement(selectedNote);
                  if (window.innerWidth <= 800) setPanelOpen(false);
                }}
                placing={!!pointerPlacement}
                history={history}
                dispatch={dispatch}
                disabled={disabled}
                revision={`${viewRevision}:${mode}:${zoom}:${tool}`}
              />
            )}
            {tool === "highlight" ? (
              <DrawingControls
                value={drawing}
                history={history}
                onChange={(drawing, manual) =>
                  dispatch({ type: "drawing", drawing, manual })
                }
              />
            ) : tool === "edit" && !currentShape && !selectedNote ? (
              <EditingControls
                session={session}
                history={history}
                selectedId={selectedId}
                onSelect={selectStroke}
                dispatch={dispatch}
              />
            ) : null}
            {((tool === "edit" && !selectedNote) ||
              ["rectangle", "ellipse", "line"].includes(tool)) && (
              <ShapeControls
                showProperties={
                  !!currentShape ||
                  ["rectangle", "ellipse", "line"].includes(tool)
                }
                line={tool === "line"}
                shapes={session.shapes ?? []}
                selected={selectedShape}
                onSelect={selectShape}
                value={currentShape ?? shapeStyle}
                onChange={(style) => {
                  if (currentShape)
                    dispatch({
                      type: "put-shape",
                      shape: { ...currentShape, ...style },
                      before: currentShape,
                    });
                  else setShapeStyle(style);
                }}
                onDelete={
                  currentShape
                    ? () =>
                        dispatch({ type: "remove-shape", id: currentShape.id })
                    : undefined
                }
              />
            )}
            {(tool === "highlight" || roundingStroke) && (
              <RoundingControl
                key={`${tool}:${selectedId}:${viewRevision}:${mode}:${zoom}:${disabled}`}
                value={
                  roundingStroke?.rounding ??
                  (tool === "highlight" ? drawing.rounding : undefined) ??
                  100
                }
                history={history}
                identity={roundingStroke ?? drawing}
                onPreview={setRoundingPreview}
                onCommit={(rounding, generation) => {
                  if (roundingStroke)
                    dispatch(
                      {
                        type: "edit-stroke",
                        id: roundingStroke.id,
                        before: roundingStroke,
                        edit: { rounding },
                      },
                      generation,
                    );
                  else {
                    const next = { ...drawing };
                    if (rounding === 100) delete next.rounding;
                    else next.rounding = rounding;
                    dispatch(
                      { type: "drawing", drawing: next, manual: false },
                      generation,
                    );
                  }
                }}
              />
            )}
          </div>
          <LegendControls session={session} dispatch={dispatch} />
          <PageLegendControls
            rows={rows}
            onRows={setPlacementRows}
            session={session}
            selected={selectedKey}
            pages={pages}
            current={current}
            placing={placing}
            history={history}
            revision={viewRevision}
            disabled={disabled}
            dispatch={dispatch}
            onPlace={() => {
              setSelectedNote(null);
              history.invalidate();
              if (!placing && window.innerWidth <= 800) setPanelOpen(false);
              setPlacing(!placing);
              setSelectedKey(null);
              setSelectedId(null);
            }}
            onSelect={(id) => {
              setMultiSelection([]);
              setSelectedNote(null);
              const k = session.pageLegends?.find((k) => k.id === id);
              if (k && k.page !== current) navigate(k.page);
              setSelectedShape(null);
              setSelectedKey(id || null);
              setSelectedId(null);
              setTool("edit");
            }}
          />
        </aside>
        <div
          ref={host}
          {...pan}
          className={`pdf-scroll ${pan.className}`}
          tabIndex={0}
          role="region"
          aria-label="PDF pages"
          onScroll={updateCurrent}
          onPointerDown={(event) => {
            setStrokePreview(null);
            if (
              tool === "edit" &&
              event.button === 0 &&
              event.target instanceof Element &&
              !event.target.closest(".annotation-overlay")
            ) {
              setMultiSelection([]);
              setSelectedId(null);
              setSelectedShape(null);
              setSelectedNote(null);
              setSelectedKey(null);
              setSelectedPointer(null);
            }
          }}
        >
          <div className="pdf-pages">
            {pages.map((page, index) => {
              const viewport = page.getViewport({ scale: scales[index] });
              return (
                <div
                  key={page.pageNumber}
                  data-page={page.pageNumber}
                  style={{
                    width: viewport.width,
                    minHeight: viewport.height + LABEL_HEIGHT,
                  }}
                >
                  <PdfPage
                    page={page}
                    scale={scales[index]}
                    active={rasterPages.includes(page.pageNumber)}
                    pixelBudget={Math.min(
                      16_000_000,
                      32_000_000 / Math.max(1, rasterPages.length),
                    )}
                  >
                    <AnnotationOverlay
                      locked={lockedObject}
                      page={page.pageNumber}
                      viewport={viewport}
                      style={drawing}
                      legendId={activeLegendId}
                      history={history}
                      tool={tool === "edit" ? "edit" : "highlight"}
                      selectedId={selectedId}
                      onSelect={(id, additive) => {
                        if (additive && id) {
                          toggleSelection(id);
                          return;
                        }
                        setMultiSelection([]);
                        setSelectedNote(null);
                        setSelectedShape(null);
                        setSelectedId(id);
                        setSelectedKey(null);
                      }}
                      onAction={dispatch}
                      legends={session.legends}
                      disabled={
                        disabled ||
                        !!editingNote ||
                        placing ||
                        !!pointerPlacement ||
                        (tool !== "highlight" && tool !== "edit")
                      }
                      viewRevision={viewRevision}
                      annotations={annotations
                        .filter(
                          (stroke) =>
                            stroke.page === page.pageNumber &&
                            visible(stroke.id),
                        )
                        .map((s) =>
                          s === roundingStroke && roundingPreview !== null
                            ? { ...s, rounding: roundingPreview }
                            : s,
                        )}
                      onCommit={(stroke, generation) =>
                        dispatch({ type: "commit", stroke }, generation)
                      }
                    />
                    <ShapeOverlay
                      locked={lockedObject}
                      page={page.pageNumber}
                      viewport={viewport}
                      shapes={(session.shapes ?? []).filter(
                        (s) => s.page === page.pageNumber && visible(s.id),
                      )}
                      tool={
                        tool === "text" || tool === "arrow" || tool === "pan"
                          ? "highlight"
                          : tool
                      }
                      style={{
                        ...shapeStyle,
                        fill: tool === "line" ? null : shapeStyle.fill,
                      }}
                      selected={selectedShape}
                      onSelect={(id, additive) => {
                        if (additive && id) {
                          toggleSelection(id);
                          return;
                        }
                        setMultiSelection([]);
                        setSelectedNote(null);
                        setSelectedShape(id);
                        setSelectedId(null);
                        setSelectedKey(null);
                      }}
                      dispatch={dispatch}
                      history={history}
                      disabled={
                        disabled ||
                        !!editingNote ||
                        placing ||
                        !!pointerPlacement
                      }
                      revision={viewRevision}
                    />
                    <NoteOverlay
                      locked={lockedObject}
                      page={page.pageNumber}
                      viewport={viewport}
                      notes={(session.notes ?? []).filter(
                        (n) => n.page === page.pageNumber && visible(n.id),
                      )}
                      tool={tool === "pan" ? "highlight" : tool}
                      selected={selectedNote}
                      pointer={selectedPointer}
                      placing={pointerPlacement}
                      onSelect={selectNote}
                      onEdit={(n) => {
                        setSelectedNote(n.id);
                        setEditingNote(n);
                      }}
                      onPlaced={() => setPointerPlacement(null)}
                      dispatch={dispatch}
                      history={history}
                      disabled={disabled || placing || !!editingNote}
                      revision={viewRevision}
                    />
                    <PageLegendOverlay
                      locked={lockedObject}
                      rows={rows}
                      page={page.pageNumber}
                      viewport={viewport}
                      session={workspaceSession}
                      history={history}
                      placing={placing}
                      onPlaced={() => {
                        setPlacing(false);
                        setPanelOpen(true);
                      }}
                      selected={selectedKey}
                      onSelect={(id, additive) => {
                        if (additive) {
                          toggleSelection(id);
                          return;
                        }
                        setMultiSelection([]);
                        setSelectedNote(null);
                        setSelectedShape(null);
                        setSelectedKey(id);
                        setSelectedId(null);
                        setTool("edit");
                      }}
                      dispatch={dispatch}
                      editing={tool === "edit" && !pointerPlacement}
                      disabled={disabled || !!editingNote || !!pointerPlacement}
                      revision={viewRevision}
                    />
                    {strokePreview && page.pageNumber === current && (
                      <StrokeSizePreview
                        {...strokePreview}
                        viewport={viewport}
                      />
                    )}
                    {groupObjects.some(
                      (o) => o.value.page === page.pageNumber,
                    ) && (
                      <SelectionOverlay
                        objects={groupObjects.filter(
                          (o) => o.value.page === page.pageNumber,
                        )}
                        session={session}
                        viewport={viewport}
                        scale={scales[index]}
                        limits={groupLimits}
                        history={history}
                        disabled={disabled || pan.className.includes("can-pan")}
                        revision={viewRevision}
                        onMove={moveSelection}
                      />
                    )}
                    {historyFeedback && (
                      <HistoryChangeOverlay
                        key={historyFeedback.id}
                        regions={historyFeedback.regions.filter(
                          (r) => r.page === page.pageNumber,
                        )}
                        viewport={viewport}
                      />
                    )}
                  </PdfPage>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="pdf-controls" role="toolbar" aria-label="PDF navigation">
        <div className="control-group" role="group" aria-label="Pages">
          <button
            disabled={current === 1}
            onClick={() => navigate(current - 1)}
          >
            Previous page
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitPage();
            }}
          >
            <label>
              Page{" "}
              <input
                aria-label="Page number"
                inputMode="numeric"
                pattern="[0-9]*"
                data-canvas-space-pan
                value={pageInput}
                onChange={(event) => {
                  if (/^\d*$/.test(event.target.value))
                    setPageInput(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitPage();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    setPageInput(String(current));
                    host.current?.focus({ preventScroll: true });
                  } else if (
                    event.key.length === 1 &&
                    !/\d/.test(event.key) &&
                    !event.ctrlKey &&
                    !event.metaKey &&
                    !event.altKey
                  )
                    event.preventDefault();
                }}
                onBlur={() => setPageInput(String(current))}
              />
            </label>
            <span> of {pages.length}</span>
          </form>
          <button
            disabled={current === pages.length}
            onClick={() => navigate(current + 1)}
          >
            Next page
          </button>
        </div>
        <div className="control-group" role="group" aria-label="Zoom">
          <button
            className="zoom-step"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={mode === "manual" && zoom <= MIN_ZOOM}
            onClick={() => changeZoom(activeScale / 1.25)}
          >
            −
          </button>
          <output aria-label="Zoom level">
            {Math.round(activeScale * 100)}%
          </output>
          <button
            className="zoom-step"
            aria-label="Zoom in"
            title="Zoom in"
            disabled={mode === "manual" && zoom >= MAX_ZOOM}
            onClick={() => changeZoom(activeScale * 1.25)}
          >
            +
          </button>
          <button onClick={() => changeZoom(1)}>100%</button>
          <button aria-pressed={mode === "page"} onClick={() => fit("page")}>
            Fit to page
          </button>
          <button aria-pressed={mode === "width"} onClick={() => fit("width")}>
            Fit to width
          </button>
        </div>
      </div>
    </div>
  );
}
