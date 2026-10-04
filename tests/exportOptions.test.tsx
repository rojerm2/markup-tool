import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ExportOptions from "../src/components/Toolbar/ExportOptions";
import { emptySession } from "../src/services/annotationSession";
const session = {
  ...emptySession,
  legends: [
    { id: "walls", name: "Walls", color: "#ff0000" },
    {
      id: "hidden",
      name: "Furniture",
      color: "#00ff00",
      hidden: true,
      locked: true,
    },
  ],
  annotations: [
    {
      id: "a",
      type: "freehand" as const,
      page: 2,
      legendId: "hidden",
      color: "#00ff00",
      opacity: 0.4,
      width: 5,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
    },
  ],
};
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
});
afterEach(cleanup);

function setup() {
  const onExport = vi.fn(),
    onClose = vi.fn();
  render(
    <ExportOptions
      session={session}
      pageCount={3}
      currentPage={2}
      onExport={onExport}
      onClose={onClose}
    />,
  );
  return { onExport, onClose };
}
it("keeps defaults, previews hidden inclusion and exports ordered custom pages with exact category choices", () => {
  const { onExport } = setup();
  expect(screen.getByRole("status").textContent).toContain(
    "3 pages · 1 markup item",
  );
  fireEvent.click(screen.getByLabelText("Include hidden categories"));
  expect(screen.getByRole("status").textContent).toContain("0 markup items");
  fireEvent.click(screen.getByLabelText("Include hidden categories"));
  fireEvent.click(screen.getByLabelText("Custom pages"));
  fireEvent.change(screen.getByLabelText("Page numbers and ranges"), {
    target: { value: "3, 2" },
  });
  fireEvent.click(screen.getByLabelText("All categories"));
  fireEvent.click(screen.getByLabelText("Walls"));
  fireEvent.click(screen.getByLabelText("Include unassigned markup"));
  fireEvent.change(screen.getByLabelText("Output"), {
    target: { value: "csv-report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export", exact: true }));
  expect(onExport).toHaveBeenCalledWith(
    {
      pages: [2, 3],
      categoryIds: ["hidden"],
      includeHidden: true,
      includeUnassigned: false,
    },
    "csv-report",
  );
  expect(session.annotations).toHaveLength(1);
});
it("rejects invalid pages before exporting and routes selected print separately", () => {
  const { onExport, onClose } = setup();
  fireEvent.click(screen.getByLabelText("Custom pages"));
  fireEvent.change(screen.getByLabelText("Page numbers and ranges"), {
    target: { value: "4" },
  });
  expect(screen.getByRole("alert").textContent).toContain("between 1 and 3");
  expect(
    (
      screen.getByRole("button", {
        name: "Export",
        exact: true,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(onExport).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Current page (2)"));
  fireEvent.change(screen.getByLabelText("Output"), {
    target: { value: "print" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Prepare print" }));
  expect(onExport).toHaveBeenCalledWith(
    expect.objectContaining({ pages: [2], categoryIds: null }),
    "print",
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
});
