import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  boxHandles,
  resizeBox,
  type BoxHandle,
} from "../../services/resizeBox";
import {
  clientToPdf,
  pdfToViewport,
  type PageViewport,
} from "../../services/coordinates";
import {
  keyPoint,
  layoutLegend,
  newPageLegend,
  type PageLegend,
} from "../../services/pageLegend";
import type {
  AnnotationSession,
  SessionAction,
} from "../../services/annotationSession";
import type { SessionHistory } from "../../services/sessionHistory";
import { isEditingControl } from "../../services/annotationEditing";
import { isSpaceKey } from "../../services/canvasFocus";
import PageLegendGraphic from "./PageLegendGraphic";

export default function PageLegendOverlay({
  rows,
  page,
  viewport,
  session,
  history,
  placing,
  onPlaced,
  selected,
  onSelect,
  dispatch,
  editing,
  disabled,
  revision,
  locked = () => false,
}: {
  rows: string[];
  page: number;
  viewport: PageViewport;
  session: AnnotationSession;
  history: SessionHistory;
  placing: boolean;
  onPlaced: () => void;
  selected: string | null;
  onSelect: (id: string, additive?: boolean) => void;
  dispatch: (a: SessionAction, g?: number) => void;
  editing: boolean;
  disabled: boolean;
  revision: number;
  locked?: (id: string) => boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const placement = useRef<{
    key: PageLegend;
    pointer: number;
    generation: number;
    legends: AnnotationSession["legends"];
  } | null>(null);
  const move = useRef<{
    before: PageLegend;
    handle: BoxHandle | null;
    start: { x: number; y: number };
    client: { x: number; y: number };
    pointer: number;
    generation: number;
    legends: AnnotationSession["legends"];
  } | null>(null);
  const previewRef = useRef<PageLegend | null>(null);
  const [preview, setPreview] = useState<PageLegend | null>(null);

  function show(k: PageLegend | null) {
    previewRef.current = k;
    setPreview(k);
  }

  function cancel() {
    const pointer = move.current?.pointer ?? placement.current?.pointer;
    move.current = null;
    placement.current = null;
    show(null);
    if (pointer !== undefined && svg.current?.hasPointerCapture(pointer))
      svg.current.releasePointerCapture(pointer);
  }
  useEffect(() => history.subscribeCancellation(cancel), [history]);
  useEffect(() => {
    cancel();
  }, [placing, editing, disabled, revision, viewport.width, viewport.height]);
  useEffect(() => {
    if (
      move.current &&
      (!session.pageLegends?.includes(move.current.before) ||
        move.current.legends !== session.legends ||
        selected !== move.current.before.id)
    )
      cancel();
  }, [session, selected]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || (isSpaceKey(e) && !isEditingControl(e.target)))
        cancel();
    };
    const hidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("scroll", cancel, true);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancel();
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", cancel, true);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  function point(e: PointerEvent<SVGSVGElement>) {
    return clientToPdf(
      { x: e.clientX, y: e.clientY },
      e.currentTarget.getBoundingClientRect(),
      viewport,
    );
  }
  return (
    <svg
      ref={svg}
      className="page-legend-overlay"
      aria-label={`Page legends for page ${page}`}
      width={viewport.width}
      height={viewport.height}
      style={{ pointerEvents: placing && !disabled ? "auto" : "none" }}
      onPointerMove={(e) => {
        if (disabled) return;
        if (placing) {
          const p = point(e),
            k = {
              ...(placement.current?.key ??
                newPageLegend(page, viewport, rows)),
              ...p,
            };
          if (placement.current) placement.current.key = k;
          show(k);
          return;
        }
        const m = move.current;
        if (!m) return;
        if (!(e.buttons & 1)) {
          cancel();
          return;
        }
        if (
          Math.hypot(e.clientX - m.client.x, e.clientY - m.client.y) < 4 &&
          !previewRef.current
        )
          return;
        const p = point(e),
          delta = { x: p.x - m.start.x, y: p.y - m.start.y };
        show(
          m.handle
            ? resizeBox(
                {
                  ...m.before,
                  height: layoutLegend(m.before, session.legends).height,
                },
                m.handle,
                delta,
                m.before.layout === "columns" ? 140 : 100,
                (width) =>
                  layoutLegend(
                    { ...m.before, width, height: undefined },
                    session.legends,
                  ).height,
              )
            : { ...m.before, x: m.before.x + delta.x, y: m.before.y + delta.y },
        );
      }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0 || e.ctrlKey || e.metaKey || e.altKey)
          return;
        if (placing) {
          e.preventDefault();
          const key = { ...newPageLegend(page, viewport, rows), ...point(e) };
          placement.current = {
            key,
            pointer: e.pointerId,
            generation: history.generation,
            legends: session.legends,
          };
          show(key);
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        if (!editing) return;
        const id = (e.target as Element)
          .closest("[data-key-id]")
          ?.getAttribute("data-key-id");
        const before = session.pageLegends?.find((k) => k.id === id);
        if (!before) return;
        if (locked(before.id)) return;
        if (e.shiftKey && !(e.target as Element).closest("[data-key-handle]")) {
          e.currentTarget
            .closest<HTMLElement>(".pdf-scroll")
            ?.focus({ preventScroll: true });
          e.preventDefault();
          onSelect(before.id, true);
          return;
        }
        e.preventDefault();
        onSelect(before.id);
        e.currentTarget
          .closest<HTMLElement>(".pdf-scroll")
          ?.focus({ preventScroll: true });
        move.current = {
          before,
          handle: (e.target as Element)
            .closest("[data-key-handle]")
            ?.getAttribute("data-key-handle") as BoxHandle | null,
          start: point(e),
          client: { x: e.clientX, y: e.clientY },
          pointer: e.pointerId,
          generation: history.generation,
          legends: session.legends,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={() => {
        const m = move.current,
          k = previewRef.current,
          p = placement.current;
        cancel();
        if (p) {
          dispatch(
            { type: "put-key", key: p.key, legends: p.legends },
            p.generation,
          );
          onPlaced();
          onSelect(p.key.id);
        } else if (m && k)
          dispatch(
            { type: "put-key", key: k, before: m.before, legends: m.legends },
            m.generation,
          );
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerLeave={() => {
        if (!move.current && !placement.current) show(null);
      }}
    >
      {(session.pageLegends ?? [])
        .filter((k) => k.page === page)
        .map((k) => (
          <g
            key={k.id}
            style={{
              pointerEvents: editing && !disabled ? "all" : "none",
              cursor: editing && !disabled ? "pointer" : undefined,
            }}
          >
            <PageLegendGraphic
              value={move.current?.before === k && preview ? preview : k}
              legends={session.legends}
              viewport={viewport}
              selected={selected === k.id}
            />
          </g>
        ))}
      {editing &&
        !disabled &&
        session.pageLegends
          ?.filter((k) => k.page === page && k.id === selected)
          .map((k) => {
            const value = move.current?.before === k && preview ? preview : k;
            return boxHandles(
              value.width,
              layoutLegend(value, session.legends).height,
            ).map((h) => {
              const p = pdfToViewport(keyPoint(value, h.x, h.y), viewport);
              return (
                <rect
                  key={h.handle}
                  data-key-id={k.id}
                  data-key-handle={h.handle}
                  aria-label={`Resize legend ${h.handle}`}
                  x={p.x - 7}
                  y={p.y - 7}
                  width={14}
                  height={14}
                  fill="white"
                  stroke="#2563eb"
                  strokeWidth={2}
                  style={{ pointerEvents: "all", cursor: "crosshair" }}
                />
              );
            });
          })}
      {placing && preview && (
        <g opacity={0.8} pointerEvents="none">
          <PageLegendGraphic
            value={preview}
            legends={session.legends}
            viewport={viewport}
          />
        </g>
      )}
    </svg>
  );
}
