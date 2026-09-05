import type { Point } from '../services/coordinates';

// All geometry, including width, is in raw PDF user space.
export type Highlight = {
  id: string;
  legendId: string | null;
  page: number;
  type: 'freehand';
  points: Point[];
  color: string;
  width: number;
  opacity: number;
};
