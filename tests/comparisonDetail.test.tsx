import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist";
import ComparisonDetail from "../src/components/PdfViewer/ComparisonDetail";
import {
  MAX_COMPARISON_PIXELS,
  MAX_COMPARISON_EDGE,
} from "../src/services/revisionComparison";

function Harness({
  page,
  rotation = 0,
}: {
  page: PDFPageProxy;
  rotation?: number;
}) {
  const overview = useRef<HTMLDivElement>(null);
  return (
    <div className="comparison-viewport" data-testid="viewport">
      <div className="sheet">
        <div ref={overview}>
          <canvas data-testid="overview" />
        </div>
        <ComparisonDetail
          page={page}
          scale={1}
          ink="revision"
          rotation={rotation}
          magnification={1}
          overview={overview}
          ready
        />
      </div>
    </div>
  );
}
let left = -4000;
beforeEach(() => {
  vi.useFakeTimers();
  left = -4000;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return (
        this.className === "sheet"
          ? { left, top: -3000, width: 10000, height: 8000 }
          : { left: 0, top: 0, width: 800, height: 600 }
      ) as DOMRect;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
        putImageData: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function source() {
  const tasks: {
    canvas: HTMLCanvasElement;
    cancel: ReturnType<typeof vi.fn>;
    resolve: () => void;
    reject: (e: Error) => void;
    transform: number[];
  }[] = [];
  const page = {
    getViewport: () => ({ width: 10000, height: 8000 }),
    render: vi.fn((options) => {
      let resolve!: () => void, reject!: (e: Error) => void;
      const promise = new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const cancel = vi.fn();
      tasks.push({ ...options, cancel, resolve, reject });
      return { promise, cancel };
    }),
  } as unknown as PDFPageProxy;
  return { page, tasks };
}
it("cancels obsolete visible tiles, bounds allocation, and prevents double ink when publishing completed detail", async () => {
  const value = source(),
    view = render(<Harness page={value.page} />);
  const first = value.tasks[0];
  expect(first.canvas.width * first.canvas.height).toBeLessThanOrEqual(
    MAX_COMPARISON_PIXELS,
  );
  expect(Math.max(first.canvas.width, first.canvas.height)).toBeLessThanOrEqual(
    MAX_COMPARISON_EDGE,
  );
  expect(first.transform[4]).toBeLessThan(0);
  left = -5000;
  fireEvent.scroll(screen.getByTestId("viewport"));
  await act(async () => vi.advanceTimersByTime(80));
  expect(first.cancel).toHaveBeenCalledOnce();
  expect(value.tasks).toHaveLength(2);
  const second = value.tasks[1];
  await act(async () => first.resolve());
  expect(first.canvas.width).toBe(0);
  expect(document.querySelector(".comparison-detail canvas")).toBeNull();
  await act(async () => second.resolve());
  expect(document.querySelector(".comparison-detail canvas")).toBe(
    second.canvas,
  );
  expect(screen.getByTestId("overview").style.clipPath).toContain(
    "polygon(evenodd",
  );
  view.unmount();
  expect(second.canvas.width).toBe(0);
});
it("retains the overview on detail failure, retries after pan and releases pending work on replacement", async () => {
  const value = source(),
    view = render(<Harness page={value.page} />);
  await act(async () => value.tasks[0].reject(new Error("Malformed drawing")));
  expect(screen.getByRole("alert").textContent).toContain(
    "overview remains visible",
  );
  expect(screen.getByTestId("overview").style.clipPath).toBe("");
  expect(value.tasks[0].canvas.width).toBe(0);
  fireEvent.scroll(screen.getByTestId("viewport"));
  await act(async () => vi.advanceTimersByTime(80));
  expect(value.tasks).toHaveLength(2);
  const pending = value.tasks[1];
  view.rerender(<Harness page={value.page} rotation={45} />);
  expect(pending.cancel).toHaveBeenCalledOnce();
  await act(async () => pending.resolve());
  expect(pending.canvas.width).toBe(0);
  expect(document.querySelector(".comparison-detail canvas")).toBeNull();
  view.unmount();
  await act(async () => value.tasks[2].resolve());
  expect(value.tasks[2].canvas.width).toBe(0);
});
it("clears an old detail warning when the next page needs only an overview", async () => {
  const value = source(),
    view = render(<Harness page={value.page} />);
  await act(async () => value.tasks[0].reject(new Error("Bad detail")));
  expect(screen.getByRole("alert")).toBeTruthy();
  const small = {
    getViewport: () => ({ width: 600, height: 800 }),
    render: vi.fn(),
  } as unknown as PDFPageProxy;
  view.rerender(<Harness page={small} />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(small.render).not.toHaveBeenCalled();
});
