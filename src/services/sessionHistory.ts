import { sessionReducer, type AnnotationSession, type SessionAction } from './annotationSession';

export const HISTORY_LIMIT = 100;
type Transaction = { before: AnnotationSession; after: AnnotationSession; label: string };
const labels: Record<SessionAction['type'], string> = {
  'put-key': 'Place/edit page legend', 'remove-key': 'Delete page legend',
  commit: 'Draw stroke', 'move-stroke': 'Move stroke', 'remove-stroke': 'Delete stroke',
  'edit-stroke': 'Edit stroke', create: 'Create legend', rename: 'Rename legend',
  delete: 'Delete legend', select: 'Drawing legend', drawing: 'Drawing style',
};
// Compare persisted values without serialization or cloning large geometry arrays.
export function sameSession(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = Object.keys(a), right = Object.keys(b);
  return left.length === right.length && left.every(key => Object.prototype.hasOwnProperty.call(b, key)
    && sameSession((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** One instance per Work. Snapshots structurally share immutable vectors. */
export class SessionHistory {
  present: AnnotationSession;
  private past: Transaction[] = [];
  private future: Transaction[] = [];
  generation = 0;
  private cancellations = new Set<() => void>();
  constructor(session: AnnotationSession) { this.present = session; }
  get undoLabel() { return this.past[this.past.length - 1]?.label; }
  get redoLabel() { return this.future[this.future.length - 1]?.label; }
  subscribeCancellation = (cancel: () => void) => {
    this.cancellations.add(cancel);
    return () => { this.cancellations.delete(cancel); };
  };
  invalidate() {
    ++this.generation;
    this.cancellations.forEach(cancel => cancel());
  }
  apply(action: SessionAction, generation = this.generation): boolean {
    if (generation !== this.generation) return false;
    const after = sessionReducer(this.present, action);
    if (sameSession(this.present, after)) return false;
    this.past = [...this.past.slice(-(HISTORY_LIMIT - 1)), { before: this.present, after, label: labels[action.type] }];
    this.future = [];
    this.present = after;
    return true;
  }
  traverse(direction: 'undo' | 'redo'): boolean {
    // Synchronous, including empty attempts: reference restoration cannot revive gestures.
    this.invalidate();
    const source = direction === 'undo' ? this.past : this.future;
    const transaction = source.pop();
    if (!transaction) return false;
    if (direction === 'undo') { this.future.push(transaction); this.present = transaction.before; }
    else { this.past.push(transaction); this.present = transaction.after; }
    return true;
  }
}
