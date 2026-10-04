import { MAX_ZOOM, MIN_ZOOM, type Point, type ZoomMode } from "./coordinates";

export type Bookmark = { page: number; label: string };
export type DocumentNavigation = {
  bookmarks: Bookmark[];
  view: { page: number; mode: ZoomMode; zoom: number; center?: Point };
};
export const defaultNavigation = (): DocumentNavigation => ({
  bookmarks: [],
  view: { page: 1, mode: "page", zoom: 1 },
});

export function parseNavigation(
  value: unknown,
  pages: number,
): DocumentNavigation {
  const fail = (): never => {
    throw new Error("Invalid project: document navigation.");
  };
  if (!value || typeof value !== "object") return fail();
  const n = value as DocumentNavigation;
  if (
    !Array.isArray(n.bookmarks) ||
    n.bookmarks.length > Math.min(1000, pages) ||
    !n.view ||
    !Number.isInteger(n.view.page) ||
    n.view.page < 1 ||
    n.view.page > pages ||
    !["page", "width", "manual"].includes(n.view.mode) ||
    !Number.isFinite(n.view.zoom) ||
    n.view.zoom < MIN_ZOOM ||
    n.view.zoom > MAX_ZOOM
  )
    return fail();
  const seen = new Set<number>();
  const bookmarks = n.bookmarks.map((b) => {
    if (
      !b ||
      !Number.isInteger(b.page) ||
      b.page < 1 ||
      b.page > pages ||
      seen.has(b.page) ||
      typeof b.label !== "string" ||
      !b.label.trim() ||
      b.label !== b.label.trim() ||
      b.label.length > 256 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters in labels.
      /[\u0000-\u001f]/.test(b.label)
    )
      return fail();
    seen.add(b.page);
    return { page: b.page, label: b.label };
  });
  const center = n.view.center;
  if (
    center !== undefined &&
    (!center ||
      typeof center !== "object" ||
      ![center.x, center.y].every(
        (v) => Number.isFinite(v) && Math.abs(v) <= 1e9,
      ))
  )
    return fail();
  return {
    bookmarks,
    view: {
      page: n.view.page,
      mode: n.view.mode,
      zoom: n.view.zoom,
      ...(center ? { center: { x: center.x, y: center.y } } : {}),
    },
  };
}

const KEY = "pdf-markup.navigation";
type SavedView = { key: string; navigation: DocumentNavigation };

export function navigationKey(hash: string, projectPath: string | null) {
  const path = (projectPath ?? "pdf").replace(/\\/g, "/");
  return `${hash}:${/^[a-z]:\//i.test(path) || path.startsWith("//") ? path.toLowerCase() : path}`;
}

export function readNavigation(
  key: string,
  pages: number,
): DocumentNavigation | null {
  try {
    const text = localStorage.getItem(KEY);
    if (!text || text.length > 1024 * 1024) return null;
    const entries: unknown = JSON.parse(text);
    if (!Array.isArray(entries)) return null;
    const entry = entries.slice(0, 12).find((n) => n?.key === key);
    return entry ? parseNavigation(entry.navigation, pages) : null;
  } catch {
    return null;
  }
}

export function writeNavigation(
  key: string,
  navigation: DocumentNavigation,
  pages: number,
) {
  try {
    const valid = parseNavigation(navigation, pages);
    const text = localStorage.getItem(KEY);
    let raw: unknown = [];
    if (text && text.length <= 1024 * 1024) {
      try {
        raw = JSON.parse(text);
      } catch {
        /* Replace corrupt local state. */
      }
    }
    const previous = Array.isArray(raw) ? (raw as SavedView[]) : [];
    const entries = [
      { key, navigation: valid },
      ...previous.filter((n) => n?.key !== key).slice(0, 11),
    ];
    let serialized = JSON.stringify(entries);
    while (serialized.length > 1024 * 1024 && entries.length > 1) {
      entries.pop();
      serialized = JSON.stringify(entries);
    }
    if (serialized.length <= 1024 * 1024) localStorage.setItem(KEY, serialized);
  } catch {
    /* Portable saves still carry navigation when local storage is unavailable. */
  }
}
