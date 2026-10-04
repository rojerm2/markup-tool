import type { AnnotationSession } from "./annotationSession";

let indexedSession: AnnotationSession | undefined;
let categories = new Map<string, string | null>();
let owners = new Set<string>();
let flags = new Map<string, { hidden?: boolean; locked?: boolean }>();

// Keep one immutable snapshot indexed, avoiding an O(markups²) canvas render
// without retaining a map for every undo-history snapshot.
function index(session: AnnotationSession) {
  if (indexedSession === session) return;
  indexedSession = session;
  categories = new Map(session.annotations.map((s) => [s.id, s.legendId]));
  owners = new Set(
    [
      ...session.annotations,
      ...(session.shapes ?? []),
      ...(session.notes ?? []),
      ...(session.pageLegends ?? []),
    ].map((s) => s.id),
  );
  flags = new Map(session.legends.map((l) => [l.id, l]));
}

export function objectCategory(
  session: AnnotationSession,
  id: string,
): string | null {
  index(session);
  if (categories.has(id)) return categories.get(id)!;
  return session.objectCategories &&
    Object.prototype.hasOwnProperty.call(session.objectCategories, id)
    ? session.objectCategories[id]
    : null;
}

export function objectLocked(session: AnnotationSession, id: string): boolean {
  const category = objectCategory(session, id);
  return !!flags.get(category ?? "")?.locked;
}

export function objectVisible(session: AnnotationSession, id: string): boolean {
  const category = objectCategory(session, id);
  return !flags.get(category ?? "")?.hidden;
}

export function objectExists(session: AnnotationSession, id: string): boolean {
  index(session);
  return owners.has(id);
}
