import { PDFDocument, PDFNumber } from 'pdf-lib';
import type { AnnotationSession } from './annotationSession';
import { highlightGroups } from './annotationEditing';

// PDF numbers cannot use exponent notation. Keep the actual stored precision.
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Invalid annotation coordinate');
  return PDFNumber.of(value).toString();
}

/** Original pages remain vectors. Coordinates are already raw PDF user space:
 * the page itself applies CropBox, Rotate and UserUnit exactly once. */
export async function generateAnnotatedPdf(source: Uint8Array, session: AnnotationSession): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  const context = pdf.context;
  const byPage = new Map<number, AnnotationSession['annotations']>();
  for (const stroke of session.annotations) {
    const strokes = byPage.get(stroke.page) ?? [];
    strokes.push(stroke); byPage.set(stroke.page, strokes);
  }
  for (const [index, page] of pdf.getPages().entries()) {
    const strokes = byPage.get(index + 1);
    if (!strokes?.length) continue;
    const crop = page.getCropBox(), media = page.getMediaBox();
    let bounds = [Math.max(crop.x, media.x), Math.max(crop.y, media.y),
      Math.min(crop.x + crop.width, media.x + media.width), Math.min(crop.y + crop.height, media.y + media.height)];
    // PDF.js falls back to MediaBox for an empty intersection.
    if (bounds[2] <= bounds[0] || bounds[3] <= bounds[1]) bounds = [media.x, media.y, media.x + media.width, media.y + media.height];
    // normalize isolates existing content's CTM/graphics state with q/Q and
    // materializes inherited resources before appending our content.
    page.node.normalize();
    const commands: string[] = [];
    for (const group of highlightGroups(strokes).values()) {
      const { color, opacity } = group[0];
      const rgb = [1, 3, 5].map(i => pdfNumber(parseInt(color.slice(i, i + 2), 16) / 255)).join(' ');
      const paths = [`${rgb} RG`, '1 J 1 j'];
      for (const stroke of group) {
        paths.push(`${pdfNumber(stroke.width)} w`);
        stroke.points.forEach((p, i) => paths.push(`${pdfNumber(p.x)} ${pdfNumber(p.y)} ${i ? 'l' : 'm'}`));
        paths.push('S');
      }
      // Opaque children in an isolated, non-knockout group cover each point once.
      // Apply alpha to the completed form, never independently to its strokes.
      const form = context.register(context.flateStream(paths.join('\n'), {
        Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: bounds,
        Resources: {}, Group: { S: 'Transparency', I: true, K: false, CS: 'DeviceRGB' },
      }));
      const name = page.node.newXObject('Markup', form);
      const state = page.node.newExtGState('MarkupAlpha', context.obj({ Type: 'ExtGState', CA: opacity, ca: opacity, BM: 'Normal', SMask: 'None' }));
      commands.push(`q ${state} gs ${name} Do Q`);
    }
    page.node.addContentStream(context.register(context.flateStream(commands.join('\n'))));
  }
  // Transparency requires PDF 1.4; pdf-lib writes a 1.7 header.
  return pdf.save();
}
