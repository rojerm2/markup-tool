import { keyMatrix } from './pageLegend';
import type { Point } from './coordinates';

export const BOX_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
export type BoxHandle = typeof BOX_HANDLES[number];
export function boxHandles(width: number, height: number) {
  return BOX_HANDLES.map(handle => ({ handle, x: handle.includes('w') ? 0 : handle.includes('e') ? width : width / 2,
    y: handle.includes('n') ? 0 : handle.includes('s') ? height : height / 2 }));
}
// Resize in local PDF axes so rotated pages keep the opposite edge stationary.
export function resizeBox<T extends { x: number; y: number; rotation: 0|90|180|270; width: number; height: number }>(
  box: T, handle: BoxHandle, delta: Point, minWidth: number, minHeight: (width: number) => number,
) {
  const [a,b,c,d] = keyMatrix(box), dx = a*delta.x+b*delta.y, dy = c*delta.x+d*delta.y;
  const width = Math.max(minWidth, Math.min(2000, box.width + (handle.includes('e') ? dx : handle.includes('w') ? -dx : 0)));
  const height = Math.max(minHeight(width), Math.min(10000, box.height + (handle.includes('s') ? dy : handle.includes('n') ? -dy : 0)));
  const left = handle.includes('w') ? box.width-width : 0, top = handle.includes('n') ? box.height-height : 0;
  return { ...box, width, height, x: box.x+a*left+c*top, y: box.y+b*left+d*top };
}
