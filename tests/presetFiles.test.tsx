import { beforeEach, expect, it, vi } from "vitest";
import {
  capturePreset,
  serializePreset,
  MAX_PRESET_BYTES,
} from "../src/services/presets";
import { emptySession } from "../src/services/annotationSession";
import {
  importPresetFile,
  exportPresetFile,
} from "../src/services/presetFiles";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: native.open,
  save: native.save,
}));
beforeEach(() => vi.resetAllMocks());

it("cancels import/export without native reads or writes", async () => {
  native.open.mockResolvedValue(null);
  native.save.mockResolvedValue(null);
  expect(await importPresetFile()).toBeNull();
  expect(
    await exportPresetFile(capturePreset("Default", emptySession)),
  ).toBeNull();
  expect(native.invoke).not.toHaveBeenCalled();
});

it("imports only a dialog-selected file and rejects corrupt or oversized contents before they enter a library", async () => {
  native.open.mockResolvedValue("C:/selected.pmpreset");
  const preset = capturePreset("Default", emptySession);
  native.invoke.mockResolvedValue(serializePreset(preset));
  expect(await importPresetFile()).toEqual(preset);
  expect(native.invoke).toHaveBeenCalledWith("read_preset", {
    path: "C:/selected.pmpreset",
  });
  expect(native.open).toHaveBeenCalledWith(
    expect.objectContaining({
      multiple: false,
      filters: [
        { name: "Markup preset (*.pmpreset)", extensions: ["pmpreset"] },
      ],
    }),
  );
  for (const contents of [
    "{",
    "x".repeat(MAX_PRESET_BYTES + 1),
    JSON.stringify({ ...preset, version: 99 }),
  ]) {
    native.invoke.mockResolvedValue(contents);
    await expect(importPresetFile()).rejects.toThrow();
  }
});

it("exports a validated snapshot with a generic filename and reports write failure without claiming success", async () => {
  const preset = capturePreset("Floor plan", emptySession);
  native.save.mockResolvedValue("C:/chosen.pmpreset");
  native.invoke.mockResolvedValue(undefined);
  expect(await exportPresetFile(preset)).toBe("C:/chosen.pmpreset");
  expect(native.save).toHaveBeenCalledWith(
    expect.objectContaining({ defaultPath: "markup-styles.pmpreset" }),
  );
  expect(native.invoke).toHaveBeenCalledWith("write_preset", {
    path: "C:/chosen.pmpreset",
    text: serializePreset(preset),
  });
  native.invoke.mockRejectedValue(Error("Destination is not a preset"));
  await expect(exportPresetFile(preset)).rejects.toThrow(/not a preset/);
  native.save.mockClear();
  native.invoke.mockClear();
  await expect(exportPresetFile({ ...preset, name: " " })).rejects.toThrow();
  expect(native.save).not.toHaveBeenCalled();
  expect(native.invoke).not.toHaveBeenCalled();
});
