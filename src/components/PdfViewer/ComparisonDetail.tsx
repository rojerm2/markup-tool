import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import {
  comparisonInk,
  comparisonRasterScale,
  comparisonVisibleTile,
} from "../../services/revisionComparison";

/** One visible tile supplements the bounded overview. All coordinates are local
 * display pixels, including when the revision sheet is rotated or rescaled.
 */
export default function ComparisonDetail({
  page,
  scale,
  ink,
  rotation,
  magnification,
  overview,
  ready,
}: {
  page: PDFPageProxy;
  scale: number;
  ink: "baseline" | "revision" | null;
  rotation: number;
  magnification: number;
  overview: RefObject<HTMLDivElement | null>;
  ready: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    setError("");
    const host = ref.current,
      sheet = host?.parentElement,
      scroller = host?.closest<HTMLElement>(".comparison-viewport"),
      overviewCanvas = overview.current?.querySelector("canvas");
    if (!ready || !host || !sheet || !scroller || !overviewCanvas) return;
    const viewport = page.getViewport({ scale }),
      dpr = Math.min(window.devicePixelRatio || 1, 2),
      desired = dpr * magnification;
    if (comparisonRasterScale(viewport, desired) >= desired * 0.85) return;
    let disposed = false,
      key = "",
      timer: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<PDFPageProxy["render"]> | undefined,
      pendingCanvas: HTMLCanvasElement | undefined;
    const release = (canvas: HTMLCanvasElement) => {
      canvas.remove();
      canvas.width = 0;
      canvas.height = 0;
    };
    const cancel = () => {
      const task = pending,
        canvas = pendingCanvas;
      pending = undefined;
      pendingCanvas = undefined;
      task?.cancel();
      if (canvas)
        void (task?.promise ?? Promise.resolve())
          .catch(() => {})
          .then(() => release(canvas));
    };
    const clear = () => {
      for (const canvas of host.querySelectorAll("canvas")) release(canvas);
      overviewCanvas.style.clipPath = "";
    };
    const render = () => {
      if (disposed) return;
      const box = sheet.getBoundingClientRect(),
        visible = scroller.getBoundingClientRect();
      if (
        !box.width ||
        !box.height ||
        !scroller.clientWidth ||
        !scroller.clientHeight
      )
        return;
      const tile = comparisonVisibleTile(
        viewport,
        box,
        {
          left: visible.left + scroller.clientLeft,
          top: visible.top + scroller.clientTop,
          width: scroller.clientWidth,
          height: scroller.clientHeight,
        },
        rotation,
        magnification,
      );
      if (!tile) {
        cancel();
        clear();
        key = "";
        return;
      }
      const nextKey = `${tile.left}:${tile.top}:${tile.width}:${tile.height}`;
      if (key === nextKey) return;
      cancel();
      key = nextKey;
      const ratio = comparisonRasterScale(tile, desired),
        canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(tile.width * ratio));
      canvas.height = Math.max(1, Math.floor(tile.height * ratio));
      canvas.setAttribute("aria-hidden", "true");
      Object.assign(canvas.style, {
        position: "absolute",
        left: `${tile.left}px`,
        top: `${tile.top}px`,
        width: `${tile.width}px`,
        height: `${tile.height}px`,
      });
      const context = canvas.getContext("2d", {
        willReadFrequently: ink !== null,
      });
      const failed = () => {
        if (disposed || pendingCanvas !== canvas) return;
        pending = undefined;
        pendingCanvas = undefined;
        release(canvas);
        key = "";
        setError(
          "High-detail rendering failed. The overview remains visible; zoom or pan to retry.",
        );
      };
      pendingCanvas = canvas;
      try {
        if (!context) throw new Error("Canvas rendering is unavailable.");
        const task = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: [
            ratio,
            0,
            0,
            ratio,
            -tile.left * ratio,
            -tile.top * ratio,
          ],
          background: "rgb(255,255,255)",
        });
        pending = task;
        void task.promise
          .then(() => {
            if (disposed || pending !== task) return;
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
            clear();
            host.replaceChildren(canvas);
            // Cut the corresponding hole in the overview to avoid doubling colored ink.
            const l = tile.left,
              t = tile.top,
              r = l + tile.width,
              b = t + tile.height;
            overviewCanvas.style.clipPath = `polygon(evenodd, 0px 0px, ${viewport.width}px 0px, ${viewport.width}px ${viewport.height}px, 0px ${viewport.height}px, 0px 0px, ${l}px ${t}px, ${l}px ${b}px, ${r}px ${b}px, ${r}px ${t}px, ${l}px ${t}px)`;
            pending = undefined;
            pendingCanvas = undefined;
            setError("");
          })
          .catch(failed);
      } catch {
        failed();
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(render, 80);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(scroller);
    scroller.addEventListener("scroll", schedule, { passive: true });
    render();
    return () => {
      disposed = true;
      clearTimeout(timer);
      cancel();
      clear();
      observer.disconnect();
      scroller.removeEventListener("scroll", schedule);
    };
  }, [page, scale, ink, rotation, magnification, overview, ready]);
  return (
    <>
      <div
        ref={ref}
        className="comparison-detail"
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, overflow: "hidden" }}
      />
      {error && (
        <p className="comparison-render-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
