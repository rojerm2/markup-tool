import { useEffect, useRef, useState, type PointerEvent } from "react";
import {
  clientToPdf,
  pdfToClient,
  pdfToViewport,
  viewportToPdf,
  type PageViewport,
  type Point,
} from "../../services/coordinates";
import {
  MAX_MEASUREMENT_VERTICES,
  validMeasurement,
  type Measurement,
  type PageCalibration,
} from "../../services/measurements";
import type {
  AnnotationSession,
  SessionAction,
} from "../../services/annotationSession";
import type { SessionHistory } from "../../services/sessionHistory";
import { isEditingControl } from "../../services/annotationEditing";
import { isSpaceKey } from "../../services/canvasFocus";
import { constrainedPoint } from "../../services/shapes";
import { movementLimits, selectedObjects } from "../../services/bulkEditing";
import MeasurementGraphic from "./MeasurementGraphic";

export type MeasurementTool =
  "measure-length" | "measure-area" | "measure-perimeter" | "measure-calibrate";
export type MeasurementStyle = Pick<
  Measurement,
  "color" | "width" | "fontSize"
>;

export default function MeasurementOverlay({
  page,
  viewport,
  baseViewport,
  session,
  values,
  calibration,
  reference,
  tool,
  selected,
  style,
  history,
  revision,
  disabled,
  onSelect,
  onScale,
  dispatch,
  onError,
  locked,
}: {
  page: number;
  viewport: PageViewport;
  baseViewport: PageViewport;
  session: AnnotationSession;
  values: Measurement[];
  calibration?: PageCalibration;
  reference?: { a: Point; b: Point };
  tool: MeasurementTool | "edit" | null;
  selected: string | null;
  style: MeasurementStyle;
  history: SessionHistory;
  revision: number;
  disabled: boolean;
  onSelect: (id: string, additive?: boolean) => void;
  onScale: (page: number, a: Point, b: Point, generation: number) => void;
  dispatch: (action: SessionAction, generation?: number) => void;
  onError: (message: string) => void;
  locked: (id: string) => boolean;
}) {
  const svg = useRef<SVGSVGElement>(null),
    active = useRef<{
      pointer?: number;
      generation: number;
      points: Point[];
      start?: Point;
      before?: Measurement;
      vertex?: number;
      style: MeasurementStyle;
    } | null>(null);
  const [preview, setPreview] = useState<Point[] | null>(null);
  const current = values.find((v) => v.id === selected);
  const latest = useRef({ tool, onError, onScale, dispatch });
  latest.current = { tool, onError, onScale, dispatch };

  function cancel() {
    const g = active.current;
    active.current = null;
    if (g?.pointer !== undefined && svg.current?.hasPointerCapture(g.pointer))
      svg.current.releasePointerCapture(g.pointer);
    setPreview(null);
  }

  function finish() {
    const g = active.current;
    if (!g) return;
    const points = g.points,
      before = g.before;
    const mode = latest.current.tool;
    cancel();
    if (g.generation !== history.generation) return;
    if (mode === "measure-calibrate" && points.length === 2) {
      if (
        Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) < 1e-6
      )
        return;
      latest.current.onScale(page, points[0], points[1], g.generation);
      return;
    }
    const value: Measurement = before
      ? { ...before, points }
      : {
          id: crypto.randomUUID(),
          page,
          type:
            mode === "measure-area"
              ? "area"
              : mode === "measure-perimeter"
                ? "perimeter"
                : "length",
          points,
          ...g.style,
        };
    if (!validMeasurement(value)) {
      latest.current.onError(
        "Use distinct points and a simple polygon without crossing or overlapping edges.",
      );
      return;
    }
    latest.current.dispatch(
      { type: "put-measurement", measurement: value, before },
      g.generation,
    );
  }
  useEffect(() => {
    cancel();
  }, [
    tool,
    revision,
    disabled,
    viewport.width,
    viewport.height,
    session.measurements,
    session.calibrations,
    session.legends,
    session.objectCategories,
  ]);
  useEffect(() => {
    const a = history.subscribeCancellation(cancel),
      b = history.subscribeSnapshotCancellation(cancel);
    const key = (e: KeyboardEvent) => {
      if (!active.current) return;
      if (e.key === "Escape" || isSpaceKey(e)) cancel();
      else if (
        e.key === "Enter" &&
        !isEditingControl(e.target) &&
        e.target instanceof Node &&
        svg.current?.closest(".pdf-scroll")?.contains(e.target)
      ) {
        e.preventDefault();
        finish();
      }
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
  }, [history, page]);

  function point(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return clientToPdf(
      {
        x: Math.max(rect.left, Math.min(rect.right, e.clientX)),
        y: Math.max(rect.top, Math.min(rect.bottom, e.clientY)),
      },
      rect,
      viewport,
    );
  }

  function update(e: PointerEvent<SVGSVGElement>) {
    const g = active.current;
    if (!g || (g.pointer !== undefined && g.pointer !== e.pointerId)) return;
    let p = point(e);
    if (g.before && g.vertex === undefined && g.start) {
      const ratio = viewport.width / baseViewport.width,
        dx = (e.clientX - g.start.x) / ratio,
        dy = (e.clientY - g.start.y) / ratio;
      const limits = movementLimits(
          selectedObjects(session, [g.before.id]),
          session.legends,
          () => baseViewport,
          session.calibrations,
        ),
        a = viewportToPdf({ x: 0, y: 0 }, baseViewport),
        b = viewportToPdf(
          {
            x: Math.max(limits.minX, Math.min(limits.maxX, dx)),
            y: Math.max(limits.minY, Math.min(limits.maxY, dy)),
          },
          baseViewport,
        );
      g.points = g.before.points.map((p) => ({
        x: p.x + b.x - a.x,
        y: p.y + b.y - a.y,
      }));
    } else if (g.before && g.vertex !== undefined)
      g.points = g.before.points.map((v, i) => (i === g.vertex ? p : v));
    else if (g.pointer !== undefined) {
      p = constrainedPoint(
        g.points[0],
        p,
        "line",
        e.shiftKey,
        e.currentTarget.getBoundingClientRect(),
        viewport,
      );
      const v = pdfToViewport(p, viewport);
      p = viewportToPdf(
        {
          x: Math.max(0, Math.min(viewport.width, v.x)),
          y: Math.max(0, Math.min(viewport.height, v.y)),
        },
        viewport,
      );
      g.points = [g.points[0], p];
    } else {
      setPreview([...g.points, p]);
      return;
    }
    setPreview([...g.points]);
  }
  const transformed = (points: Point[]) =>
    points
      .map((p) => {
        const v = pdfToViewport(p, viewport);
        return `${v.x},${v.y}`;
      })
      .join(" ");
  const candidate = current && preview ? { ...current, points: preview } : null;
  return (
    <svg
      ref={svg}
      className="annotation-overlay measurement-overlay"
      aria-label={`Measurements for page ${page}`}
      width={viewport.width}
      height={viewport.height}
      style={{
        pointerEvents:
          tool?.startsWith("measure-") && !disabled ? "auto" : "none",
      }}
      onPointerDown={(e) => {
        if (
          disabled ||
          !tool ||
          e.button !== 0 ||
          e.ctrlKey ||
          e.metaKey ||
          e.altKey
        )
          return;
        const id = (e.target as Element)
            .closest("[data-measurement-id]")
            ?.getAttribute("data-measurement-id"),
          before = values.find((v) => v.id === id);
        if (tool === "edit" && (!before || locked(before.id))) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget
          .closest<HTMLElement>(".pdf-scroll")
          ?.focus({ preventScroll: true });
        if (tool === "edit" && before) {
          const handle = (e.target as Element).closest(
            "[data-measurement-vertex]",
          );
          if (e.shiftKey && !handle) {
            onSelect(before.id, true);
            return;
          }
          onSelect(before.id);
          active.current = {
            pointer: e.pointerId,
            generation: history.generation,
            points: before.points,
            before,
            start: { x: e.clientX, y: e.clientY },
            vertex: handle
              ? Number(handle.getAttribute("data-measurement-vertex"))
              : undefined,
            style: before,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        const p = point(e);
        if (tool === "measure-length" || tool === "measure-calibrate") {
          if (active.current) return;
          active.current = {
            pointer: e.pointerId,
            generation: history.generation,
            points: [p, p],
            style: { ...style },
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          setPreview([p, p]);
        } else {
          const g = active.current ?? {
            generation: history.generation,
            points: [],
            style: { ...style },
          };
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            g.points.length >= 3 &&
            Math.hypot(
              e.clientX - pdfToClient(g.points[0], rect, viewport).x,
              e.clientY - pdfToClient(g.points[0], rect, viewport).y,
            ) < 8
          ) {
            finish();
            return;
          }
          const last = g.points[g.points.length - 1];
          if (last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-6) return;
          if (g.points.length >= MAX_MEASUREMENT_VERTICES) {
            onError(
              `Use up to ${MAX_MEASUREMENT_VERTICES} vertices, then press Enter.`,
            );
            return;
          }
          active.current = g;
          g.points = [...g.points, p];
          setPreview(g.points);
        }
      }}
      onPointerMove={(e) => {
        if (active.current?.pointer !== undefined && !(e.buttons & 1)) cancel();
        else update(e);
      }}
      onPointerUp={(e) => {
        if (active.current?.pointer !== e.pointerId) return;
        update(e);
        finish();
      }}
      onDoubleClick={(e) => {
        if (active.current?.pointer === undefined && active.current) {
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={() => {
        if (active.current?.pointer !== undefined) cancel();
      }}
    >
      {tool === "measure-calibrate" && reference && !preview && (
        <g aria-label="Scale reference" pointerEvents="none">
          <polyline
            points={transformed([reference.a, reference.b])}
            fill="none"
            stroke="#0284c7"
            strokeWidth={2}
            strokeDasharray="5 3"
          />
          {[reference.a, reference.b].map((p, i) => {
            const v = pdfToViewport(p, viewport);
            return (
              <circle
                key={i}
                cx={v.x}
                cy={v.y}
                r={5}
                fill="white"
                stroke="#0284c7"
                strokeWidth={2}
              />
            );
          })}
        </g>
      )}
      {values.map((v) => {
        const shown =
          v === current && candidate && validMeasurement(candidate)
            ? candidate
            : v;
        return (
          <MeasurementGraphic
            key={v.id}
            value={shown}
            viewport={viewport}
            calibration={calibration}
            editing={tool === "edit" && !disabled && !locked(v.id)}
          />
        );
      })}
      {preview && (!candidate || !validMeasurement(candidate)) && (
        <polyline
          points={transformed(preview)}
          fill="none"
          stroke={candidate ? "#ef4444" : style.color}
          strokeWidth={2}
          strokeDasharray="5 3"
          pointerEvents="none"
        />
      )}
      {current && tool === "edit" && !disabled && !locked(current.id) && (
        <g data-measurement-id={current.id}>
          {(candidate?.points ?? current.points).map((p, i) => {
            const v = pdfToViewport(p, viewport);
            return (
              <circle
                key={i}
                data-measurement-vertex={i}
                cx={v.x}
                cy={v.y}
                r={5}
                fill="white"
                stroke={current.color}
                strokeWidth={1.5}
                pointerEvents="all"
                style={{ cursor: "crosshair" }}
              />
            );
          })}
        </g>
      )}
    </svg>
  );
}
