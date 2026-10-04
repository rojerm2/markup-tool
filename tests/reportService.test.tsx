import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import {
  exportReport,
  generateReportInWorker,
} from "../src/services/reportService";
import { emptySession } from "../src/services/annotationSession";
import { defaultExportSelection } from "../src/services/exportSelection";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
const source = {
  filename: "图纸.pdf",
  reference: "C:/图纸.pdf",
  size: 10,
  pages: 2,
  sha256: "a".repeat(64),
};
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});
it("report cancellation at the dialog or invalid selection never creates a worker or file", async () => {
  const Worker = vi.fn();
  vi.stubGlobal("Worker", Worker);
  vi.mocked(save).mockResolvedValue(null);
  expect(
    await exportReport(
      source.reference,
      null,
      source,
      emptySession,
      defaultExportSelection(2),
      "csv",
      new AbortController().signal,
    ),
  ).toBeNull();
  expect(Worker).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  await expect(
    exportReport(
      source.reference,
      null,
      source,
      emptySession,
      { ...defaultExportSelection(2), pages: [3] },
      "pdf",
      new AbortController().signal,
    ),
  ).rejects.toThrow("Invalid export selection");
  expect(save).toHaveBeenCalledOnce();
});
it("terminates cancelled report workers and ignores late completion", async () => {
  let worker!: {
    onmessage: ((event: unknown) => void) | null;
    terminate: ReturnType<typeof vi.fn>;
  };
  vi.stubGlobal(
    "Worker",
    class {
      onmessage = null;
      onerror = null;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        // eslint-disable-next-line @typescript-eslint/no-this-alias -- Capture worker cancellation cleanup.
        worker = this;
      }
    },
  );
  const controller = new AbortController();
  const output = generateReportInWorker(
    source,
    emptySession,
    defaultExportSelection(2),
    "pdf",
    controller.signal,
  );
  controller.abort();
  await expect(output).rejects.toThrow("Report cancelled");
  worker.onmessage?.({ data: { bytes: new Uint8Array([1]) } });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});
it.each(["csv", "pdf"] as const)(
  "saves %s as binary data with protected identity and acknowledges completion despite a late abort",
  async (format) => {
    const post = vi.fn(),
      controller = new AbortController(),
      bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      "Worker",
      class {
        onmessage: ((e: unknown) => void) | null = null;
        onerror = null;
        terminate = vi.fn();
        postMessage(data: unknown) {
          post(data);
          queueMicrotask(() => this.onmessage?.({ data: { bytes } }));
        }
      },
    );
    const path = `C:/report.${format}`;
    vi.mocked(save).mockResolvedValue(path);
    vi.mocked(invoke).mockImplementation(async () => {
      controller.abort();
    });
    expect(
      await exportReport(
        source.reference,
        "C:/editable.pmarkup",
        source,
        emptySession,
        defaultExportSelection(2),
        format,
        controller.signal,
      ),
    ).toBe(path);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: source.filename,
        format,
        pageCount: 2,
      }),
    );
    expect(post.mock.calls[0][0]).not.toHaveProperty("sourcePath");
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      format === "csv" ? "write_report_csv" : "write_export",
      bytes,
      { headers: { "x-export-metadata": expect.any(String) } },
    );
    const metadata = (
      vi.mocked(invoke).mock.calls[0][2] as { headers: Record<string, string> }
    ).headers["x-export-metadata"];
    expect(metadata).not.toMatch(/[^\x20-\x7e]/);
    expect(JSON.parse(metadata)).toEqual({
      path,
      projectPath: "C:/editable.pmarkup",
      sourcePath: source.reference,
      size: 10,
      sha256: source.sha256,
    });
  },
);
