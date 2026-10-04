import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist";
import ComparisonCanvas from "../src/components/PdfViewer/ComparisonCanvas";
import {
  MAX_COMPARISON_PIXELS,
  MAX_COMPARISON_EDGE,
} from "../src/services/revisionComparison";
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
});
afterEach(cleanup);

function fakePage(width: number, height: number) {
  let resolve!: () => void, reject!: (e: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const cancel = vi.fn(),
    release = vi.fn(),
    render = vi.fn(() => ({ promise, cancel }));
  const page = {
    pageNumber: 1,
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    }),
    render,
    cleanup: release,
  } as unknown as PDFPageProxy;
  return { page, resolve, reject, cancel, release, render };
}
it("bounds the backing allocation while keeping sheet geometry at the selected display scale", async () => {
  const source = fakePage(100000, 80000);
  const view = render(
    <ComparisonCanvas
      page={source.page}
      scale={4}
      ink={null}
      label="Baseline page 1"
    />,
  );
  const canvas = screen.getByRole("img", {
    name: "Baseline page 1",
  }) as HTMLCanvasElement;
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(
    MAX_COMPARISON_PIXELS,
  );
  expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(
    MAX_COMPARISON_EDGE,
  );
  expect(canvas.style.width).toBe("400000px");
  await act(async () => source.resolve());
  expect(screen.queryByRole("status")).toBeNull();
  view.unmount();
  expect(source.cancel).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0);
  expect(canvas.height).toBe(0);
});
it("cancels replaced and StrictMode renders on distinct canvases and ignores late old errors", async () => {
  const old = fakePage(600, 800),
    next = fakePage(400, 300);
  const view = render(
    <StrictMode>
      <ComparisonCanvas
        page={old.page}
        scale={1}
        ink={null}
        label="Baseline page 1"
      />
    </StrictMode>,
  );
  expect(old.render).toHaveBeenCalledTimes(2);
  const first = old.render.mock.calls[0] as unknown as [
    { canvas: HTMLCanvasElement },
  ];
  const second = old.render.mock.calls[1] as unknown as [
    { canvas: HTMLCanvasElement },
  ];
  expect(first[0].canvas).not.toBe(second[0].canvas);
  expect(old.cancel).toHaveBeenCalledOnce();
  view.rerender(
    <StrictMode>
      <ComparisonCanvas
        page={next.page}
        scale={1}
        ink={null}
        label="Baseline page 2"
      />
    </StrictMode>,
  );
  expect(old.cancel).toHaveBeenCalledTimes(2);
  await act(async () => old.reject(new Error("Old failure")));
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => next.resolve());
  expect(screen.getByRole("img", { name: "Baseline page 2" })).toBeTruthy();
  view.unmount();
  expect(next.cancel).toHaveBeenCalledOnce();
});
it("converts only completed render pixels to colored ink and exposes errors without retaining a drawing", async () => {
  const source = fakePage(1, 1),
    pixels = { data: new Uint8ClampedArray([0, 0, 0, 255]) } as ImageData;
  const put = vi.fn();
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({
    getImageData: () => pixels,
    putImageData: put,
  } as unknown as CanvasRenderingContext2D);
  const view = render(
    <ComparisonCanvas
      page={source.page}
      scale={1}
      ink="revision"
      label="Revision page 1"
    />,
  );
  expect(put).not.toHaveBeenCalled();
  await act(async () => source.resolve());
  expect([...pixels.data]).toEqual([255, 72, 0, 255]);
  expect(put).toHaveBeenCalledOnce();
  const failed = fakePage(1, 1);
  view.rerender(
    <ComparisonCanvas
      page={failed.page}
      scale={1}
      ink="revision"
      label="Revision page 2"
    />,
  );
  await act(async () => failed.reject(new Error("Malformed content")));
  expect(screen.getByRole("alert").textContent).toContain("Malformed content");
  expect(screen.queryByRole("img", { name: "Revision page 2" })).toBeNull();
});
