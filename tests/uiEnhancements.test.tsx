import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
import { resizeBox, boxHandles } from "../src/services/resizeBox";
import {
  keyPoint,
  layoutLegend,
  validPageLegend,
  type PageLegend,
} from "../src/services/pageLegend";
import { emptySession } from "../src/services/annotationSession";
import { parseProject, serializeProject } from "../src/services/projectFormat";
import { fitNote, validNote, type TextNote } from "../src/services/notes";
import { generateAnnotatedPdf } from "../src/services/pdfExport";
import AppContextMenu, {
  useAppContextMenu,
} from "../src/components/Toolbar/AppContextMenu";
import FontSizeControl from "../src/components/Annotations/FontSizeControl";

const legends = [{ id: "category", name: "Floor", color: "#facc15" }];
const key: PageLegend = {
  id: "key",
  page: 1,
  x: 30,
  y: 500,
  rotation: 0,
  categoryIds: ["category"],
  title: "LEGEND",
  layout: "list",
  width: 240,
  fontSize: 12,
  background: true,
  border: true,
};
const source = {
  filename: "plan.pdf",
  reference: "plan.pdf",
  size: 100,
  sha256: "a".repeat(64),
  pages: 1,
};
describe("resizable text boxes and continuous text sizing", () => {
  it.each([0, 90, 180, 270] as const)(
    "keeps the opposite corner anchored at rotation %s",
    (rotation) => {
      const before = { ...key, rotation, height: 120 };
      const oldCorner = keyPoint(before, before.width, before.height);
      const resized = resizeBox(before, "nw", { x: 10, y: 15 }, 100, () => 30);
      expect(keyPoint(resized, resized.width, resized.height)).toEqual(
        oldCorner,
      );
      expect(boxHandles(resized.width, resized.height)).toHaveLength(8);
    },
  );
  it("reflows legends without shrinking below their text and preserves optional height", () => {
    const before = { ...key, height: 200 };
    const resized = resizeBox(
      before,
      "se",
      { x: -120, y: 1000 },
      100,
      (width) => layoutLegend({ ...key, width }, legends).height,
    );
    expect(resized.height).toBeGreaterThanOrEqual(
      layoutLegend({ ...key, width: resized.width }, legends).height,
    );
    const session = {
      ...emptySession,
      legends,
      pageLegends: [{ ...key, height: 300, fontSize: 47.5 }],
    };
    expect(
      parseProject(serializeProject(source, session)).session.pageLegends,
    ).toEqual(session.pageLegends);
  });
  it.each([1, 7.5, 48, 200])(
    "accepts %s pt in notes and legends and rejects out-of-range values",
    (fontSize) => {
      expect(validPageLegend({ ...key, fontSize }, legends)).toBe(true);
      const n = fitNote({
        id: "note",
        type: "text",
        page: 1,
        x: 20,
        y: 400,
        rotation: 0,
        width: 500,
        height: 30,
        fontSize,
        color: "#a87951",
        text: "Text",
        pointers: [],
        border: true,
        background: true,
      } as TextNote);
      expect(validNote(n)).toBe(true);
      expect(validNote({ ...n, fontSize: 201 })).toBe(false);
      expect(validPageLegend({ ...key, fontSize: 0 }, legends)).toBe(false);
    },
  );
  it("exports a resized legend and arbitrary font size without changing the source page", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([600, 800]);
    const bytes = await generateAnnotatedPdf(
      await pdf.save(),
      {
        ...emptySession,
        legends,
        pageLegends: [{ ...key, height: 300, fontSize: 47.5 }],
      },
      new Uint8Array(readFileSync("src/assets/LegendSans.ttf")),
    );
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
    expect(reopened.getPage(0).getSize()).toEqual({ width: 600, height: 800 });
    expect(reopened.getPage(0).node.Resources()?.toString()).toContain("Font");
  });
  it("lets users enter fractional values and slide over the full size range", () => {
    let size = 12;
    render(
      <FontSizeControl
        label="Font size"
        value={size}
        onChange={(value) => {
          size = value;
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Font size"), {
      target: { value: "64.5" },
    });
    expect(size).toBe(64.5);
    fireEvent.change(screen.getByLabelText("Font size slider"), {
      target: { value: "200" },
    });
    expect(size).toBe(200);
  });
});
it("replaces right-click with an accessible app menu and supports keyboard dismissal", () => {
  let actions = 0;

  function Surface() {
    const open = useAppContextMenu();
    return (
      <div
        onContextMenu={(e) =>
          open(e, [
            { label: "Highlight", action: () => actions++ },
            { label: "Print", disabled: true, action: () => actions++ },
          ])
        }
      >
        Page
      </div>
    );
  }
  render(
    <AppContextMenu>
      <Surface />
    </AppContextMenu>,
  );
  fireEvent.contextMenu(screen.getByText("Page"), { clientX: 40, clientY: 40 });
  expect(
    (screen.getByRole("menuitem", { name: "Print" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("menuitem", { name: "Highlight" }));
  expect(actions).toBe(1);
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.contextMenu(screen.getByText("Page"));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
});
