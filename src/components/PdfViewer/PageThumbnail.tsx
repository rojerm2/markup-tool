import { useLayoutEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import type { AnnotationSession } from "../../services/annotationSession";
import { pdfToViewport, pdfWidthToViewport } from "../../services/coordinates";
import { highlightOutline, svgPath } from "../../services/highlightGeometry";
import { highlightGroups } from "../../services/annotationEditing";
import { shapePath } from "../../services/shapes";
import NoteGraphic from "../Annotations/NoteGraphic";
import PageLegendGraphic from "../Annotations/PageLegendGraphic";

export default function PageThumbnail({
  page,
  session,
}: {
  page: PDFPageProxy;
  session: AnnotationSession;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(160 / base.width, 170 / base.height);
  const viewport = page.getViewport({ scale });
  useLayoutEffect(() => {
    const node = canvas.current;
    if (!node) return;
    setFailed(false);
    const ratio = Math.min(
      window.devicePixelRatio || 1,
      2,
      300 / Math.max(viewport.width, viewport.height),
    );
    node.width = Math.max(1, Math.ceil(viewport.width * ratio));
    node.height = Math.max(1, Math.ceil(viewport.height * ratio));
    const context = node.getContext("2d");
    if (!context) {
      setFailed(true);
      return;
    }
    let task: ReturnType<PDFPageProxy["render"]> | undefined;
    let cancelled = false;
    try {
      task = page.render({
        canvas: node,
        canvasContext: context,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      });
      void task.promise.catch(() => {
        if (!cancelled) setFailed(true);
      });
    } catch {
      setFailed(true);
    }
    return () => {
      cancelled = true;
      task?.cancel();
      node.width = 0;
      node.height = 0;
    };
  }, [page, scale]);
  const strokes = session.annotations.filter((s) => s.page === page.pageNumber);
  const shapes = (session.shapes ?? []).filter(
    (s) => s.page === page.pageNumber,
  );
  const notes = (session.notes ?? []).filter((n) => n.page === page.pageNumber);
  const keys = (session.pageLegends ?? []).filter(
    (k) => k.page === page.pageNumber,
  );
  const count = strokes.length + shapes.length + notes.length + keys.length;
  // Tiny previews should not process enormous paths or thousands of text glyphs.
  const detailed =
    count <= 200 &&
    strokes.reduce((n, s) => n + s.points.length, 0) <= 20000 &&
    notes.reduce((n, s) => n + (s.type === "text" ? s.text.length : 0), 0) <=
      10000;
  const point = (p: { x: number; y: number }) => pdfToViewport(p, viewport);
  return (
    <>
      <span
        className="thumbnail-surface"
        style={{ width: viewport.width, height: viewport.height }}
      >
        <canvas
          ref={canvas}
          aria-hidden="true"
          style={{ width: viewport.width, height: viewport.height }}
        />
        {detailed && (
          <svg
            aria-hidden="true"
            width={viewport.width}
            height={viewport.height}
          >
            {[...highlightGroups(strokes).values()].map((group, i) => (
              <path
                key={i}
                d={group
                  .map((s) => svgPath(highlightOutline(s), point))
                  .join(" ")}
                fill={group[0].color}
                opacity={group[0].opacity}
              />
            ))}
            {shapes.map((s) => (
              <path
                key={s.id}
                d={svgPath(shapePath(s), point)}
                fill={s.fill ?? "none"}
                stroke={s.color}
                strokeWidth={pdfWidthToViewport(s.width, viewport)}
              />
            ))}
            {notes.map((n) => (
              <NoteGraphic key={n.id} note={n} viewport={viewport} />
            ))}
            {keys.map((k) => (
              <PageLegendGraphic
                key={k.id}
                value={k}
                legends={session.legends}
                viewport={viewport}
              />
            ))}
          </svg>
        )}
      </span>
      {failed && <small>Preview unavailable</small>}
      {!!count && (
        <small>
          {detailed ? "" : "Source preview · "}
          {count} markup{count === 1 ? "" : "s"}
        </small>
      )}
    </>
  );
}
