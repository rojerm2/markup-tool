import { shapePath } from './shapes';
import { highlightOutline } from './highlightGeometry';
import fontkit from '@pdf-lib/fontkit';
import fontUrl from '../assets/LegendSans.ttf?url';
import { keyMatrix, layoutLegend, legendTextError, textWidth } from './pageLegend';
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
export async function generateAnnotatedPdf(source: Uint8Array, session: AnnotationSession, fontBytes?: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { updateMetadata: false });
  const context = pdf.context;
  const keys = session.pageLegends ?? [];
  for(const k of keys) { const error=legendTextError(k,session.legends); if(error) throw new Error(error); }
  pdf.registerFontkit(fontkit);
  const font = keys.length ? await pdf.embedFont(fontBytes ?? new Uint8Array(await (await fetch(fontUrl)).arrayBuffer()), {subset:true}) : null;
  const byPage = new Map<number, AnnotationSession['annotations']>();
  for (const stroke of session.annotations) {
    const strokes = byPage.get(stroke.page) ?? [];
    strokes.push(stroke); byPage.set(stroke.page, strokes);
  }
  for (const [index, page] of pdf.getPages().entries()) {
    const strokes = byPage.get(index + 1) ?? [];
    const pageKeys=keys.filter(k=>k.page===index+1);
    const shapes=(session.shapes??[]).filter(s=>s.page===index+1);
    if (!strokes.length && !pageKeys.length && !shapes.length) continue;
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
      const paths = [`${rgb} RG`, `${rgb} rg`, '1 J 1 j'];
      for (const stroke of group) {
        if ((stroke.rounding ?? 100) < 100) {
          for (const c of highlightOutline(stroke)) paths.push(c.op === 'Z' ? 'h' : `${c.points.flatMap(p => [pdfNumber(p.x), pdfNumber(p.y)]).join(' ')} ${c.op.toLowerCase()}`);
          paths.push('f');
          continue;
        }
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
    for(const s of shapes) {
      const state=page.node.newExtGState('ShapeAlpha',context.obj({Type:'ExtGState',CA:1,ca:.2,BM:'Normal',SMask:'None'}));
      const rgb=(color:string)=>[1,3,5].map(i=>pdfNumber(parseInt(color.slice(i,i+2),16)/255)).join(' ');
      commands.push(`q ${state} gs ${bounds.map(pdfNumber).slice(0,2).join(' ')} ${pdfNumber(bounds[2]-bounds[0])} ${pdfNumber(bounds[3]-bounds[1])} re W n`, `${rgb(s.color)} RG`, `${pdfNumber(s.width)} w 1 J 0 j 2 M`);
      if(s.fill)commands.push(`${rgb(s.fill)} rg`);
      for(const c of shapePath(s))commands.push(c.op==='Z'?'h':`${c.points.flatMap(p=>[pdfNumber(p.x),pdfNumber(p.y)]).join(' ')} ${c.op.toLowerCase()}`);
      commands.push(s.fill?'B':'S','Q');
    }
    if(font) {
      const fontName=page.node.newFontDictionary('LegendFont',font.ref);
      const opaque=page.node.newExtGState('LegendOpaque',context.obj({Type:'ExtGState',CA:1,ca:1,BM:'Normal',SMask:'None'}));
      for(const k of pageKeys) {
        const layout=layoutLegend(k,session.legends);
        commands.push(`q ${opaque} gs ${bounds[0]} ${bounds[1]} ${bounds[2]-bounds[0]} ${bounds[3]-bounds[1]} re W n`,`${keyMatrix(k).map(pdfNumber).join(' ')} cm`);
        if(k.background) commands.push(`1 1 1 rg 0 0 ${pdfNumber(k.width)} ${pdfNumber(layout.height)} re f`);
        if(k.border) commands.push(`0.6 0.6 0.6 RG 0.5 w 0 0 ${pdfNumber(k.width)} ${pdfNumber(layout.height)} re S`);
        for(const c of layout.chips) {
          const rgb=[1,3,5].map(i=>pdfNumber(parseInt(c.color.slice(i,i+2),16)/255)).join(' ');
          commands.push(`${rgb} rg ${pdfNumber(c.x)} ${pdfNumber(c.y)} ${layout.chip} ${layout.chip} re f`);
        }
        commands.push('0.12 0.14 0.16 rg');
        for(const t of layout.texts) {
          let x=t.x;
          // Explicit advances disable shaping/kerning consistently with the SVG.
          for(const c of t.text) {
            commands.push(`BT ${fontName} ${k.fontSize} Tf 1 0 0 -1 ${pdfNumber(x)} ${pdfNumber(t.y)} Tm ${font.encodeText(c)} Tj ET`);
            x+=textWidth(c,k.fontSize);
          }
        }
        commands.push('Q');
      }
    }
    page.node.addContentStream(context.register(context.flateStream(commands.join('\n'))));
  }
  // Transparency requires PDF 1.4; pdf-lib writes a 1.7 header.
  return pdf.save();
}
