import { useEffect, useState } from "react";
import type { PDFPageProxy } from "pdfjs-dist";
import { loadDocument } from "../../services/pdfService";
import PdfNavigationView from "./PdfNavigationView";

type Props = {
  file: string | null;
};

export default function PdfViewer({ file }: Props) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (file === null) {
      setPages([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    const pdfPath = file;
    let isCancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        setIsLoading(true);
        setPages([]);
        setError(null);

        const pdf = await loadDocument(pdfPath, controller.signal);
        if (isCancelled) return;

        const resolvedPages = await Promise.all(
          Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1)),
        );

        if (!isCancelled) {
          setPages(resolvedPages);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "Failed to load PDF.");
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [file]);

  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-600">
        No PDF selected.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-600">
        Loading PDF...
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-1 items-center justify-center text-red-700">
        {error}
      </div>
    );
  }

  return pages.length ? <PdfNavigationView pages={pages} /> : null;
}
