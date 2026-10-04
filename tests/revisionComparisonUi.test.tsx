import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist";
import RevisionComparison, {
  type ComparisonDocument,
} from "../src/components/PdfViewer/RevisionComparison";
import * as files from "../src/services/projectService";
vi.mock("../src/services/projectService", () => ({
  choosePdf: vi.fn(),
  loadSource: vi.fn(),
}));
vi.mock("../src/components/PdfViewer/ComparisonCanvas", () => ({
  default: ({
    label,
    page,
    style,
    ink,
  }: {
    label: string;
    page: PDFPageProxy;
    style: React.CSSProperties;
    ink: string | null;
  }) => (
    <div
      role="img"
      aria-label={label}
      style={style}
      data-page={page.pageNumber}
      data-ink={ink}
    />
  ),
}));

function document(
  filename: string,
  count: number,
  width = 600,
  height = 800,
): ComparisonDocument {
  return {
    path: `C:/${filename}`,
    source: {
      filename,
      reference: `C:/${filename}`,
      sha256: "a".repeat(64),
      size: 10,
      pages: count,
    },
    pages: Array.from({ length: count }, (_, i) => ({
      pageNumber: i + 1,
      getViewport: ({ scale }: { scale: number }) => ({
        width: width * scale,
        height: height * scale,
      }),
    })) as unknown as PDFPageProxy[],
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

async function openRevision(value: ComparisonDocument) {
  vi.mocked(files.choosePdf).mockResolvedValueOnce(value.path);
  vi.mocked(files.loadSource).mockResolvedValueOnce({
    source: value.source,
    pages: value.pages,
  });
  click("Choose revision PDF");
  await waitFor(() =>
    expect(screen.getByText(value.source.filename)).toBeTruthy(),
  );
}
it("pairs a borrowed baseline with a selected PDF, applies stable manual alignment and resets on page changes without mutating source data", async () => {
  const baseline = document("baseline.pdf", 3),
    revision = document("revision.pdf", 2, 800, 600),
    close = vi.fn();
  const sourceSnapshot = structuredClone(baseline.source);
  render(
    <RevisionComparison baseline={baseline} initialPage={2} onClose={close} />,
  );
  await openRevision(revision);
  expect(screen.getByRole("img", { name: "Baseline page 2" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Revision page 2" })).toBeTruthy();
  change("View", "overlay");
  expect(
    screen
      .getByRole("img", { name: "Baseline page 2" })
      .getAttribute("data-ink"),
  ).toBe("baseline");
  const target = screen.getByRole("img", { name: "Revision page 2" });
  expect(target.getAttribute("data-ink")).toBe("revision");
  change("Horizontal offset (%)", "-50");
  fireEvent.blur(screen.getByLabelText("Horizontal offset (%)"));
  change("Rotation (°)", "90");
  fireEvent.blur(screen.getByLabelText("Rotation (°)"));
  expect(target.style.transform).toContain("rotate(90deg)");
  expect(target.style.transform).toMatch(/translate\(-/);
  const viewport = screen.getByLabelText("Overlay viewport");
  viewport.scrollLeft = 200;
  viewport.scrollTop = 300;
  click("Fit sheets");
  expect(viewport.scrollLeft).toBe(0);
  expect(viewport.scrollTop).toBe(0);
  const board = viewport.querySelector<HTMLElement>(".comparison-board")!;
  expect(parseFloat(board.style.width)).toBeLessThanOrEqual(768);
  expect(parseFloat(board.style.height)).toBeLessThanOrEqual(460);
  click("Previous revision page");
  expect(
    (screen.getByLabelText("Horizontal offset (%)") as HTMLInputElement).value,
  ).toBe("0");
  expect(
    screen.getByRole("img", { name: "Revision page 1" }).style.transform,
  ).toContain("rotate(0deg)");
  change("Baseline page", "1e1");
  expect(
    (screen.getByLabelText("Baseline page") as HTMLInputElement).value,
  ).toBe("2");
  change("Baseline page", "4");
  fireEvent.blur(screen.getByLabelText("Baseline page"));
  expect(screen.getByRole("alert").textContent).toContain("between 1 and 3");
  expect(baseline.source).toEqual(sourceSnapshot);
  click("Close comparison");
  expect(close).toHaveBeenCalledOnce();
});
it("does not silently clamp an absent revision page and requires explicit pairing for unequal page counts", async () => {
  render(
    <RevisionComparison
      baseline={document("baseline.pdf", 3)}
      initialPage={3}
      onClose={vi.fn()}
    />,
  );
  await openRevision(document("short.pdf", 1));
  expect(screen.getByText(/The revision has no page 3/)).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  expect(
    (screen.getByLabelText("Revision page") as HTMLInputElement).value,
  ).toBe("");
  click("First revision page");
  expect(screen.getByRole("img", { name: "Baseline page 3" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "Revision page 1" })).toBeTruthy();
});
it("cancelled or failed replacements retain the prior revision, abort partial documents and release only owned sources on close", async () => {
  const baseline = document("baseline.pdf", 1),
    view = render(<RevisionComparison baseline={baseline} onClose={vi.fn()} />);
  await openRevision(document("revision.pdf", 1));
  const firstSignal = vi.mocked(files.loadSource).mock.calls[0][1];
  vi.mocked(files.choosePdf).mockResolvedValueOnce(null);
  click("Replace revision PDF");
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Replace revision PDF",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  expect(firstSignal.aborted).toBe(false);
  let failedSignal!: AbortSignal;
  vi.mocked(files.choosePdf).mockResolvedValueOnce("C:/broken.pdf");
  vi.mocked(files.loadSource).mockImplementationOnce(async (_, signal) => {
    failedSignal = signal;
    throw new Error("Invalid PDF");
  });
  click("Replace revision PDF");
  await screen.findByRole("alert");
  expect(screen.getByText("revision.pdf")).toBeTruthy();
  expect(failedSignal.aborted).toBe(true);
  expect(firstSignal.aborted).toBe(false);
  view.unmount();
  expect(firstSignal.aborted).toBe(true);
  expect(baseline.pages).toHaveLength(1);
});
it("loading cancellation rejects late completion and leaves selected source files alone", async () => {
  render(<RevisionComparison onClose={vi.fn()} />);
  let finish!: (value: Awaited<ReturnType<typeof files.loadSource>>) => void;
  vi.mocked(files.choosePdf).mockResolvedValueOnce("C:/late.pdf");
  vi.mocked(files.loadSource).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  click("Choose baseline PDF");
  await waitFor(() => expect(files.loadSource).toHaveBeenCalledOnce());
  click("Cancel loading");
  const value = document("late.pdf", 1);
  await act(async () => finish({ source: value.source, pages: value.pages }));
  expect(screen.queryByText("late.pdf")).toBeNull();
  expect(screen.getByText(/Loading cancelled/)).toBeTruthy();
  expect(vi.mocked(files.loadSource).mock.calls[0][1].aborted).toBe(true);
});
it("uses the latest baseline page after loading and synchronizes independent viewports", async () => {
  render(
    <RevisionComparison
      baseline={document("baseline.pdf", 3)}
      onClose={vi.fn()}
    />,
  );
  let finish!: (value: Awaited<ReturnType<typeof files.loadSource>>) => void;
  vi.mocked(files.choosePdf).mockResolvedValueOnce("C:/short.pdf");
  vi.mocked(files.loadSource).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  click("Choose revision PDF");
  await waitFor(() => expect(files.loadSource).toHaveBeenCalledOnce());
  click("Next baseline page");
  click("Next baseline page");
  const value = document("short.pdf", 1);
  await act(async () => finish({ source: value.source, pages: value.pages }));
  expect(screen.getByText(/The revision has no page 3/)).toBeTruthy();
  click("First revision page");
  const left = screen.getByLabelText("Baseline viewport"),
    right = screen.getByLabelText("Revision viewport");
  left.scrollLeft = 220;
  left.scrollTop = 300;
  fireEvent.scroll(left);
  expect(right.scrollLeft).toBe(220);
  expect(right.scrollTop).toBe(300);
  fireEvent.keyDown(right, { key: "ArrowRight", shiftKey: true });
  expect(right.scrollLeft).toBe(380);
  fireEvent.scroll(right);
  expect(left.scrollLeft).toBe(380);
  change("View", "overlay");
  expect(screen.queryByLabelText("Revision viewport")).toBeNull();
  expect(screen.getByLabelText("Overlay viewport")).toBeTruthy();
});
