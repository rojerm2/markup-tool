const KEY = "pdf-markup.larger-controls";

export function readLargerControls(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function writeLargerControls(value: boolean): void {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {
    /* The current window preference remains usable without storage. */
  }
}

export type Theme = "light" | "dark";

export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem("pdf-markup.theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    /* Follow the system preference if storage is unavailable. */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function writeTheme(value: Theme): void {
  try {
    localStorage.setItem("pdf-markup.theme", value);
  } catch {
    /* Keep the current theme. */
  }
}

export function readSoundsEnabled(): boolean {
  try {
    return localStorage.getItem("pdf-markup.action-sounds") === "true";
  } catch {
    return false;
  }
}

export function writeSoundsEnabled(value: boolean): void {
  try {
    localStorage.setItem("pdf-markup.action-sounds", String(value));
  } catch {
    /* Keep the current preference. */
  }
}

export function readSoundVolume(): number {
  try {
    const saved = localStorage.getItem("pdf-markup.sound-volume");
    const value = saved === null || saved.trim() === "" ? NaN : Number(saved);
    if (Number.isFinite(value))
      return Math.round(Math.min(100, Math.max(0, value)));
  } catch {
    /* Keep the default volume. */
  }
  return 60;
}

export function writeSoundVolume(value: number): void {
  try {
    localStorage.setItem("pdf-markup.sound-volume", String(value));
  } catch {
    /* Keep the current volume. */
  }
}
