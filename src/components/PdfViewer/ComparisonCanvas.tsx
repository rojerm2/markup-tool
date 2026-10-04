import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import {
  comparisonInk,
  comparisonRasterScale,
  comparisonSize,
} from "../../services/revisionComparison";
import ComparisonDetail from "./ComparisonDetail";

export default function ComparisonCanvas({
  page,
  scale,
  ink,
  label,
  style,
  rotation = 0,
  magnification = 1,
}: {
  page: PDFPageProxy;
  scale: number;
  ink: "baseline" | "revision" | null;
  label: string;
  style?: CSSProperties;
  rotation?: number;
  magnification?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Rendering…"),
    [error, setError] = useState("");
  useLayoutEffect(() => {
    const parent = host.current;
    if (!parent) return;
    // Own the backing canvas per effect so cancelled/StrictMode renders cannot race its replacement.
    const canvas = document.createElement("canvas");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", label);
    parent.replaceChildren(canvas);
    let cancelled = false,
      task: ReturnType<PDFPageProxy["render"]> | undefined;
    setError("");
    setStatus("Rendering…");

    function failed(e: unknown) {
      if (cancelled) return;
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
      setStatus("");
      setError(e instanceof Error ? e.message : String(e));
    }
    try {
      const base = comparisonSize(page.getViewport({ scale: 1 }));
      const rasterScale = comparisonRasterScale(
        base,
        scale * Math.min(window.devicePixelRatio || 1, 2),
      );
      const viewport = page.getViewport({ scale: rasterScale });
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      canvas.style.width = `${base.width * scale}px`;
      canvas.style.height = `${base.height * scale}px`;
      const context = canvas.getContext("2d", {
        willReadFrequently: ink !== null,
      });
      if (!context) throw new Error("Canvas rendering is unavailable.");
      task = page.render({
        canvas,
        canvasContext: context,
        viewport,
        background: "rgb(255,255,255)",
      });
      void task.promise
        .then(() => {
          if (cancelled) return;
          if (ink) {
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            );
            pixels.data.set(
              comparisonInk(
                pixels.data,
                ink === "baseline" ? [0, 102, 255] : [255, 72, 0],
              ),
            );
            context.putImageData(pixels, 0, 0);
          }
          setStatus("");
        })
        .catch(failed);
    } catch (e) {
      failed(e);
    }
    return () => {
      cancelled = true;
      task?.cancel();
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
      if (task)
        void task.promise
          .catch(() => {})
          .then(() => page.cleanup?.())
          .catch(() => {});
    };
  }, [page, scale, ink, label]);
  return (
    <div className="comparison-sheet" style={style}>
      <div ref={host} />
      <ComparisonDetail
        page={page}
        scale={scale}
        ink={ink}
        rotation={rotation}
        magnification={magnification}
        overview={host}
        ready={!status && !error}
      />
      {status && (
        <p className="comparison-render-status" role="status">
          {label}: {status}
        </p>
      )}
      {error && (
        <p className="comparison-render-error" role="alert">
          Could not render {label}: {error}. Choose another page or file.
        </p>
      )}
    </div>
  );
}
