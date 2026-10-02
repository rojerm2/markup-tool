// Opt-in benchmark: PDF_MARKUP_BENCHMARK=1 npm test -- tests/largeExport.test.tsx
// The generated 32-page fixture has 96 MiB of raw image streams and 50k objects.
import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PDFDocument, PDFName, ParseSpeeds } from 'pdf-lib';
import { generateAnnotatedPdf } from '../src/services/pdfExport';
import { emptySession } from '../src/services/annotationSession';

it.skipIf(process.env.PDF_MARKUP_BENCHMARK !== '1')('benchmarks a roughly 100 MB, 32-page export and checks content preservation', async () => {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 32; i++) {
    const page = pdf.addPage([1200, 900]);
    const pixels = new Uint8Array(1024 * 1024 * 3).fill(240 - i);
    const image = pdf.context.register(pdf.context.stream(pixels, {
      Type: 'XObject', Subtype: 'Image', Width: 1024, Height: 1024,
      ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    }));
    const name = page.node.newXObject('FloorPlanImage', image);
    page.node.addContentStream(pdf.context.register(pdf.context.flateStream(`q 1200 0 0 900 0 0 cm ${name} Do Q`)));
  }
  // Large engineering PDFs often contain many small indirect objects, too.
  for (let i = 0; i < 50000; i++) pdf.context.register(pdf.context.obj({ BenchmarkObject: i, Coordinate: i / 3 }));
  const source = await pdf.save({ objectsPerTick: Infinity });
  const baselineStart = performance.now();
  const baselinePdf = await PDFDocument.load(source, { updateMetadata: false });
  const baselineLoaded = performance.now();
  const baseline = await baselinePdf.save();
  const baselineEnd = performance.now();
  const session = { ...emptySession, annotations: [{
    id: 'benchmark-highlight', page: 1, type: 'freehand' as const, legendId: null,
    points: [{ x: 50, y: 50 }, { x: 300, y: 50 }], color: '#facc15', opacity: 0.4, width: 10,
  }] };
  const stages: { stage: string; elapsedMs: number }[] = [];
  const optimizedStart = performance.now();
  const output = await generateAnnotatedPdf(source, session, undefined,
    stage => stages.push({ stage, elapsedMs: Math.round(performance.now() - optimizedStart) }));
  const optimizedMs = performance.now() - optimizedStart;
  const reopened = await PDFDocument.load(output, { parseSpeed: ParseSpeeds.Fastest });
  expect(reopened.getPageCount()).toBe(32);
  expect(reopened.getPage(0).getMediaBox()).toEqual({ x: 0, y: 0, width: 1200, height: 900 });
  // Original image streams survive byte-for-byte, including on untouched pages.
  for (const document of [baselinePdf, reopened]) {
    for (let i = 0; i < 32; i++) {
      const resources = document.getPage(i).node.Resources()!;
      const images = resources.lookup(PDFName.of('XObject')) as import('pdf-lib').PDFDict;
      const image = document.context.lookup(images.get(images.keys().find(key => key.toString().startsWith('/FloorPlanImage'))!)) as import('pdf-lib').PDFRawStream;
      expect(image.contents.length).toBe(1024 * 1024 * 3);
      expect(image.contents[0]).toBe(240 - i);
      expect(image.contents[image.contents.length - 1]).toBe(240 - i);
    }
  }
  expect(reopened.getPage(0).node.Resources()!.toString()).toContain('Markup');
  expect(reopened.getPage(31).node.Resources()!.toString()).not.toContain('Markup');
  mkdirSync('internal_docs/performance-qa', { recursive: true });
  writeFileSync('internal_docs/performance-qa/large-32-pages.pdf', source);
  writeFileSync('internal_docs/performance-qa/large-32-pages_Marked.pdf', output);
  const report = { fixture: 'Synthetic, 32 pages, raw image streams plus 50,000 indirect objects; not a real CAD drawing',
    sourceBytes: source.length, outputBytes: output.length, baselineBytes: baseline.length,
    baselineParseMs: Math.round(baselineLoaded - baselineStart), baselineSaveMs: Math.round(baselineEnd - baselineLoaded),
    baselineTotalMs: Math.round(baselineEnd - baselineStart), optimizedTotalMs: Math.round(optimizedMs), stages };
  writeFileSync('internal_docs/performance-qa/benchmark.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}, 180000);
