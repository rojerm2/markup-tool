import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import PresetLibrary from "../src/components/Presets/PresetLibrary";
import SymbolPreview from "../src/components/Presets/SymbolPreview";
import {
  emptySession,
  type AnnotationSession,
  type SessionAction,
} from "../src/services/annotationSession";
import {
  capturePreset,
  captureSymbol,
  readPresetLibrary,
  symbolViewport,
  writePresetLibrary,
} from "../src/services/presets";
import { SessionHistory } from "../src/services/sessionHistory";
import * as files from "../src/services/presetFiles";

vi.mock("../src/services/presetFiles", () => ({
  importPresetFile: vi.fn(),
  exportPresetFile: vi.fn(),
}));
const before: AnnotationSession = {
  ...emptySession,
  legends: [{ id: "walls", name: "Walls", color: "#facc15" }],
  annotations: [
    {
      id: "a",
      type: "freehand",
      page: 1,
      legendId: "walls",
      color: "#facc15",
      opacity: 0.4,
      width: 10,
      points: [
        { x: 100, y: 200 },
        { x: 200, y: 200 },
      ],
    },
  ],
};
const imported = capturePreset("Imported", {
  ...emptySession,
  drawing: { ...emptySession.drawing, width: 22 },
  legends: [{ id: "red", name: "Walls", color: "#ff0000" }],
});
const click = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name, exact: true }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

function setup(
  session = before,
  capture = () =>
    captureSymbol("Valve", session, ["a"], symbolViewport(600, 800)),
) {
  const apply = vi.fn<(action: SessionAction) => void>(),
    place = vi.fn(),
    close = vi.fn();
  render(
    <PresetLibrary
      session={session}
      onApply={apply}
      onCapture={capture}
      onPlace={place}
      onClose={close}
    />,
  );
  return { apply, place, close };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("previews an import and conflicts without changing the document or library, then applies a single undoable action", async () => {
  vi.mocked(files.importPresetFile).mockResolvedValue(imported);
  const { apply, close } = setup();
  click("Import preset");
  await screen.findByText("Imported · Imported preview");
  expect(screen.getByText("Name conflict: Walls → Walls (2)")).toBeDefined();
  expect(apply).not.toHaveBeenCalled();
  expect(readPresetLibrary()).toEqual([]);
  click("Apply preset");
  const history = new SessionHistory(before);
  expect(history.apply(apply.mock.calls[0][0])).toBe(true);
  expect(history.present.legends.map((l) => l.name)).toEqual([
    "Walls",
    "Walls (2)",
  ]);
  expect(history.present.annotations).toBe(before.annotations);
  expect(history.present.drawing.width).toBe(22);
  history.traverse("undo");
  expect(history.present).toBe(before);
  expect(close).toHaveBeenCalledOnce();
});

it("requires explicit duplicate replacement, preserves library on quota failure, and distinguishes library save from project apply", () => {
  writePresetLibrary([capturePreset("Plans", emptySession)]);
  const { apply } = setup();
  change("Preset name", "Plans");
  click("Save current settings");
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  expect(readPresetLibrary()[0].categories).toEqual([]);
  fireEvent.click(screen.getByLabelText("Replace existing preset"));
  click("Save current settings");
  expect(readPresetLibrary()[0].categories[0].name).toBe("Walls");
  expect(apply).not.toHaveBeenCalled();
  const saved = localStorage.getItem("pdf-markup.presets.v1");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Disk quota");
  });
  change("Preset name", "Another");
  click("Save current settings");
  expect(screen.getByRole("alert").textContent).toContain("Disk quota");
  expect(localStorage.getItem("pdf-markup.presets.v1")).toBe(saved);
  expect(screen.getByRole("status").textContent).not.toContain("Saved Another");
});

it("captures an original selection, previews and places it, and requires confirmation before removing its preset", () => {
  writePresetLibrary([capturePreset("Plans", before)]);
  const { place } = setup();
  change("New symbol name", "Valve");
  click("Save selected markups as symbol");
  expect(screen.getByRole("img", { name: "Preview of Valve" })).toBeDefined();
  expect(
    screen
      .getByRole("img", { name: "Preview of Valve" })
      .querySelector("polyline")
      ?.getAttribute("stroke-width"),
  ).toBe("10");
  expect(readPresetLibrary()[0].symbols).toHaveLength(1);
  click("Place on current page");
  expect(place.mock.calls[0][0].name).toBe("Valve");
  expect(place.mock.calls[0][1]).toBe(true);
  click("Remove from library");
  expect(readPresetLibrary()).toHaveLength(1);
  click("Keep preset");
  expect(readPresetLibrary()).toHaveLength(1);
  click("Remove from library");
  click("Confirm removal");
  expect(readPresetLibrary()).toEqual([]);
});

it("surfaces invalid selection, corrupt library and failed native export without overwriting saved state", async () => {
  writePresetLibrary([capturePreset("Plans", before)]);
  setup(before, () => {
    throw new Error("Select supported objects on one page.");
  });
  change("New symbol name", "Bad");
  click("Save selected markups as symbol");
  expect(screen.getByRole("alert").textContent).toContain("one page");
  expect(readPresetLibrary()[0].symbols).toEqual([]);
  vi.mocked(files.exportPresetFile).mockRejectedValue(
    new Error("Write failed"),
  );
  click("Export preset");
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Write failed"),
  );
  cleanup();
  localStorage.setItem("pdf-markup.presets.v1", "corrupt");
  setup();
  expect(screen.getByRole("alert").textContent).toContain(
    "Library unavailable",
  );
  change("Preset name", "New");
  expect(
    screen
      .getByRole("button", { name: "Save current settings" })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(localStorage.getItem("pdf-markup.presets.v1")).toBe("corrupt");
});

it("bounds expensive SVG previews rather than rendering every imported point", () => {
  const symbol = captureSymbol(
    "Complex",
    before,
    ["a"],
    symbolViewport(600, 800),
  );
  symbol.session.annotations[0].points = Array.from(
    { length: 20001 },
    (_, i) => ({ x: 100 + (i % 2), y: 200 }),
  );
  render(<SymbolPreview symbol={symbol} />);
  expect(screen.queryByRole("img")).toBeNull();
  expect(screen.getByText(/Preview omitted/)).toBeDefined();
});
