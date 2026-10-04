import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PDFPageProxy } from "pdfjs-dist";
import DocumentPanel from "../src/components/PdfViewer/DocumentPanel";
import { emptySession } from "../src/services/annotationSession";
import { TEXT_DEFAULTS } from "../src/services/notes";

function page(pageNumber: number) {
  return {
    pageNumber,
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 800 * scale,
      convertToViewportPoint: (x: number, y: number) => [
        x * scale,
        (800 - y) * scale,
      ],
    }),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  } as unknown as PDFPageProxy;
}
beforeEach(() =>
  vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockReturnValue({} as CanvasRenderingContext2D),
);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("bounds thumbnail canvases and cancels replaced renders for a 10,000-page document", () => {
  const pages = Array.from({ length: 10000 }, (_, i) => page(i + 1));
  const navigate = vi.fn();
  const view = render(
    <DocumentPanel
      pages={pages}
      current={1}
      session={emptySession}
      bookmarks={[]}
      disabled={false}
      close={vi.fn()}
      navigate={navigate}
      changeBookmarks={vi.fn()}
      reveal={vi.fn()}
    />,
  );
  expect(view.container.querySelectorAll("canvas")).toHaveLength(8);
  for (const canvas of view.container.querySelectorAll("canvas")) {
    expect(canvas.width).toBeLessThanOrEqual(300);
    expect(canvas.height).toBeLessThanOrEqual(300);
  }
  const task = vi.mocked(pages[0].render).mock.results[0].value;
  const list = screen.getByLabelText("Page thumbnails");
  list.scrollTop = 5000 * 224;
  fireEvent.scroll(list);
  expect(task.cancel).toHaveBeenCalledOnce();
  expect(view.container.querySelectorAll("canvas")).toHaveLength(8);
  expect(pages[9999].render).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Go to page 5000", exact: true }),
  );
  expect(navigate).toHaveBeenCalledWith(5000);
});

it("adds, jumps to and removes labeled bookmarks with keyboard-accessible tabs", () => {
  const changeBookmarks = vi.fn(),
    navigate = vi.fn();
  const props = {
    pages: [page(1), page(2)],
    current: 2,
    session: emptySession,
    disabled: false,
    close: vi.fn(),
    navigate,
    changeBookmarks,
    reveal: vi.fn(),
  };
  const view = render(<DocumentPanel {...props} bookmarks={[]} />);
  fireEvent.keyDown(screen.getByRole("tab", { name: "Pages" }), {
    key: "ArrowRight",
  });
  expect(document.activeElement).toBe(
    screen.getByRole("tab", { name: "Bookmarks" }),
  );
  fireEvent.change(screen.getByLabelText("Bookmark label"), {
    target: { value: "  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Bookmark this page" }));
  expect(screen.getByRole("alert").textContent).toContain("Enter a label");
  expect(changeBookmarks).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Bookmark label"), {
    target: { value: "  Ground floor  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Bookmark this page" }));
  expect(changeBookmarks).toHaveBeenLastCalledWith([
    { page: 2, label: "Ground floor" },
  ]);
  view.rerender(
    <DocumentPanel
      {...props}
      bookmarks={[{ page: 2, label: "Ground floor" }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Ground floor Page 2" }));
  expect(navigate).toHaveBeenCalledWith(2);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove bookmark Ground floor" }),
  );
  expect(changeBookmarks).toHaveBeenLastCalledWith([]);
});

it("paginates markup results, combines filters and reveals the correct PDF-space target", () => {
  const notes = Array.from({ length: 65 }, (_, i) => ({
    ...TEXT_DEFAULTS,
    id: `n${i}`,
    type: "text" as const,
    page: i === 64 ? 2 : 1,
    x: 10,
    y: 20,
    width: 100,
    height: 40,
    rotation: 0,
    text: `Check room ${i}`,
  }));
  const reveal = vi.fn();
  render(
    <DocumentPanel
      pages={[page(1), page(2)]}
      current={1}
      session={{ ...emptySession, notes }}
      bookmarks={[]}
      disabled={false}
      close={vi.fn()}
      navigate={vi.fn()}
      changeBookmarks={vi.fn()}
      reveal={reveal}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Markups" }));
  expect(screen.getByRole("status").textContent).toBe("65 markups");
  expect(document.querySelectorAll(".markup-jump")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button", { name: "Next results" }));
  expect(document.querySelectorAll(".markup-jump")).toHaveLength(15);
  fireEvent.change(screen.getByLabelText("Search markups"), {
    target: { value: "room 64" },
  });
  fireEvent.change(screen.getByLabelText("Markup type filter"), {
    target: { value: "text" },
  });
  fireEvent.change(screen.getByLabelText("Markup category filter"), {
    target: { value: "unassigned" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Check room 64 · Page 2 · Unassigned" }),
  );
  expect(reveal).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "n64",
      page: 2,
      type: "text",
      center: { x: 60, y: 0 },
    }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Current page only" }));
  expect(screen.getByRole("status").textContent).toBe("0 markups");
});
