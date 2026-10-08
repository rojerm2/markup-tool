import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist";
import PdfNavigationView from "../src/components/PdfViewer/PdfNavigationView";
import { SessionHistory } from "../src/services/sessionHistory";
import { emptySession } from "../src/services/annotationSession";
import {
  applyPreset,
  capturePreset,
  writePresetLibrary,
} from "../src/services/presets";
import { DEFAULT_TOOL_STYLES } from "../src/services/toolStyles";

it("keeps preset dialog shortcuts out of the canvas and undoes only a placed symbol's highlights", () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
    this.querySelector<HTMLButtonElement>("button")?.focus();
  };
  localStorage.clear();
  const before = bulkFixture(),
    history = new SessionHistory(before);
  writePresetLibrary([capturePreset("Plans", before)]);
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  selectBulkRows();
  fireEvent.click(screen.getByRole("button", { name: "Presets", exact: true }));
  const close = screen.getByRole("button", { name: "Close", exact: true });
  fireEvent.keyDown(close, { key: " ", code: "Space" });
  expect(
    screen
      .getByRole("region", { name: "PDF pages" })
      .classList.contains("can-pan"),
  ).toBe(false);
  fireEvent.keyDown(close, { key: "Delete" });
  fireEvent.keyDown(close, { key: "a", ctrlKey: true });
  fireEvent.keyDown(close, { key: "z", ctrlKey: true });
  expect(history.present).toBe(before);
  fireEvent.change(screen.getByLabelText("New symbol name"), {
    target: { value: "Fixture" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save selected markups as symbol" }),
  );
  expect(screen.getByRole("img", { name: "Preview of Fixture" })).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Place on current page" }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(history.present.annotations).toHaveLength(2);
  expect(history.present.shapes).toHaveLength(2);
  expect(history.undoLabel).toBe("Draw highlight");
  expect(document.activeElement).toBe(
    screen.getByRole("region", { name: "PDF pages" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(history.present.annotations).toEqual(before.annotations);
  expect(history.present.shapes).toHaveLength(2);
  localStorage.clear();
});

it("restores preset tool styles in the viewer without adding highlight history", () => {
  measurementRect();
  const history = new SessionHistory(emptySession),
    preset = capturePreset("Dimensions", {
      ...emptySession,
      toolStyles: {
        ...DEFAULT_TOOL_STYLES,
        measurement: { color: "#ff0000", width: 4, fontSize: 24 },
      },
    });
  history.apply(
    applyPreset(history.present, preset, { styles: true, categories: false })
      .action!,
  );
  const applied = history.present;
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  fireEvent.change(screen.getByLabelText("Measurement tool"), {
    target: { value: "measure-length" },
  });
  expect(
    (screen.getByLabelText("Measurement text size") as HTMLInputElement).value,
  ).toBe("24");
  expect(
    (screen.getByLabelText("Measurement color") as HTMLInputElement).value,
  ).toBe("#ff0000");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(history.present).toBe(applied);
  expect(
    (screen.getByLabelText("Measurement text size") as HTMLInputElement).value,
  ).toBe("24");
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(history.present).toBe(applied);
  measurementLine();
  expect(history.present.measurements![0]).toMatchObject({
    color: "#ff0000",
    width: 4,
    fontSize: 24,
  });
});

function bulkFixture() {
  return {
    ...emptySession,
    legends: [{ id: "walls", name: "Walls", color: "#facc15" }],
    annotations: [
      {
        id: "stroke",
        type: "freehand" as const,
        page: 1,
        legendId: null,
        color: "#facc15",
        opacity: 0.4,
        width: 10,
        points: [
          { x: 100, y: 200 },
          { x: 200, y: 200 },
        ],
      },
    ],
    shapes: [
      {
        id: "shape",
        type: "rectangle" as const,
        page: 1,
        a: { x: 100, y: 300 },
        b: { x: 200, y: 400 },
        color: "#facc15",
        width: 2,
        fill: null,
      },
    ],
  };
}

function selectBulkRows() {
  fireEvent.click(screen.getByRole("button", { name: "Pages & markups" }));
  fireEvent.click(screen.getByRole("tab", { name: "Markups" }));
  const boxes = Array.from(
    document.querySelectorAll<HTMLInputElement>(".markup-select"),
  );
  boxes.forEach((box) => fireEvent.click(box));
  return boxes;
}

function measurementRect() {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: SVGElement) {
      return this.closest("[data-page]")!
        .querySelector("canvas")!
        .getBoundingClientRect();
    },
  );
}

function measurementPoint(pageNumber: number, x: number, y: number) {
  const box = screen
    .getByLabelText(`PDF page ${pageNumber}`)
    .getBoundingClientRect();
  return {
    clientX: box.left + (x * box.width) / 600,
    clientY: box.top + ((800 - y) * box.height) / 800,
  };
}

function measurementLine(pageNumber: number = 1) {
  const svg = screen.getByLabelText(`Measurements for page ${pageNumber}`);
  fireEvent.pointerDown(svg, {
    button: 0,
    pointerId: 7,
    ...measurementPoint(pageNumber, 100, 200),
  });
  fireEvent.pointerMove(svg, {
    buttons: 1,
    pointerId: 7,
    ...measurementPoint(pageNumber, 200, 200),
  });
  fireEvent.pointerUp(svg, {
    pointerId: 7,
    ...measurementPoint(pageNumber, 200, 200),
  });
}

it("calibrates/recalibrates outside highlight history and keeps other pages explicitly uncalibrated", () => {
  measurementRect();
  const history = new SessionHistory(emptySession);
  render(<PdfNavigationView pages={[page(1), page(2)]} history={history} />);
  const tool = screen.getByLabelText("Measurement tool");
  fireEvent.change(tool, { target: { value: "measure-calibrate" } });
  measurementLine();
  expect(history.undoLabel).toBeUndefined();
  fireEvent.scroll(
    screen.getByRole("complementary", { name: "Tools and properties" }),
  );
  fireEvent.blur(window);
  expect(screen.getByLabelText("Scale reference")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Known distance"), {
    target: { value: "10" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply scale" }));
  expect(history.present.calibrations![0].distance).toBe(10);
  expect(history.present.calibrations![0].unit).toBe("m");
  expect(history.undoLabel).toBeUndefined();
  measurementLine();
  expect(history.present.measurements).toHaveLength(1);
  const label = () =>
    document.querySelector("[data-measurement-id] text")!.textContent;
  expect(label()).toBe("10 m");
  fireEvent.change(tool, { target: { value: "measure-calibrate" } });
  fireEvent.change(screen.getByLabelText("Known distance"), {
    target: { value: "20" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply scale" }));
  expect(label()).toBe("20 m");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(label()).toBe("20 m");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  measurementLine(2);
  expect(history.present.measurements).toHaveLength(2);
  expect(history.present.calibrations).toHaveLength(1);
  expect(
    screen.getByLabelText("Measurements for page 2").querySelector("text")!
      .textContent,
  ).toBe("100 PDF units (uncalibrated)");
});

it("draws simple area/perimeter polygons and cancels invalid, saved or panned drafts without undo entries", () => {
  measurementRect();
  const history = new SessionHistory(emptySession);
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  const tool = screen.getByLabelText("Measurement tool"),
    host = screen.getByRole("region", { name: "PDF pages" });
  fireEvent.change(tool, { target: { value: "measure-area" } });
  const svg = screen.getByLabelText("Measurements for page 1");
  const vertex = (x: number, y: number) =>
    fireEvent.pointerDown(svg, {
      button: 0,
      pointerId: 7,
      ...measurementPoint(1, x, y),
    });
  [
    [100, 100],
    [200, 100],
    [200, 200],
    [100, 200],
  ].forEach(([x, y]) => vertex(x, y));
  fireEvent.keyDown(host, { key: "Enter" });
  expect(history.present.measurements?.[0].type).toBe("area");
  expect(svg.querySelector("text")!.textContent).toBe(
    "10,000 PDF units² (uncalibrated)",
  );
  const before = history.present;
  [
    [100, 100],
    [200, 200],
    [100, 200],
    [200, 100],
  ].forEach(([x, y]) => vertex(x, y));
  fireEvent.keyDown(host, { key: "Enter" });
  expect(history.present).toBe(before);
  expect(screen.getByText(/simple polygon without crossing/)).toBeDefined();
  vertex(100, 100);
  vertex(200, 100);
  act(() => history.cancelSnapshotDrafts());
  fireEvent.keyDown(host, { key: "Enter" });
  expect(history.present).toBe(before);
  vertex(100, 100);
  vertex(200, 100);
  fireEvent.keyDown(host, { code: "Space", key: " " });
  fireEvent.keyUp(host, { code: "Space", key: " " });
  fireEvent.keyDown(host, { key: "Enter" });
  expect(history.present).toBe(before);
  fireEvent.change(tool, { target: { value: "measure-perimeter" } });
  [
    [100, 100],
    [200, 100],
    [200, 200],
    [100, 200],
  ].forEach(([x, y]) => vertex(x, y));
  fireEvent.keyDown(host, { key: "Enter" });
  expect(history.present.measurements?.[1].type).toBe("perimeter");
  expect(svg.querySelectorAll("text")[1].textContent).toBe(
    "400 PDF units (uncalibrated)",
  );
});

it("selects measurements from the list, nudges with arrows, applies appearance atomically and respects category protection", () => {
  measurementRect();
  const measurement = {
    id: "dimension",
    page: 1,
    type: "length" as const,
    points: [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ],
    color: "#0284c7",
    width: 2,
    fontSize: 12,
  };
  const history = new SessionHistory({
    ...emptySession,
    measurements: [measurement],
    legends: [{ id: "walls", name: "Walls", color: "#facc15" }],
    objectCategories: { dimension: "walls" },
  });
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  fireEvent.click(screen.getByRole("button", { name: "Pages & markups" }));
  fireEvent.click(screen.getByRole("tab", { name: "Markups" }));
  fireEvent.change(screen.getByLabelText("Markup type filter"), {
    target: { value: "measurement" },
  });
  fireEvent.click(document.querySelector(".markup-jump")!);
  const host = screen.getByRole("region", { name: "PDF pages" });
  expect(document.activeElement).toBe(host);
  fireEvent.keyDown(host, { key: "ArrowRight" });
  expect(history.present.measurements![0].points[0].x).toBe(102);
  const before = history.present;
  fireEvent.click(screen.getByRole("button", { name: "Properties" }));
  fireEvent.change(screen.getByLabelText("Measurement text size"), {
    target: { value: "24" },
  });
  expect(history.present).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Apply appearance" }));
  expect(history.present.measurements![0].fontSize).toBe(24);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(history.present.measurements![0].fontSize).toBe(24);
  expect(history.present.measurements![0].points[0].x).toBe(102);
  expect(history.undoLabel).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Legends (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Lock category Walls" }));
  fireEvent.change(screen.getByLabelText("Measurement tool"), {
    target: { value: "measure-calibrate" },
  });
  expect(
    screen
      .getByRole("button", { name: "Calibrate page" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Hide category Walls" }));
  expect(
    screen
      .getByLabelText("Measurements for page 1")
      .querySelector("[data-measurement-id]"),
  ).toBeNull();
});

it("edits measurement vertices outside highlight history, cancels stale drags/drafts and clears empty-space selection", () => {
  measurementRect();
  const value = {
      id: "dimension",
      page: 1,
      type: "length" as const,
      points: [
        { x: 100, y: 200 },
        { x: 200, y: 200 },
      ],
      color: "#0284c7",
      width: 2,
      fontSize: 12,
    },
    history = new SessionHistory({ ...emptySession, measurements: [value] });
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  fireEvent.click(screen.getByRole("button", { name: "Select/Edit" }));
  const svg = screen.getByLabelText("Measurements for page 1"),
    host = screen.getByRole("region", { name: "PDF pages" });
  fireEvent.pointerDown(svg.querySelector("[data-measurement-id]")!, {
    button: 0,
    pointerId: 7,
    ...measurementPoint(1, 100, 200),
  });
  fireEvent.pointerUp(svg, { pointerId: 7, ...measurementPoint(1, 100, 200) });
  const before = history.present;
  fireEvent.pointerDown(svg.querySelector('[data-measurement-vertex="1"]')!, {
    button: 0,
    pointerId: 7,
    ...measurementPoint(1, 200, 200),
  });
  fireEvent.pointerMove(svg, {
    buttons: 1,
    pointerId: 7,
    ...measurementPoint(1, 250, 250),
  });
  expect(history.present).toBe(before);
  fireEvent.pointerUp(svg, { pointerId: 7, ...measurementPoint(1, 250, 250) });
  expect(history.present.measurements![0].points[1]).toEqual({
    x: 250,
    y: 250,
  });
  expect(history.undoLabel).toBeUndefined();
  fireEvent.change(screen.getByLabelText("Measurement text size"), {
    target: { value: "24" },
  });
  act(() => history.cancelSnapshotDrafts());
  expect(
    (screen.getByLabelText("Measurement text size") as HTMLInputElement).value,
  ).toBe("12");
  expect(
    screen
      .getByRole("button", { name: "Apply appearance" })
      .hasAttribute("disabled"),
  ).toBe(true);
  const edited = history.present;
  fireEvent.pointerDown(svg.querySelector('[data-measurement-vertex="1"]')!, {
    button: 0,
    pointerId: 7,
    ...measurementPoint(1, 250, 250),
  });
  fireEvent.pointerMove(svg, {
    buttons: 1,
    pointerId: 7,
    ...measurementPoint(1, 300, 300),
  });
  act(() => history.cancelSnapshotDrafts());
  fireEvent.pointerUp(svg, { pointerId: 7, ...measurementPoint(1, 300, 300) });
  expect(history.present).toBe(edited);
  fireEvent.pointerDown(screen.getByLabelText("PDF page 1"), { button: 0 });
  expect(screen.queryByLabelText("Measurement properties")).toBeNull();
  fireEvent.keyDown(host, { key: "ArrowRight" });
  expect(history.present).toBe(edited);
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(history.present).toBe(edited);
  expect(history.undoLabel).toBeUndefined();
});

it("adds and removes canvas marks with Shift-click, then clears the group on a result jump or background click", () => {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: SVGElement) {
      return this.closest("[data-page]")!
        .querySelector("canvas")!
        .getBoundingClientRect();
    },
  );
  const before = bulkFixture(),
    history = new SessionHistory(before);
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  fireEvent.click(screen.getByRole("button", { name: "Select/Edit" }));
  const canvas = screen.getByLabelText("PDF page 1"),
    host = screen.getByRole("region", { name: "PDF pages" });
  const box = canvas.getBoundingClientRect(),
    scale = box.width / 600;
  const hit = () =>
    fireEvent.pointerDown(screen.getByLabelText("Highlights for page 1"), {
      pointerId: 8,
      button: 0,
      shiftKey: true,
      clientX: box.left + 150 * scale,
      clientY: box.top + 600 * scale,
    });
  hit();
  expect(screen.getByText("1 selected")).toBeDefined();
  fireEvent.pointerDown(
    screen
      .getByLabelText("Shapes for page 1")
      .querySelector('[data-shape-id="shape"]')!,
    {
      pointerId: 8,
      button: 0,
      shiftKey: true,
      clientX: box.left + 100 * scale,
      clientY: box.top + 450 * scale,
    },
  );
  expect(screen.getByText("2 selected")).toBeDefined();
  expect(document.activeElement).toBe(host);
  expect(history.present).toBe(before);
  hit();
  expect(screen.getByText("1 selected")).toBeDefined();
  hit();
  fireEvent.click(screen.getByRole("button", { name: "Pages & markups" }));
  fireEvent.click(screen.getByRole("tab", { name: "Markups" }));
  fireEvent.click(document.querySelector(".markup-jump")!);
  expect(screen.getByText("1 selected")).toBeDefined();
  expect(screen.queryByLabelText("Selection for page 1")).toBeNull();
  fireEvent.pointerDown(canvas, { button: 0 });
  expect(screen.queryByText("1 selected")).toBeNull();
});

it("copies a mixed selection to another page, preserves typing shortcuts, and pastes with one Undo step", () => {
  const history = new SessionHistory(bulkFixture());
  render(<PdfNavigationView pages={[page(1), page(2)]} history={history} />);
  const boxes = selectBulkRows();
  expect(screen.getByText("2 selected")).toBeDefined();
  boxes[1].focus();
  fireEvent.keyDown(boxes[1], { key: "c", ctrlKey: true });
  expect(
    screen.getByRole("button", { name: "Paste" }).hasAttribute("disabled"),
  ).toBe(false);
  const search = screen.getByRole("searchbox");
  search.focus();
  fireEvent.keyDown(search, { key: "v", ctrlKey: true });
  expect(history.present.annotations).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.focus();
  fireEvent.keyDown(host, { key: "v", ctrlKey: true });
  expect(history.present.annotations).toHaveLength(2);
  expect(history.present.shapes).toHaveLength(2);
  expect(history.present.annotations[1].page).toBe(2);
  expect(history.present.shapes![1].page).toBe(2);
  expect(screen.getByLabelText("Selection for page 2")).toBeDefined();
  expect(history.undoLabel).toBe("Draw highlight");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(history.present.annotations).toHaveLength(1);
  expect(history.present.shapes).toHaveLength(2);
  expect(screen.queryByText("2 selected")).toBeNull();
  expect(history.undoLabel).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(history.present.annotations).toHaveLength(2);
});

it("nudges, assigns, duplicates and deletes a group atomically without panning or editing locked categories", () => {
  const before = bulkFixture(),
    history = new SessionHistory(before);
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  selectBulkRows();
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.focus();
  const scroll = host.scrollLeft;
  fireEvent.keyDown(host, { key: "ArrowRight" });
  expect(history.present.annotations[0].points[0].x).toBe(102);
  expect(history.present.shapes![0].a.x).toBe(102);
  expect(host.scrollLeft).toBe(scroll);
  expect(history.undoLabel).toBe("Move highlight");
  fireEvent.keyDown(host, { code: "Space", key: " " });
  expect(host.className).toContain("can-pan");
  fireEvent.keyUp(host, { code: "Space", key: " " });
  fireEvent.change(screen.getByLabelText("Selection category"), {
    target: { value: "category:walls" },
  });
  expect(history.present.annotations[0].legendId).toBe("walls");
  expect(history.present.objectCategories?.shape).toBe("walls");
  fireEvent.keyDown(host, { key: "d", ctrlKey: true });
  expect(history.present.annotations).toHaveLength(2);
  expect(history.undoLabel).toBe("Draw highlight");
  fireEvent.keyDown(host, { key: "Delete" });
  expect(history.present.annotations).toHaveLength(1);
  expect(history.undoLabel).toBe("Delete highlight");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(history.present.annotations).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Properties" }));
  fireEvent.click(screen.getByRole("button", { name: "Legends (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "Lock category Walls" }));
  expect(
    Array.from(
      document.querySelectorAll<HTMLInputElement>(".markup-select"),
    ).every((b) => b.disabled),
  ).toBe(true);
  host.focus();
  fireEvent.keyDown(host, { key: "a", ctrlKey: true });
  expect(screen.queryByText("4 selected")).toBeNull();
});

it("moves from the group outline in one step and cancels unfinished drag on Save, Space and Undo", () => {
  const history = new SessionHistory(bulkFixture());
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  selectBulkRows();
  const overlay = () => screen.getByLabelText("Selection for page 1");
  const begin = () => {
    fireEvent.pointerDown(overlay().querySelector("rect:last-child")!, {
      pointerId: 9,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(overlay(), {
      pointerId: 9,
      buttons: 1,
      clientX: 127,
      clientY: 100,
    });
  };
  begin();
  fireEvent.pointerUp(overlay(), { pointerId: 9, clientX: 127, clientY: 100 });
  expect(history.present.annotations[0].points[0].x).toBeCloseTo(140);
  expect(history.present.shapes![0].a.x).toBeCloseTo(140);
  expect(history.undoLabel).toBe("Move highlight");
  const saved = history.present;
  begin();
  act(() => history.cancelSnapshotDrafts());
  fireEvent.pointerUp(overlay(), { pointerId: 9, clientX: 150, clientY: 100 });
  expect(history.present).toBe(saved);
  begin();
  fireEvent.keyDown(screen.getByRole("region", { name: "PDF pages" }), {
    code: "Space",
    key: " ",
  });
  fireEvent.keyUp(screen.getByRole("region", { name: "PDF pages" }), {
    code: "Space",
    key: " ",
  });
  fireEvent.pointerUp(overlay(), { pointerId: 9, clientX: 150, clientY: 100 });
  expect(history.present).toBe(saved);
  begin();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(history.present.annotations[0].points[0].x).toBe(100);
  expect(screen.queryByLabelText("Selection for page 1")).toBeNull();
});

it("hides categories only in the workspace and prevents locked canvas edits until explicitly unlocked", () => {
  const stroke = {
    id: "protected",
    type: "freehand" as const,
    page: 1,
    legendId: "wall",
    color: "#facc15",
    opacity: 0.4,
    width: 10,
    points: [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ],
  };
  const history = new SessionHistory({
    ...emptySession,
    legends: [{ id: "wall", name: "Walls", color: "#facc15" }],
    annotations: [stroke],
  });
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  fireEvent.click(screen.getByRole("button", { name: "Legends (1)" }));
  const overlay = screen.getByLabelText("Highlights for page 1");
  expect(
    overlay.querySelector('[data-annotation-id="protected"]'),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Hide category Walls" }));
  expect(overlay.querySelector('[data-annotation-id="protected"]')).toBeNull();
  expect(history.present.annotations[0]).toBe(stroke);
  fireEvent.click(screen.getByRole("button", { name: "Show category Walls" }));
  expect(
    overlay.querySelector('[data-annotation-id="protected"]'),
  ).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Lock category Walls" }));
  expect(
    screen
      .getByRole("button", { name: "Delete legend Walls" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Select/Edit" }));
  fireEvent.pointerDown(overlay, {
    pointerId: 8,
    button: 0,
    clientX: 299,
    clientY: 550,
  });
  fireEvent.pointerMove(overlay, {
    pointerId: 8,
    buttons: 1,
    clientX: 349,
    clientY: 550,
  });
  fireEvent.pointerUp(overlay, { pointerId: 8 });
  expect(history.present.annotations[0]).toBe(stroke);
  const lockedSession = history.present;
  history.apply({ type: "remove-stroke", id: "protected" });
  expect(history.present).toBe(lockedSession);
  fireEvent.click(
    screen.getByRole("button", { name: "Unlock category Walls" }),
  );
  expect(
    screen
      .getByRole("button", { name: "Delete legend Walls" })
      .hasAttribute("disabled"),
  ).toBe(false);
  expect(history.apply({ type: "remove-stroke", id: "protected" })).toBe(true);
});

it("restores page/zoom/center and flushes the latest view before a save snapshot", () => {
  const history = new SessionHistory(emptySession),
    onNavigation = vi.fn();
  const navigation = {
    bookmarks: [{ page: 2, label: "Ground floor" }],
    view: {
      page: 2,
      mode: "manual" as const,
      zoom: 2,
      center: { x: 300, y: 400 },
    },
  };
  render(
    <PdfNavigationView
      pages={[page(1), page(2)]}
      history={history}
      navigation={navigation}
      onNavigation={onNavigation}
    />,
  );
  expect((screen.getByLabelText("Page number") as HTMLInputElement).value).toBe(
    "2",
  );
  expect(
    (screen.getByLabelText("PDF page 2") as HTMLCanvasElement).style.height,
  ).toBe("1600px");
  act(() => history.cancelSnapshotDrafts());
  expect(onNavigation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      bookmarks: navigation.bookmarks,
      view: expect.objectContaining({
        page: 2,
        zoom: 2,
        center: navigation.view.center,
      }),
    }),
  );
  expect(history.undoLabel).toBeUndefined();
});

it("reveals an off-page markup, transfers focus and nudges the selected highlight with arrows", () => {
  const stroke = {
    id: "off-page",
    type: "freehand" as const,
    page: 2,
    legendId: null,
    color: "#facc15",
    opacity: 0.4,
    width: 10,
    points: [
      { x: 100, y: 200 },
      { x: 200, y: 200 },
    ],
  };
  const history = new SessionHistory({
    ...emptySession,
    annotations: [stroke],
  });
  render(<PdfNavigationView pages={[page(1), page(2)]} history={history} />);
  fireEvent.click(screen.getByRole("button", { name: "Pages & markups" }));
  fireEvent.click(screen.getByRole("tab", { name: "Markups" }));
  fireEvent.click(document.querySelector(".markup-jump")!);
  const host = screen.getByRole("region", { name: "PDF pages" });
  expect(document.activeElement).toBe(host);
  expect((screen.getByLabelText("Page number") as HTMLInputElement).value).toBe(
    "2",
  );
  expect(history.undoLabel).toBeUndefined();
  fireEvent.keyDown(host, { key: "ArrowRight" });
  expect(history.present.annotations[0].points[0].x).toBe(102);
  expect(history.undoLabel).toBe("Move highlight");
  fireEvent.keyDown(host, { code: "Space" });
  expect(host.className).toContain("can-pan");
  fireEvent.keyUp(host, { code: "Space" });
});

let width = 800,
  height = 600;
let resize: () => void;
let captured: number | null;

function rect(left: number, top: number, w: number, h: number): DOMRect {
  return {
    left,
    top,
    width: w,
    height: h,
    right: left + w,
    bottom: top + h,
    x: left,
    y: top,
    toJSON() {},
  };
}

function page(number: number, w = 600, h = 800) {
  return {
    pageNumber: number,
    getViewport: ({ scale }: { scale: number }) => ({
      width: w * scale,
      height: h * scale,
      convertToViewportPoint: (x: number, y: number) => [
        x * scale,
        (h - y) * scale,
      ],
      convertToPdfPoint: (x: number, y: number) => [x / scale, h - y / scale],
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  } as unknown as PDFPageProxy;
}
beforeEach(() => {
  width = 800;
  height = 600;
  captured = null;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    {} as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
    () => width,
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    () => height,
  );
  Object.defineProperties(Element.prototype, {
    setPointerCapture: {
      configurable: true,
      value: (id: number) => {
        captured = id;
      },
    },
    hasPointerCapture: {
      configurable: true,
      value: (id: number) => captured === id,
    },
    releasePointerCapture: {
      configurable: true,
      value: () => {
        captured = null;
      },
    },
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const host = document.querySelector<HTMLElement>(".pdf-scroll");
      if (this === host) return rect(0, 100, width, height);
      const wrapper = this.closest<HTMLElement>("[data-page]");
      if (!host || !wrapper) return rect(0, 0, 0, 0);
      let top = 116 - host.scrollTop;
      for (const sibling of Array.from(
        wrapper.parentElement!.children,
      ) as HTMLElement[]) {
        if (sibling === wrapper) break;
        top += Number.parseFloat(sibling.style.minHeight) + 16;
      }
      const w = Number.parseFloat(wrapper.style.width),
        h = Number.parseFloat(wrapper.style.minHeight);
      return rect(
        Math.max(16, (width - w) / 2) - host.scrollLeft,
        top + (this.tagName === "CANVAS" ? 28 : 0),
        w,
        h - (this.tagName === "CANVAS" ? 28 : 0),
      );
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("navigates with buttons/input, rejects invalid pages, and tracks scrolling", () => {
  render(<PdfNavigationView pages={[page(1), page(2), page(3)]} />);
  const input = screen.getByRole("textbox", {
    name: "Page number",
  }) as HTMLInputElement;
  expect(
    screen
      .getByRole("button", { name: "Previous page" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(input.value).toBe("2");
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.submit(input.closest("form")!);
  expect(
    screen.getByRole("button", { name: "Next page" }).hasAttribute("disabled"),
  ).toBe(true);
  for (const invalid of ["0", "4", "1.5", "abc", ""]) {
    fireEvent.change(input, { target: { value: invalid } });
    fireEvent.submit(input.closest("form")!);
    expect(input.value).toBe("3");
  }
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.scrollTop = 0;
  fireEvent.scroll(host);
  expect(input.value).toBe("1");
});

it("fits mixed page sizes, responds to resize, and keeps manual zoom across resize", () => {
  render(<PdfNavigationView pages={[page(1), page(2, 1200, 600)]} />);
  const canvas = () => screen.getByLabelText("PDF page 1") as HTMLCanvasElement;
  expect(canvas().style.height).toBe("540px");
  fireEvent.click(screen.getByRole("button", { name: "Fit to page" }));
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  act(() => {
    width = 700;
    resize();
  });
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  act(() => {
    width = 800;
    resize();
  });
  fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
  expect(canvas().style.width).toBe("768px");
  expect(
    (screen.getByLabelText("PDF page 2") as HTMLCanvasElement).style.width,
  ).toBe("768px");
  act(() => {
    width = 500;
    resize();
  });
  expect(canvas().style.width).toBe("468px");
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  expect(canvas().style.width).toBe("600px");
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.scrollTop = 120;
  act(() => {
    width = 400;
    resize();
  });
  expect(canvas().style.width).toBe("600px");
  expect(host.scrollTop).toBe(120);
});

it("anchors zoom to the viewed PDF point, cancels old rasters and bounds zoom/allocation", () => {
  const first = page(1);
  render(<PdfNavigationView pages={[first]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.scrollTop = 200;
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByLabelText("Zoom level").textContent).toBe("125%");
  // Viewport center (y=300) was 456 CSS pixels into the page at 100%.
  expect(host.scrollTop).toBeCloseTo(314);
  expect(
    vi.mocked(first.render).mock.results[0].value.cancel,
  ).toHaveBeenCalledOnce();
  for (let i = 0; i < 20; i++)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByLabelText("Zoom level").textContent).toBe("3200%");
  expect(
    screen.getByRole("button", { name: "Zoom in" }).hasAttribute("disabled"),
  ).toBe(true);
  const canvas = screen.getByLabelText("PDF page 1") as HTMLCanvasElement;
  expect(canvas.width * canvas.height).toBeLessThanOrEqual(16_000_000);
  expect(Math.max(canvas.width, canvas.height)).toBeLessThanOrEqual(8192);
  for (let i = 0; i < 30; i++)
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
  expect(screen.getByLabelText("Zoom level").textContent).toBe("10%");
  expect(
    screen.getByRole("button", { name: "Zoom out" }).hasAttribute("disabled"),
  ).toBe(true);
});

it("pans only with Space, captures the pointer and releases on keyup, blur and cancel", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const host = screen.getByRole("region", { name: "PDF pages" });
  const canvas = screen.getByLabelText("PDF page 1");
  const down = () =>
    fireEvent.pointerDown(canvas, {
      button: 0,
      pointerId: 7,
      clientX: 200,
      clientY: 200,
    });
  const move = () =>
    fireEvent.pointerMove(host, { pointerId: 7, clientX: 150, clientY: 120 });
  down();
  move();
  expect(host.scrollTop).toBe(0);
  fireEvent.keyDown(window, { code: "Space" });
  down();
  move();
  expect([host.scrollLeft, host.scrollTop]).toEqual([50, 80]);
  expect(captured).toBe(7);
  fireEvent.keyUp(window, { code: "Space" });
  expect(captured).toBeNull();
  move();
  expect(host.scrollTop).toBe(80);
  for (const end of [
    () => fireEvent.blur(window),
    () => fireEvent.pointerCancel(host),
    () => fireEvent.pointerUp(host, { pointerId: 7 }),
  ]) {
    fireEvent.keyDown(window, { code: "Space" });
    down();
    expect(captured).toBe(7);
    end();
    expect(captured).toBeNull();
  }
  fireEvent.keyUp(window, { code: "Space" });
  fireEvent.keyDown(screen.getByRole("textbox"), { code: "Space" });
  down();
  expect(captured).toBe(7); // Numeric page entry yields to canvas panning.
  fireEvent.keyUp(window, { code: "Space" });
});

it("preserves keyboard toolbar activation and pans from page focus", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const host = screen.getByRole("region", { name: "PDF pages" });
  const button = screen.getByRole("button", { name: "100%" });
  button.focus();
  fireEvent.click(button);
  expect(fireEvent.keyDown(button, { code: "Space" })).toBe(true);
  expect(host.className).not.toContain("can-pan");
  host.focus();
  expect(fireEvent.keyDown(host, { code: "Space" })).toBe(false);
  const overlay = screen.getByLabelText("Highlights for page 1");
  fireEvent.pointerDown(overlay, {
    pointerId: 8,
    button: 0,
    clientX: 300,
    clientY: 300,
  });
  fireEvent.pointerMove(host, {
    pointerId: 8,
    buttons: 1,
    clientX: 200,
    clientY: 200,
  });
  fireEvent.keyUp(button, { code: "Space" });
  fireEvent.pointerUp(overlay, { pointerId: 8 });
  expect(host.scrollLeft).toBe(100);
  expect(overlay.querySelector("polyline")).toBeNull();
  expect(
    fireEvent.keyDown(screen.getByRole("textbox"), { code: "Space" }),
  ).toBe(false);
  fireEvent.keyUp(window, { code: "Space" });
});

it.each(["100%", "Highlight", "Blue", "Undo"])(
  "pans immediately after a mouse click on %s without reactivating the button",
  (name) => {
    const history = new SessionHistory(emptySession);
    if (name === "Undo")
      history.apply({ type: "commit", stroke: bulkFixture().annotations[0] });
    render(<PdfNavigationView pages={[page(1)]} history={history} />);
    const host = screen.getByRole("region", { name: "PDF pages" });
    const button = screen.getByRole("button", { name, exact: true });
    button.focus();
    fireEvent.click(button, { detail: 1 });
    expect(document.activeElement).toBe(host);
    const activated = vi.fn();
    button.addEventListener("click", activated);
    expect(fireEvent.keyDown(document.activeElement!, { code: "Space" })).toBe(
      false,
    );
    expect(document.activeElement).toBe(host);
    expect(host.className).toContain("can-pan");
    const overlay = screen.getByLabelText("Highlights for page 1");
    fireEvent.pointerDown(overlay, {
      pointerId: 8,
      button: 0,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(host, {
      pointerId: 8,
      buttons: 1,
      clientX: 200,
      clientY: 200,
    });
    expect(host.scrollLeft).toBe(100);
    expect(overlay.querySelector("polyline")).toBeNull();
    expect(fireEvent.keyUp(button, { code: "Space" })).toBe(false);
    expect(captured).toBeNull();
    expect(activated).not.toHaveBeenCalled();
    // A completed pointer gesture can emit a click, clearing toolbar-click
    // tracking. The next Space gesture must still work from actual focus.
    fireEvent.click(host, { detail: 1 });
    for (const id of [9, 10]) {
      expect(
        fireEvent.keyDown(document.activeElement!, { code: "Space" }),
      ).toBe(false);
      expect(document.activeElement).toBe(host);
      fireEvent.pointerDown(overlay, {
        pointerId: id,
        button: 0,
        clientX: 300,
        clientY: 300,
      });
      fireEvent.pointerMove(host, {
        pointerId: id,
        buttons: 1,
        clientX: 250,
        clientY: 250,
      });
      fireEvent.pointerUp(host, { pointerId: id });
      fireEvent.click(host, { detail: 1 });
      expect(fireEvent.keyUp(document.activeElement!, { code: "Space" })).toBe(
        false,
      );
      expect(captured).toBeNull();
      expect(host.className).not.toContain("can-pan");
    }
    expect(host.scrollLeft).toBe(200);
    expect(overlay.querySelector("polyline")).toBeNull();
    expect(activated).not.toHaveBeenCalled();
    button.focus();
    fireEvent.keyDown(button, { code: "Tab" });
    expect(fireEvent.keyDown(button, { code: "Space" })).toBe(true);
    expect(host.className).not.toContain("can-pan");
  },
);

it("applies arbitrary widths outside history and cancels width drafts on keyboard Undo", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const slider = screen.getByRole("slider", { name: "Highlight width slider" });
  const width = () =>
    (screen.getByLabelText("Highlight width") as HTMLInputElement).value;
  fireEvent.change(slider, { target: { value: "50" } });
  fireEvent.change(slider, { target: { value: "100" } });
  fireEvent.pointerUp(slider);
  expect(width()).toBe("100");
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(width()).toBe("100");
  fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
  expect(width()).toBe("100");
  fireEvent.change(slider, { target: { value: "0.25" } });
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  fireEvent.pointerUp(slider);
  expect(width()).toBe("100");
  fireEvent.change(slider, { target: { value: "0.25" } });
  fireEvent.pointerUp(slider);
  const overlay = screen.getByLabelText("Highlights for page 1");
  Object.defineProperty(overlay, "getBoundingClientRect", {
    value: () => rect(0, 0, 600, 800),
  });
  fireEvent.pointerDown(overlay, {
    pointerId: 8,
    button: 0,
    clientX: 300,
    clientY: 300,
  });
  fireEvent.pointerMove(overlay, {
    pointerId: 8,
    buttons: 1,
    clientX: 400,
    clientY: 400,
  });
  fireEvent.pointerUp(overlay, { pointerId: 8, clientX: 400, clientY: 400 });
  expect(
    Number(overlay.querySelector("polyline")?.getAttribute("stroke-width")),
  ).toBeGreaterThan(0);
  expect(
    Number(overlay.querySelector("polyline")?.getAttribute("stroke-width")),
  ).toBeLessThan(0.25);
});

it("cancels only Ctrl-wheel, anchors to the pointer and respects wheel zoom limits", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const canvas = screen.getByLabelText("PDF page 1");
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.scrollTop = 200;
  const before = canvas.getBoundingClientRect();
  const relativeY = 300 - before.top;
  expect(
    fireEvent.wheel(canvas, { deltaY: -100, clientX: 300, clientY: 300 }),
  ).toBe(true);
  expect(screen.getByLabelText("Zoom level").textContent).toBe("100%");
  expect(
    fireEvent.wheel(canvas, {
      ctrlKey: true,
      deltaY: -100,
      clientX: 300,
      clientY: 300,
    }),
  ).toBe(false);
  const after = screen.getByLabelText("PDF page 1").getBoundingClientRect();
  expect(after.top + relativeY * Math.exp(0.2)).toBeCloseTo(300);
  for (let i = 0; i < 10; i++)
    fireEvent.wheel(host, { ctrlKey: true, deltaY: -500 });
  expect(screen.getByLabelText("Zoom level").textContent).toBe("3200%");
  for (let i = 0; i < 10; i++)
    fireEvent.wheel(host, { ctrlKey: true, deltaY: 500 });
  expect(screen.getByLabelText("Zoom level").textContent).toBe("10%");
});

it("retains page-specific vectors through navigation, zoom and fit resize", () => {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: SVGElement) {
      return this.closest("[data-page]")!
        .querySelector("canvas")!
        .getBoundingClientRect();
    },
  );
  render(<PdfNavigationView pages={[page(1), page(2)]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const svg = screen.getByLabelText("Highlights for page 1");
  const rect = svg.getBoundingClientRect();
  fireEvent.pointerDown(svg, {
    button: 0,
    pointerId: 4,
    clientX: rect.left + 40,
    clientY: rect.top + 50,
  });
  fireEvent.pointerUp(svg, {
    pointerId: 4,
    clientX: rect.left + 80,
    clientY: rect.top + 90,
  });
  const line = () => svg.querySelector("polyline")!;
  expect(line().getAttribute("points")).toBe("40,50 80,90");
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(
    screen.getByLabelText("Highlights for page 2").querySelector("polyline"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(line().getAttribute("points")).toBe("50,62.5 100,112.5");
  fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
  act(() => {
    width = 632;
    resize();
  });
  expect(line().getAttribute("points")).toBe("40,50 80,90");
});

it("applies selected palette and width to new vectors, retaining old styling across zoom and resize", () => {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: SVGElement) {
      return this.closest("[data-page]")!
        .querySelector("canvas")!
        .getBoundingClientRect();
    },
  );
  render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole("button", { name: "100%" }));
  const svg = screen.getByLabelText("Highlights for page 1");
  const draw = () => {
    const bounds = svg.getBoundingClientRect();
    fireEvent.pointerDown(svg, {
      button: 0,
      pointerId: 4,
      clientX: bounds.left + 40,
      clientY: bounds.top + 50,
    });
    fireEvent.pointerUp(svg, {
      pointerId: 4,
      clientX: bounds.left + 80,
      clientY: bounds.top + 90,
    });
  };
  draw();
  fireEvent.click(screen.getByRole("button", { name: "Thick" }));
  fireEvent.click(screen.getByRole("button", { name: "Blue" }));
  expect(
    screen.getByRole("button", { name: "Blue" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(
    screen.getByRole("button", { name: "Yellow" }).getAttribute("aria-pressed"),
  ).toBe("false");
  expect(
    screen.getByRole("button", { name: "Thick" }).getAttribute("aria-pressed"),
  ).toBe("true");
  draw();
  const lines = () => [...svg.querySelectorAll("polyline")];
  expect(
    lines().map((p) => [
      p.getAttribute("stroke"),
      p.getAttribute("stroke-width"),
    ]),
  ).toEqual([
    ["#facc15", "10"],
    ["#38bdf8", "20"],
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(lines().map((p) => p.getAttribute("stroke-width"))).toEqual([
    "12.5",
    "25",
  ]);
  fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
  act(() => {
    width = 632;
    resize();
  });
  expect(lines().map((p) => p.getAttribute("stroke-width"))).toEqual([
    "10",
    "20",
  ]);
});

it("validates legends, snapshots assignment, detaches deleted drafts and preserves manual width", () => {
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: SVGElement) {
      return this.closest("[data-page]")!
        .querySelector("canvas")!
        .getBoundingClientRect();
    },
  );
  render(<PdfNavigationView pages={[page(1)]} />);
  const click = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name, exact: true }));
  click("100%");
  click("Legends (0)");
  const name = screen.getByLabelText("Legend name");
  const create = (value: string) => {
    fireEvent.change(name, { target: { value } });
    click("Create legend");
  };
  create("   ");
  expect(screen.getByRole("alert").textContent).toBe("Enter a legend name.");
  expect(name.getAttribute("aria-invalid")).toBe("true");
  click("Thick");
  create("  Walls  ");
  const active = () => screen.getByLabelText("Active legend").textContent;
  expect(active()).toBe("Active: Walls");
  create("wALLS ");
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  create("Doors");
  const svg = screen.getByLabelText("Highlights for page 1");
  const bounds = svg.getBoundingClientRect();
  const down = () =>
    fireEvent.pointerDown(svg, {
      button: 0,
      pointerId: 4,
      clientX: bounds.left + 40,
      clientY: bounds.top + 50,
    });
  const up = () =>
    fireEvent.pointerUp(svg, {
      pointerId: 4,
      clientX: bounds.left + 80,
      clientY: bounds.top + 90,
    });
  const lines = () => [...svg.querySelectorAll("polyline")];
  click("Select legend Walls");
  down();
  const wallId = svg
    .querySelector("[data-draft]")!
    .getAttribute("data-legend-id");
  click("Select legend Doors");
  click("Thin");
  up();
  expect(lines()[0].getAttribute("data-legend-id")).toBe(wallId);
  expect(lines()[0].getAttribute("stroke-width")).toBe("20");
  down();
  up();
  const doorId = lines()[1].getAttribute("data-legend-id");
  expect(doorId).not.toBe(wallId);
  expect(lines()[1].getAttribute("stroke-width")).toBe("5");
  click("Rename legend Walls");
  fireEvent.change(name, { target: { value: "   " } });
  click("Save name");
  expect(screen.getByRole("alert").textContent).toBe("Enter a legend name.");
  fireEvent.change(name, { target: { value: " doors " } });
  click("Save name");
  expect(screen.getByRole("alert").textContent).toContain("already exists");
  fireEvent.change(name, { target: { value: " Exterior walls " } });
  click("Save name");
  expect(lines()[0].getAttribute("data-legend-id")).toBe(wallId);
  click("Yellow");
  expect(active()).toBe("Unassigned · Manual color");
  down();
  up();
  expect(lines()[2].getAttribute("data-legend-id")).toBe("");
  expect(svg.querySelectorAll("g")).toHaveLength(1);
  click("Select legend Exterior walls");
  down();
  const before = lines()[0].outerHTML;
  click("Delete legend Exterior walls");
  expect(active()).toBe("Unassigned · Manual color");
  up();
  expect(lines()[0].outerHTML).toBe(
    before.replace(`data-legend-id="${wallId}"`, 'data-legend-id=""'),
  );
  expect(lines()[3].getAttribute("data-legend-id")).toBe("");
  expect(lines()[1].getAttribute("data-legend-id")).toBe(doorId);
  click("Select legend Doors");
  click("Delete legend Doors");
  expect(lines()).toHaveLength(4);
  expect(
    lines().every((line) => line.getAttribute("data-legend-id") === ""),
  ).toBe(true);
  expect(screen.getByText(/No legends yet/)).toBeTruthy();
});

it("keeps Space editable in create and rename fields and available for button activation", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole("button", { name: "Legends (0)" }));
  const input = screen.getByLabelText("Legend name");
  const host = screen.getByRole("region", { name: "PDF pages" });
  expect(fireEvent.keyDown(input, { code: "Space" })).toBe(true);
  expect(host.className).not.toContain("can-pan");
  fireEvent.click(screen.getByRole("button", { name: "Legend color Blue" }));
  fireEvent.change(input, { target: { value: "Wall area" } });
  fireEvent.click(screen.getByRole("button", { name: "Create legend" }));
  expect(
    screen
      .getByRole("button", { name: "Blue", exact: true })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("button", { name: "Rename legend Wall area" }),
  );
  expect(fireEvent.keyDown(input, { code: "Space" })).toBe(true);
  expect(host.className).not.toContain("can-pan");
  const button = screen.getByRole("button", {
    name: "Select legend Wall area",
  });
  expect(fireEvent.keyDown(button, { code: "Space" })).toBe(true);
  expect(host.className).not.toContain("can-pan");
  fireEvent.keyUp(button, { code: "Space" });
  expect(host.className).not.toContain("can-pan");
});

it("standalone history records one Shift/freehand stroke, restores IDs, and preserves Space pan", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const svg = screen.getByLabelText("Highlights for page 1");
  Object.defineProperty(svg, "getBoundingClientRect", {
    value: () => rect(0, 0, 600, 800),
  });
  const pointer = (type: string, x: number, shiftKey = false) =>
    fireEvent(
      svg,
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: 100,
        shiftKey,
      }),
    );
  pointer("pointerdown", 40);
  for (let x = 45; x < 100; x += 5) pointer("pointermove", x, x > 60);
  pointer("pointerup", 100, true);
  const id = svg
    .querySelector("[data-annotation-id]")
    ?.getAttribute("data-annotation-id");
  expect(id).toBeTruthy();
  fireEvent.keyDown(window, { key: "z", ctrlKey: true });
  expect(svg.querySelector("[data-annotation-id]")).toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Undo", exact: true })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
  expect(
    svg
      .querySelector("[data-annotation-id]")
      ?.getAttribute("data-annotation-id"),
  ).toBe(id);
  const toolbar = screen.getByRole("region", {
    name: "PDF pages",
    exact: true,
  });
  fireEvent.keyDown(toolbar, { key: " ", code: "Space" });
  expect(screen.getByLabelText("PDF pages").className).toContain("can-pan");
  fireEvent.keyUp(window, { key: " ", code: "Space" });
});

it("bounds raster resources while navigating many pages and retains offscreen layout", () => {
  const pages = Array.from({ length: 100 }, (_, i) => page(i + 1));
  const view = render(<PdfNavigationView pages={pages} />);
  expect(view.container.querySelectorAll("[data-page]")).toHaveLength(100);
  expect(view.container.querySelectorAll("canvas").length).toBeLessThanOrEqual(
    8,
  );
  const first = screen.getByLabelText("PDF page 1") as HTMLCanvasElement;
  const input = screen.getByLabelText("Page number");
  fireEvent.change(input, { target: { value: "100" } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByLabelText("PDF page 100")).toBeTruthy();
  expect(screen.queryByLabelText("PDF page 1")).toBeNull();
  expect(first.width).toBe(0);
  expect(first.height).toBe(0);
  expect(
    view.container
      .querySelector('[data-page="1"] .page-surface')
      ?.getAttribute("style"),
  ).toContain("height:");
  expect(view.container.querySelectorAll("canvas").length).toBeLessThanOrEqual(
    8,
  );
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.submit(input.closest("form")!);
  expect(screen.getByLabelText("PDF page 1")).not.toBe(first);
  const finalCanvas = screen.getByLabelText("PDF page 1") as HTMLCanvasElement;
  view.unmount();
  expect(finalCanvas.width).toBe(0);
});

it.each(["Escape", "blur", "tool", "panel", "preference"])(
  "Hand pans without annotation/history changes and releases capture on %s",
  (reason) => {
    const view = render(<PdfNavigationView pages={[page(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Hand / Pan" }));
    const host = screen.getByRole("region", { name: "PDF pages" });
    const svg = screen.getByLabelText("Highlights for page 1");
    fireEvent.pointerDown(svg, {
      pointerId: 7,
      button: 0,
      clientX: 300,
      clientY: 300,
    });
    fireEvent.pointerMove(host, {
      pointerId: 7,
      buttons: 1,
      clientX: 250,
      clientY: 220,
    });
    expect([host.scrollLeft, host.scrollTop]).toEqual([50, 80]);
    expect(captured).toBe(7);
    if (reason === "Escape") fireEvent.keyDown(host, { key: "Escape" });
    if (reason === "blur") fireEvent.blur(window);
    if (reason === "tool")
      fireEvent.click(
        screen.getByRole("button", { name: "Highlight", exact: true }),
      );
    if (reason === "panel")
      fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    if (reason === "preference")
      view.rerender(<PdfNavigationView pages={[page(1)]} largerControls />);
    expect(captured).toBeNull();
    fireEvent.pointerUp(svg, { pointerId: 7 });
    expect(svg.querySelector("[data-annotation-id]")).toBeNull();
    if (reason === "panel")
      fireEvent.click(
        screen.getByRole("button", { name: "Properties", exact: true }),
      );
    expect(
      screen
        .getByRole("button", { name: "Undo", exact: true })
        .hasAttribute("disabled"),
    ).toBe(true);
  },
);

it("closes the panel with Escape, restores its trigger focus, and reopens without trapping focus", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const panel = screen.getByRole("complementary", {
    name: "Tools and properties",
  });
  panel.focus();
  fireEvent.keyDown(panel, { key: "Escape" });
  const trigger = screen.getByRole("button", {
    name: "Properties",
    exact: true,
  });
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(panel);
  screen.getByRole("region", { name: "PDF pages" }).focus();
  expect(document.activeElement).not.toBe(panel);
});

it.each(["panel", "preference", "hand"])(
  "cancels unfinished highlights on %s without creating history",
  (reason) => {
    const view = render(<PdfNavigationView pages={[page(1)]} />);
    const svg = screen.getByLabelText("Highlights for page 1");
    Object.defineProperty(svg, "getBoundingClientRect", {
      value: () => rect(0, 0, 600, 800),
    });
    fireEvent.pointerDown(svg, {
      pointerId: 7,
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    fireEvent.pointerMove(svg, {
      pointerId: 7,
      buttons: 1,
      clientX: 100,
      clientY: 100,
    });
    expect(captured).toBe(7);
    if (reason === "panel")
      fireEvent.click(screen.getByRole("button", { name: "Close panel" }));
    if (reason === "hand")
      fireEvent.click(screen.getByRole("button", { name: "Hand / Pan" }));
    if (reason === "preference")
      view.rerender(<PdfNavigationView pages={[page(1)]} largerControls />);
    expect(captured).toBeNull();
    fireEvent.pointerUp(svg, { pointerId: 7 });
    expect(svg.querySelector("[data-annotation-id]")).toBeNull();
    if (reason === "panel")
      fireEvent.click(
        screen.getByRole("button", { name: "Properties", exact: true }),
      );
    expect(
      screen
        .getByRole("button", { name: "Undo", exact: true })
        .hasAttribute("disabled"),
    ).toBe(true);
  },
);

it("releases Space capture when switching between annotation tools", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const host = screen.getByRole("region", { name: "PDF pages" });
  fireEvent.keyDown(host, { code: "Space" });
  fireEvent.pointerDown(host, {
    pointerId: 7,
    button: 0,
    clientX: 300,
    clientY: 300,
  });
  expect(captured).toBe(7);
  fireEvent.click(screen.getByRole("button", { name: "Text", exact: true }));
  expect(captured).toBeNull();
  expect(host.className).not.toContain("can-pan");
});

it("closes a narrow drawer on a drawing tool choice and moves focus to the plan", () => {
  vi.stubGlobal("innerWidth", 420);
  render(<PdfNavigationView pages={[page(1)]} />);
  fireEvent.click(screen.getByRole("button", { name: "Text", exact: true }));
  expect(
    screen
      .getByRole("button", { name: "Properties", exact: true })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(document.activeElement).toBe(
    screen.getByRole("region", { name: "PDF pages" }),
  );
});

it("returns sliders and numeric fields to repeated Space panning while protecting actual text entry", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const host = screen.getByRole("region", { name: "PDF pages" }),
    slider = screen.getByLabelText("Highlight width slider");
  slider.focus();
  fireEvent.change(slider, { target: { value: "80" } });
  fireEvent.pointerUp(slider);
  expect(document.activeElement).toBe(host);
  expect(
    (screen.getByLabelText("Highlight width") as HTMLInputElement).value,
  ).toBe("80");
  for (const input of [
    slider,
    screen.getByLabelText("Highlight width"),
    screen.getByLabelText("Page number"),
  ]) {
    for (let i = 0; i < 2; i++) {
      input.focus();
      expect(fireEvent.keyDown(input, { key: " ", code: "Space" })).toBe(false);
      expect(document.activeElement).toBe(host);
      expect(host.className).toContain("can-pan");
      fireEvent.keyUp(host, { code: "Space" });
      expect(host.className).not.toContain("can-pan");
    }
  }
  fireEvent.click(screen.getByRole("button", { name: "Legends (0)" }));
  const text = screen.getByLabelText("Legend name");
  text.focus();
  expect(fireEvent.keyDown(text, { key: " ", code: "Space" })).toBe(true);
  expect(document.activeElement).toBe(text);
  expect(host.className).not.toContain("can-pan");
});

it("handles Space key values when the physical key code is unavailable", () => {
  render(<PdfNavigationView pages={[page(1)]} />);
  const host = screen.getByRole("region", { name: "PDF pages" }),
    input = screen.getByLabelText("Highlight width");
  input.focus();
  expect(fireEvent.keyDown(input, { key: " ", code: "Unidentified" })).toBe(
    false,
  );
  expect(document.activeElement).toBe(host);
  expect(host.className).toContain("can-pan");
  expect(fireEvent.keyUp(host, { key: " ", code: "Unidentified" })).toBe(false);
  expect(host.className).not.toContain("can-pan");
});

it("accepts only digits in page entry, restores abandoned edits, and yields focus on Enter or drawing", () => {
  render(<PdfNavigationView pages={[page(1), page(2), page(3)]} />);
  const input = screen.getByLabelText("Page number") as HTMLInputElement,
    host = screen.getByRole("region", { name: "PDF pages" });
  input.focus();
  for (const value of ["letters", "1 2", "1.5", "-2"]) {
    fireEvent.change(input, { target: { value } });
    expect(input.value).toBe("1");
  }
  expect(fireEvent.keyDown(input, { key: "a" })).toBe(false);
  fireEvent.change(input, { target: { value: "2" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("2");
  expect(document.activeElement).toBe(host);
  input.focus();
  fireEvent.change(input, { target: { value: "999" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("2");
  expect(document.activeElement).toBe(host);
  input.focus();
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("2");
  expect(document.activeElement).toBe(host);
  input.focus();
  fireEvent.change(input, { target: { value: "1" } });
  fireEvent.pointerDown(screen.getByLabelText("PDF page 2"), {
    button: 0,
    pointerId: 11,
  });
  expect(document.activeElement).toBe(host);
  expect(input.value).toBe("2");
  expect(document.querySelector("#pan-hint")).toBeNull();
});

it("nudges selected highlights instead of scrolling, respects Shift steps and input editing, and records Undo", () => {
  const stroke = {
    id: "nudge",
    page: 1,
    type: "freehand" as const,
    legendId: null,
    color: "#facc15",
    opacity: 0.4,
    width: 10,
    points: [
      { x: 20, y: 700 },
      { x: 100, y: 700 },
    ],
  };
  const history = new SessionHistory({
    ...emptySession,
    annotations: [stroke],
  });
  render(<PdfNavigationView pages={[page(1)]} history={history} />);
  fireEvent.click(screen.getByRole("button", { name: "Select/Edit" }));
  fireEvent.change(screen.getByLabelText("Selected stroke"), {
    target: { value: "nudge" },
  });
  const host = screen.getByRole("region", { name: "PDF pages" });
  host.focus();
  expect(fireEvent.keyDown(host, { key: "ArrowRight" })).toBe(false);
  expect(history.present.annotations[0].points[0]).toEqual({ x: 22, y: 700 });
  expect(fireEvent.keyDown(host, { key: "ArrowUp", shiftKey: true })).toBe(
    false,
  );
  expect(history.present.annotations[0].points[0]).toEqual({ x: 22, y: 710 });
  expect(host.scrollTop).toBe(0);
  const input = screen.getByLabelText("Selected stroke width");
  input.focus();
  expect(fireEvent.keyDown(input, { key: "ArrowDown" })).toBe(true);
  expect(history.present.annotations[0].points[0].y).toBe(710);
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(history.present.annotations[0].points[0]).toEqual({ x: 22, y: 700 });
});

it("brings an offscreen Undo change into view and marks removed objects on Redo", () => {
  const stroke = {
    id: "offscreen",
    page: 2,
    type: "freehand" as const,
    legendId: null,
    color: "#facc15",
    opacity: 0.4,
    width: 10,
    points: [
      { x: 20, y: 600 },
      { x: 100, y: 600 },
    ],
  };
  const history = new SessionHistory({
    ...emptySession,
    annotations: [stroke],
  });
  history.apply({ type: "remove-stroke", id: stroke.id });
  render(<PdfNavigationView pages={[page(1), page(2)]} history={history} />);
  fireEvent.click(screen.getByRole("button", { name: "Undo", exact: true }));
  expect(screen.getByText("Undid Delete highlight · Page 2")).toBeTruthy();
  expect(
    screen.getByRole("region", { name: "PDF pages" }).scrollTop,
  ).toBeGreaterThan(0);
  expect(
    document.querySelector('[data-page="2"] .history-change-overlay rect'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Redo", exact: true }));
  expect(screen.getByText("Redid Delete highlight · Page 2")).toBeTruthy();
  expect(
    screen
      .getByLabelText("Highlights for page 2")
      .querySelector("[data-annotation-id]"),
  ).toBeNull();
  expect(
    document.querySelector('[data-page="2"] .history-change-overlay rect'),
  ).toBeTruthy();
});
