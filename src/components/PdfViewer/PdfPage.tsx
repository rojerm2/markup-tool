import { useLayoutEffect, useRef, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";

import type { ReactNode } from "react";

type Props = { page: PDFPageProxy; scale?: number; children?: ReactNode };

export default function PdfPage({ page, scale = 1.25, children }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Each effect owns its canvas, including during StrictMode cleanup/replay.
    const canvas = document.createElement("canvas");
    canvas.className = "block bg-white shadow-sm";
    canvas.setAttribute("aria-label", `PDF page ${page.pageNumber}`);
    host.replaceChildren(canvas);
    setError(null);
    const viewport = page.getViewport({ scale });
    // Bound allocation for very large engineering sheets.
    const ratio = Math.min(window.devicePixelRatio || 1,
      8192 / Math.max(viewport.width, viewport.height),
      Math.sqrt(16_000_000 / (viewport.width * viewport.height)));
    canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
    canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Canvas rendering is unavailable.");
      return () => canvas.remove();
    }
    let cancelled = false;
    const task = page.render({ canvas, canvasContext: context, viewport,
      transform: [ratio, 0, 0, ratio, 0, 0] });
    void task.promise.catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      task.cancel();
      canvas.remove();
    };
  }, [page, scale]);

  return (
    <section aria-label={`Page ${page.pageNumber}`}>
      <p className="page-label">Page {page.pageNumber}</p>
      {error && <p role="alert">Could not render page {page.pageNumber}: {error}</p>}
      <div className="page-surface"><div ref={hostRef} />{children}</div>
    </section>
  );
}
