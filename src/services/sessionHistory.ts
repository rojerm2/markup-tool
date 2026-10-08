import {
  sessionReducer,
  type AnnotationSession,
  type SessionAction,
} from "./annotationSession";
import type { Highlight } from "../types/annotation";
import { objectExists, objectLocked } from "./categoryPolicy";

export const HISTORY_LIMIT = 100;
type Transaction = {
  changes: StrokeChange[];
  label: string;
};
type StrokeChange = {
  before?: Highlight;
  after?: Highlight;
  beforeIndex: number;
  afterIndex: number;
};
type Direction = "undo" | "redo";

const sameGeometry = (a: Highlight, b: Highlight) =>
  a.page === b.page && a.type === b.type && sameSession(a.points, b.points);

function highlightChanges(
  before: Highlight[],
  after: Highlight[],
): StrokeChange[] {
  if (before === after) return [];
  const previous = new Map(
    before.map((stroke, index) => [stroke.id, { stroke, index }]),
  );
  const next = new Map(
    after.map((stroke, index) => [stroke.id, { stroke, index }]),
  );
  const changes: StrokeChange[] = [];
  for (const [id, old] of previous) {
    const value = next.get(id);
    if (!value || !sameGeometry(old.stroke, value.stroke))
      changes.push({
        before: old.stroke,
        after: value?.stroke,
        beforeIndex: old.index,
        afterIndex: value?.index ?? -1,
      });
  }
  for (const [id, value] of next)
    if (!previous.has(id))
      changes.push({
        after: value.stroke,
        beforeIndex: -1,
        afterIndex: value.index,
      });
  return changes;
}

function transactionLabel(changes: StrokeChange[]): string {
  const noun = changes.length === 1 ? "highlight" : "highlights";
  if (changes.every((change) => !change.before)) return `Draw ${noun}`;
  if (changes.every((change) => !change.after)) return `Delete ${noun}`;
  return `Move ${noun}`;
}

// Compare persisted values without serialization or cloning large geometry arrays.
export function sameSession(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const left = Object.keys(a),
    right = Object.keys(b);
  return (
    left.length === right.length &&
    left.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        sameSession(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    )
  );
}

/** One instance per Work. History retains highlight geometry, never project/settings snapshots. */
export class SessionHistory {
  present: AnnotationSession;
  private past: Transaction[] = [];
  private future: Transaction[] = [];
  generation = 0;
  private snapshotCancellations = new Set<() => void>();
  subscribeSnapshotCancellation = (cancel: () => void) => {
    this.snapshotCancellations.add(cancel);
    return () => {
      this.snapshotCancellations.delete(cancel);
    };
  };
  cancelSnapshotDrafts() {
    this.snapshotCancellations.forEach((cancel) => cancel());
  }
  private cancellations = new Set<() => void>();
  constructor(session: AnnotationSession) {
    this.present = session;
  }
  get undoLabel() {
    const entry = this.past[this.past.length - 1];
    return entry && this.canTraverse(entry, "undo") ? entry.label : undefined;
  }
  get redoLabel() {
    const entry = this.future[this.future.length - 1];
    return entry && this.canTraverse(entry, "redo") ? entry.label : undefined;
  }
  subscribeCancellation = (cancel: () => void) => {
    this.cancellations.add(cancel);
    return () => {
      this.cancellations.delete(cancel);
    };
  };
  invalidate() {
    ++this.generation;
    this.cancellations.forEach((cancel) => cancel());
  }
  apply(action: SessionAction, generation = this.generation): boolean {
    if (generation !== this.generation) return false;
    const after = sessionReducer(this.present, action);
    if (sameSession(this.present, after)) return false;
    const changes = highlightChanges(
      this.present.annotations,
      after.annotations,
    );
    if (changes.length) {
      this.past = [
        ...this.past.slice(-(HISTORY_LIMIT - 1)),
        { changes, label: transactionLabel(changes) },
      ];
      this.future = [];
    }
    this.present = after;
    return true;
  }
  private restoredStroke(stroke: Highlight): Highlight {
    return stroke.legendId !== null &&
      !this.present.legends.some((l) => l.id === stroke.legendId)
      ? { ...stroke, legendId: null }
      : stroke;
  }
  private canTraverse(transaction: Transaction, direction: Direction): boolean {
    const current = new Map(
      this.present.annotations.map((stroke) => [stroke.id, stroke]),
    );
    return transaction.changes.every((change) => {
      const expected = direction === "undo" ? change.after : change.before;
      const target = direction === "undo" ? change.before : change.after;
      const id = (expected ?? target)!.id,
        live = current.get(id);
      if (expected ? !live || !sameGeometry(live, expected) : !!live)
        return false;
      if (live && objectLocked(this.present, id)) return false;
      if (target && !live) {
        if (
          objectExists(this.present, id) ||
          this.present.legends.some((l) => l.id === id) ||
          this.present.notes?.some(
            (n) => n.type === "text" && n.pointers.some((p) => p.id === id),
          )
        )
          return false;
        if (
          this.present.legends.some((l) => l.id === target.legendId && l.locked)
        )
          return false;
      }
      return true;
    });
  }
  traverse(direction: Direction): boolean {
    // Synchronous, including empty attempts: reference restoration cannot revive gestures.
    this.invalidate();
    const source = direction === "undo" ? this.past : this.future;
    const transaction = source[source.length - 1];
    if (!transaction || !this.canTraverse(transaction, direction)) return false;
    const current = new Map(
      this.present.annotations.map((stroke) => [stroke.id, stroke]),
    );
    const replacements = new Map<string, Highlight | undefined>();
    const insertions: { stroke: Highlight; index: number }[] = [];
    for (const change of transaction.changes) {
      const target = direction === "undo" ? change.before : change.after;
      const expected = direction === "undo" ? change.after : change.before;
      const id = (target ?? expected)!.id,
        live = current.get(id);
      if (!target) {
        // Remember the latest appearance for redo/undo of creation/deletion.
        if (direction === "undo") change.after = live;
        else change.before = live;
        replacements.set(id, undefined);
      } else if (live) {
        const moved = {
          ...live,
          page: target.page,
          type: target.type,
          points: target.points,
        };
        replacements.set(id, sameSession(moved, target) ? target : moved);
      } else {
        insertions.push({
          stroke: this.restoredStroke(target),
          index: direction === "undo" ? change.beforeIndex : change.afterIndex,
        });
      }
    }
    const annotations = this.present.annotations.flatMap((stroke) =>
      replacements.has(stroke.id)
        ? replacements.get(stroke.id)
          ? [replacements.get(stroke.id)!]
          : []
        : [stroke],
    );
    for (const { stroke, index } of insertions.sort(
      (a, b) => a.index - b.index,
    ))
      annotations.splice(Math.min(index, annotations.length), 0, stroke);
    source.pop();
    this.present = { ...this.present, annotations };
    if (direction === "undo") {
      this.future.push(transaction);
    } else {
      this.past.push(transaction);
    }
    return true;
  }
}
