// Opt-in local benchmark. The supplied private document is never committed.
import { it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { PDFDocument, PDFRawStream, ParseSpeeds } from "pdf-lib";
import { emptySession } from "../src/services/annotationSession";
import { generateAnnotatedPdf } from "../src/services/pdfExport";

it.skipIf(!process.env.PDF_MARKUP_REAL_PDF)(
  "benchmarks the actual floor plan and verifies every original stream is preserved",
  async () => {
    const path = process.env.PDF_MARKUP_REAL_PDF!;
    const source = new Uint8Array(readFileSync(path));
    const hash = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    const sourceHash = hash(source),
      start = performance.now();
    const original = await PDFDocument.load(source, {
      parseSpeed: ParseSpeeds.Fastest,
      updateMetadata: false,
    });
    const parsed = performance.now();
    const page = original.getPage(0),
      box = page.getMediaBox();
    const session = {
      ...emptySession,
      annotations: [
        {
          id: "actual-plan-highlight",
          page: 1,
          type: "freehand" as const,
          legendId: null,
          color: "#facc15",
          opacity: 0.4,
          width: 40,
          points: [
            { x: box.x + box.width * 0.3, y: box.y + box.height * 0.5 },
            { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 },
          ],
        },
      ],
    };
    const stages: { stage: string; elapsedMs: number }[] = [];
    const begun = performance.now();
    const output = await generateAnnotatedPdf(
      source,
      session,
      undefined,
      (stage) =>
        stages.push({
          stage,
          elapsedMs: Math.round(performance.now() - begun),
        }),
    );
    const generated = performance.now();
    const reopened = await PDFDocument.load(output, {
      parseSpeed: ParseSpeeds.Fastest,
      updateMetadata: false,
    });
    expect(reopened.getPageCount()).toBe(original.getPageCount());
    for (let i = 0; i < original.getPageCount(); i++) {
      expect(reopened.getPage(i).getMediaBox()).toEqual(
        original.getPage(i).getMediaBox(),
      );
      expect(reopened.getPage(i).getCropBox()).toEqual(
        original.getPage(i).getCropBox(),
      );
      expect(reopened.getPage(i).getRotation()).toEqual(
        original.getPage(i).getRotation(),
      );
    }
    let streams = 0;
    for (const [ref, obj] of original.context.enumerateIndirectObjects())
      if (obj instanceof PDFRawStream) {
        const after = reopened.context.lookup(ref);
        expect(after).toBeInstanceOf(PDFRawStream);
        expect(hash((after as PDFRawStream).contents)).toBe(hash(obj.contents));
        streams++;
      }
    expect(reopened.getPage(0).node.Resources()?.toString()).toContain(
      "Markup",
    );
    expect(hash(new Uint8Array(readFileSync(path)))).toBe(sourceHash);
    mkdirSync("internal_docs/performance-qa", { recursive: true });
    writeFileSync(
      "internal_docs/performance-qa/actual-floor-plan_Marked.pdf",
      output,
    );
    const report = {
      sourceBytes: source.length,
      outputBytes: output.length,
      pages: original.getPageCount(),
      preservedStreams: streams,
      parseMs: Math.round(parsed - start),
      exportMs: Math.round(generated - begun),
      stages,
    };
    writeFileSync(
      "internal_docs/performance-qa/actual-floor-plan-benchmark.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  },
  300000,
);
