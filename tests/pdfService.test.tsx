import { afterEach, expect, it, vi } from "vitest";
import { loadDocument } from "../src/services/pdfService";
import { getDocument } from "pdfjs-dist";
import { readFile } from "@tauri-apps/plugin-fs";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: vi.fn() }));
afterEach(() => vi.clearAllMocks());

it("loads all rendering assets locally and cancels loading with the owning session", async () => {
  const controller = new AbortController();
  const destroy = vi.fn().mockResolvedValue(undefined);
  vi.mocked(getDocument).mockReturnValue({
    promise: Promise.resolve({ numPages: 1 }),
    destroy,
  } as unknown as ReturnType<typeof getDocument>);
  await loadDocument("C:/plan.pdf", controller.signal, new Uint8Array([1, 2]));
  expect(readFile).not.toHaveBeenCalled();
  const options = vi.mocked(getDocument).mock.calls[0][0] as {
    cMapUrl: string;
    standardFontDataUrl: string;
    wasmUrl: string;
  };
  for (const url of [
    options.cMapUrl,
    options.standardFontDataUrl,
    options.wasmUrl,
  ])
    expect(new URL(url).origin).toBe(window.location.origin);
  controller.abort();
  expect(destroy).toHaveBeenCalledOnce();
});
