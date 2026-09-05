import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import App from "../src/App";
import PdfViewer from "../src/components/PdfViewer/PdfViewer";
import PdfPage from "../src/components/PdfViewer/PdfPage";
import { open } from "@tauri-apps/plugin-dialog";
import { loadDocument } from "../src/services/pdfService";
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../src/services/pdfService", () => ({ loadDocument: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function page(number = 1) {
  return { pageNumber: number, getViewport: () => ({ width: 600, height: 800 }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })) } as unknown as PDFPageProxy;
}
function documentWith(...pages: PDFPageProxy[]) {
  return { numPages: pages.length, getPage: async (number: number) => pages[number - 1] } as unknown as PDFDocumentProxy;
}

describe("PDF opening", () => {
  it("keeps the empty session when the picker is cancelled and reports picker failures", async () => {
    vi.mocked(open).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("picker unavailable"));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await waitFor(() => expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false));
    expect(loadDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not open file picker: picker unavailable");
  });
  it("allows the same path to be retried after a load failure", async () => {
    vi.mocked(open).mockResolvedValue("C:\\Plans\\floor.pdf");
    vi.mocked(loadDocument).mockRejectedValue(new Error("Invalid PDF"));
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));
  });
  it("aborts replaced loads and ignores their late results", async () => {
    let resolveOld!: (pdf: PDFDocumentProxy) => void;
    vi.mocked(loadDocument).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
      .mockRejectedValueOnce(new Error("Second document failed"));
    const view = render(<PdfViewer file="old.pdf" />);
    const signal = vi.mocked(loadDocument).mock.calls[0][1];
    view.rerender(<PdfViewer file="new.pdf" />);
    expect(signal.aborted).toBe(true);
    await screen.findByRole("alert");
    resolveOld(documentWith(page()));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Second document failed"));
    expect(screen.queryByLabelText("Page 1")).toBeNull();
  });
  it("renders every page and cancels rendering on unmount", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const first = page(1), second = page(2);
    vi.mocked(loadDocument).mockResolvedValue(documentWith(first, second));
    const view = render(<PdfViewer file="floor.pdf" />);
    await screen.findByLabelText("PDF page 2");
    expect(screen.getByLabelText("PDF page 1")).toBeTruthy();
    view.unmount();
    for (const item of [first, second]) {
      expect(vi.mocked(item.render).mock.results[0].value.cancel).toHaveBeenCalledOnce();
    }
  });
  it("uses separate canvases during StrictMode replay and reports render failures", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const broken = page();
    vi.mocked(broken.render).mockImplementation(() => ({ promise: Promise.reject(new Error("Render failed")), cancel: vi.fn() }) as unknown as ReturnType<PDFPageProxy["render"]>);
    render(<StrictMode><PdfPage page={broken} /></StrictMode>);
    await screen.findByRole("alert");
    const calls = vi.mocked(broken.render).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0].canvas).not.toBe(calls[1][0].canvas);
  });
});
