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
vi.mock('../src/services/projectService', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/services/projectService')>();
  return { ...actual, loadSource: async (path: string, signal: AbortSignal) => {
    const pdf = await loadDocument(path, signal);
    return { pages: await Promise.all(Array.from({length: pdf.numPages}, (_, i) => pdf.getPage(i + 1))),
      source: { reference: path, filename: path, sha256: 'a'.repeat(64), size: 123, pages: pdf.numPages } };
  } };
});
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function page(number = 1) {
  return { pageNumber: number, getViewport: () => ({ width: 600, height: 800, convertToViewportPoint: (x: number, y: number) => [x, 800-y], convertToPdfPoint: (x: number, y: number) => [x, 800-y] }),
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Open PDF" }).hasAttribute("disabled")).toBe(false));
    expect(loadDocument).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open PDF" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "picker unavailable Please retry or choose another file.");
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

it('resets legends, active selection and vectors on document replacement while picker cancellation retains them', async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.mocked(loadDocument).mockResolvedValue(documentWith(page()));
  vi.mocked(open).mockResolvedValueOnce('first.pdf').mockResolvedValueOnce(null).mockResolvedValueOnce('second.pdf');
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
  await screen.findByLabelText('PDF page 1');
  fireEvent.click(screen.getByRole('button', { name: 'Legends (0)' }));
  fireEvent.change(screen.getByLabelText('Legend name'), { target: { value: 'Walls' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create legend' }));
  expect(screen.getByLabelText('Active legend').textContent).toBe('Active: Walls');
  const svg = screen.getByLabelText('Highlights for page 1');
  Object.assign(svg, { setPointerCapture() {}, hasPointerCapture: () => false,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 800, width: 600, height: 800 }) });
  for (const [type, x] of [['pointerdown', 40], ['pointerup', 80]] as const) {
    fireEvent(svg, Object.assign(new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: 50 }), { pointerId: 4 }));
  }
  const vector = svg.querySelector('polyline')!.outerHTML;
  expect(vector).toContain('40,50 80,50');
  fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open PDF' }).hasAttribute('disabled')).toBe(false));
  expect(screen.getByLabelText('Active legend').textContent).toBe('Active: Walls');
  expect(svg.querySelector('polyline')!.outerHTML).toBe(vector);
  fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
  await waitFor(() => expect(loadDocument).toHaveBeenCalledTimes(2));
  await screen.findByLabelText('PDF page 1');
  expect(screen.getByLabelText('Active legend').textContent).toBe('Unassigned · Manual color');
  expect(screen.getByRole('button', { name: 'Legends (0)' })).toBeTruthy();
  expect(screen.getByLabelText('Highlights for page 1').querySelector('polyline')).toBeNull();
});
it('synchronous raster failure remains an inline error and releases the canvas', () => {
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  const broken=page();vi.mocked(broken.render).mockImplementation(()=>{throw new Error('Raster allocation failed');});
  const view=render(<PdfPage page={broken}/>);expect(screen.getByRole('alert').textContent).toContain('Raster allocation failed');
  const canvas=screen.getByLabelText('PDF page 1') as HTMLCanvasElement;view.unmount();expect(canvas.width).toBe(0);
});
