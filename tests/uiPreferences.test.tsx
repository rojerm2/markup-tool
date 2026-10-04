import { afterEach, expect, it, vi } from "vitest";
import {
  readLargerControls,
  writeLargerControls,
  readTheme,
  writeTheme,
  readSoundsEnabled,
  writeSoundsEnabled,
  readSoundVolume,
  writeSoundVolume,
} from "../src/services/uiPreferences";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
it.each([null, "false", "TRUE", "{}", "1", "undefined"])(
  "defaults safely for stored %s",
  (value) => {
    if (value !== null)
      localStorage.setItem("pdf-markup.larger-controls", value);
    expect(readLargerControls()).toBe(false);
  },
);
it("persists both sizes", () => {
  writeLargerControls(true);
  expect(readLargerControls()).toBe(true);
  writeLargerControls(false);
  expect(readLargerControls()).toBe(false);
});
it("tolerates unavailable storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(readLargerControls()).toBe(false);
  expect(() => writeLargerControls(true)).not.toThrow();
});
it("follows system appearance initially, persists an explicit theme, and defaults sound off", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(readTheme()).toBe("dark");
  expect(readSoundsEnabled()).toBe(false);
  writeTheme("light");
  expect(readTheme()).toBe("light");
  writeTheme("dark");
  expect(readTheme()).toBe("dark");
  writeSoundsEnabled(true);
  expect(readSoundsEnabled()).toBe(true);
  writeSoundsEnabled(false);
  expect(readSoundsEnabled()).toBe(false);
});
it("persists volume, preserves mute, and validates unavailable or malformed storage", () => {
  expect(readSoundVolume()).toBe(60);
  for (const value of [0, 37, 100]) {
    writeSoundVolume(value);
    expect(readSoundVolume()).toBe(value);
  }
  localStorage.setItem("pdf-markup.sound-volume", "NaN");
  expect(readSoundVolume()).toBe(60);
  localStorage.setItem("pdf-markup.sound-volume", "");
  expect(readSoundVolume()).toBe(60);
  localStorage.setItem("pdf-markup.sound-volume", "140");
  expect(readSoundVolume()).toBe(100);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readSoundVolume()).toBe(60);
});
