import {
  measurementPath,
  measurementTextLayout,
  type Measurement,
  type PageCalibration,
} from "../../services/measurements";
import {
  pdfToViewport,
  pdfWidthToViewport,
  type PageViewport,
} from "../../services/coordinates";
import { svgPath } from "../../services/highlightGeometry";
import { textWidth } from "../../services/pageLegend";

export default function MeasurementGraphic({
  value,
  viewport,
  calibration,
  editing = false,
}: {
  value: Measurement;
  viewport: PageViewport;
  calibration?: PageCalibration;
  editing?: boolean;
}) {
  const box = measurementTextLayout(value, calibration),
    p = pdfToViewport(box, viewport),
    x = pdfToViewport({ x: box.x + 1, y: box.y }, viewport),
    y = pdfToViewport({ x: box.x, y: box.y - 1 }, viewport);
  let at = 3;
  const path = svgPath(measurementPath(value), (p) =>
    pdfToViewport(p, viewport),
  );
  return (
    <g data-measurement-id={value.id}>
      {value.type === "area" && (
        <path d={path} fill={value.color} opacity={0.12} pointerEvents="none" />
      )}
      <path
        d={path}
        fill="none"
        stroke={value.color}
        strokeWidth={pdfWidthToViewport(value.width, viewport)}
        strokeLinejoin="round"
        pointerEvents="none"
      />
      {editing && (
        <path
          d={path}
          fill={value.type === "area" ? "transparent" : "none"}
          stroke="transparent"
          strokeWidth={pdfWidthToViewport(value.width, viewport) + 10}
          pointerEvents={value.type === "area" ? "all" : "stroke"}
          style={{ cursor: "pointer" }}
        />
      )}
      <g
        transform={`matrix(${x.x - p.x} ${x.y - p.y} ${y.x - p.x} ${y.y - p.y} ${p.x} ${p.y})`}
      >
        <rect
          width={box.width}
          height={box.height}
          fill="white"
          stroke={value.color}
          strokeWidth={0.5}
          pointerEvents={editing ? "all" : "none"}
          style={{ cursor: editing ? "pointer" : undefined }}
        />
        <text
          y={box.baseline}
          fontFamily="LegendSans"
          fontSize={value.fontSize}
          fill={value.color}
          pointerEvents="none"
          style={{ fontKerning: "none" }}
        >
          {[...box.text].map((c, i) => {
            const x = at;
            at += textWidth(c, value.fontSize);
            return (
              <tspan key={i} x={x}>
                {c}
              </tspan>
            );
          })}
        </text>
      </g>
    </g>
  );
}
