import { useLayoutEffect, useRef, useState } from "react";
import {
  pdfWidthToViewport,
  type PageViewport,
} from "../../services/coordinates";

export default function StrokeSizePreview({
  width,
  color,
  viewport,
}: {
  width: number;
  color: string;
  viewport: PageViewport;
}) {
  const ref = useRef<SVGSVGElement>(null),
    [center, setCenter] = useState({
      x: viewport.width / 2,
      y: viewport.height / 2,
    });
  useLayoutEffect(() => {
    const position = () => {
      const svg = ref.current,
        host = svg?.closest(".pdf-scroll");
      if (!svg || !host) return;
      const page = svg.getBoundingClientRect(),
        visible = host.getBoundingClientRect();
      setCenter({
        x:
          (Math.max(page.left, visible.left) +
            Math.min(page.right, visible.right)) /
            2 -
          page.left,
        y:
          (Math.max(page.top, visible.top) +
            Math.min(page.bottom, visible.bottom)) /
            2 -
          page.top,
      });
    };
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [viewport.width, viewport.height]);
  const radius = pdfWidthToViewport(width, viewport) / 2;
  return (
    <svg
      ref={ref}
      className="stroke-size-preview"
      width={viewport.width}
      height={viewport.height}
      aria-label={`Highlighter preview: ${width} pt`}
      role="img"
    >
      <circle
        cx={center.x}
        cy={center.y}
        r={radius}
        fill={color}
        fillOpacity={0.4}
      />
      <circle
        cx={center.x}
        cy={center.y}
        r={Math.max(6, radius)}
        fill="none"
        stroke="#334155"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <g
        transform={`translate(${center.x - 46},${Math.max(8, center.y - Math.min(radius, 80) - 38)})`}
      >
        <rect width={92} height={28} rx={7} fill="#172033" />
        <text x={46} y={19} textAnchor="middle" fill="white" fontSize={13}>
          {width} pt
        </text>
      </g>
    </svg>
  );
}
