const KEY = 'pdf-markup.larger-controls';

export function readLargerControls(): boolean {
  try { return localStorage.getItem(KEY) === 'true'; }
  catch { return false; }
}

export function writeLargerControls(value: boolean): void {
  try { localStorage.setItem(KEY, String(value)); }
  catch { /* The current window preference remains usable without storage. */ }
}
