import NoteGraphic from "../Annotations/NoteGraphic";
import { highlightGroups } from "../../services/annotationEditing";
import { selectedObjects, selectionBounds } from "../../services/bulkEditing";
import { pdfToViewport } from "../../services/coordinates";
import { highlightOutline, svgPath } from "../../services/highlightGeometry";
import { shapePath } from "../../services/shapes";
import { symbolViewport, type ReusableSymbol } from "../../services/presets";

export default function SymbolPreview({ symbol }: { symbol: ReusableSymbol }) {
  const session = symbol.session,
    viewport = symbolViewport(symbol.width, symbol.height),
    objects = selectedObjects(
      session,
      [
        ...session.annotations,
        ...(session.shapes ?? []),
        ...(session.notes ?? []),
      ].map((o) => o.id),
    ),
    bounds = selectionBounds(objects, session.legends, viewport),
    width = bounds.right - bounds.left,
    height = bounds.bottom - bounds.top,
    pad = Math.max(width, height, 1) * 0.08,
    points = session.annotations.reduce((n, a) => n + a.points.length, 0),
    characters = (session.notes ?? []).reduce(
      (n, o) => n + (o.type === "text" ? o.text.length : 0),
      0,
    ),
    path = (p: ReturnType<typeof shapePath>) =>
      svgPath(p, (p) => pdfToViewport(p, viewport));
  if (points > 20000 || characters > 10000)
    return (
      <p>Preview omitted for this complex symbol · {objects.length} objects</p>
    );
  return (
    <svg
      className="symbol-preview"
      role="img"
      aria-label={`Preview of ${symbol.name}`}
      viewBox={`${bounds.left - pad} ${bounds.top - pad} ${width + 2 * pad} ${height + 2 * pad}`}
    >
      {[...highlightGroups(session.annotations)].map(([key, strokes]) => (
        <g key={key} opacity={strokes[0].opacity}>
          {strokes.map((a) =>
            (a.rounding ?? 100) < 100 ? (
              <path key={a.id} d={path(highlightOutline(a))} fill={a.color} />
            ) : (
              <polyline
                key={a.id}
                points={a.points
                  .map((p) => {
                    const q = pdfToViewport(p, viewport);
                    return `${q.x},${q.y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke={a.color}
                strokeWidth={a.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ),
          )}
        </g>
      ))}
      {(session.shapes ?? []).map((s) => (
        <path
          key={s.id}
          d={path(shapePath(s))}
          fill={s.fill ?? "none"}
          stroke={s.color}
          strokeWidth={s.width}
        />
      ))}
      {(session.notes ?? []).map((n) => (
        <NoteGraphic key={n.id} note={n} viewport={viewport} />
      ))}
    </svg>
  );
}
