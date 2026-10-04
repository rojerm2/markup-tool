import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { AnnotationSession } from "../../services/annotationSession";
import type { PageViewport } from "../../services/coordinates";
import {
  selectionBounds,
  type SelectedObject,
} from "../../services/bulkEditing";
import type { SessionHistory } from "../../services/sessionHistory";
import { isSpaceKey } from "../../services/canvasFocus";

export default function SelectionOverlay({
  objects,
  session,
  viewport,
  scale,
  limits,
  history,
  disabled,
  revision,
  onMove,
}: {
  objects: SelectedObject[];
  session: AnnotationSession;
  viewport: PageViewport;
  scale: number;
  limits: { minX: number; maxX: number; minY: number; maxY: number };
  history: SessionHistory;
  disabled: boolean;
  revision: number;
  onMove: (
    dx: number,
    dy: number,
    generation: number,
    before: AnnotationSession,
  ) => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    generation: number;
    before: AnnotationSession;
    dx: number;
    dy: number;
  } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  function cancel() {
    const g = gesture.current;
    gesture.current = null;
    if (g && svg.current?.hasPointerCapture(g.id))
      svg.current.releasePointerCapture(g.id);
    setOffset({ x: 0, y: 0 });
  }
  const selectionKey = objects.map((o) => o.value.id).join("\0");
  useEffect(() => {
    cancel();
  }, [disabled, revision, session, selectionKey]);
  useEffect(() => {
    const a = history.subscribeCancellation(cancel),
      b = history.subscribeSnapshotCancellation(cancel);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" || isSpaceKey(e)) cancel();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("scroll", cancel, true);
    return () => {
      a();
      b();
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("scroll", cancel, true);
    };
  }, [history]);

  function update(e: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    g.dx = Math.max(
      limits.minX,
      Math.min(limits.maxX, (e.clientX - g.x) / scale),
    );
    g.dy = Math.max(
      limits.minY,
      Math.min(limits.maxY, (e.clientY - g.y) / scale),
    );
    setOffset({ x: g.dx * scale, y: g.dy * scale });
  }
  const bounds = selectionBounds(
    objects,
    session.legends,
    viewport,
    session.calibrations,
  );
  return (
    <svg
      ref={svg}
      className="selection-overlay annotation-overlay"
      aria-label={`Selection for page ${objects[0].value.page}`}
      width={viewport.width}
      height={viewport.height}
      style={{ pointerEvents: "none" }}
      onPointerDown={(e) => {
        if (
          disabled ||
          gesture.current ||
          e.button !== 0 ||
          e.shiftKey ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget
          .closest<HTMLElement>(".pdf-scroll")
          ?.focus({ preventScroll: true });
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          generation: history.generation,
          before: session,
          dx: 0,
          dy: 0,
        };
      }}
      onPointerMove={(e) => {
        if (gesture.current && !(e.buttons & 1)) cancel();
        else update(e);
      }}
      onPointerUp={(e) => {
        update(e);
        const g = gesture.current;
        cancel();
        if (g && g.id === e.pointerId && (g.dx || g.dy))
          onMove(g.dx, g.dy, g.generation, g.before);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    >
      <g transform={`translate(${offset.x} ${offset.y})`}>
        {objects.map((o) => {
          const b = selectionBounds([o], session.legends, viewport);
          return (
            <rect
              key={o.value.id}
              x={b.left}
              y={b.top}
              width={b.right - b.left}
              height={b.bottom - b.top}
              fill="none"
              stroke="var(--focus)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        <rect
          x={bounds.left - 4}
          y={bounds.top - 4}
          width={bounds.right - bounds.left + 8}
          height={bounds.bottom - bounds.top + 8}
          fill="none"
          stroke="var(--focus)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
          pointerEvents={disabled ? "none" : "stroke"}
          style={{ cursor: "move" }}
        >
          <title>Drag this outline to move selected markups</title>
        </rect>
      </g>
    </svg>
  );
}
