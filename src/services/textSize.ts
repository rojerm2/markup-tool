export const MIN_TEXT_SIZE = 1;
export const MAX_TEXT_SIZE = 200;
export const validTextSize = (size: number) =>
  Number.isFinite(size) && size >= MIN_TEXT_SIZE && size <= MAX_TEXT_SIZE;
