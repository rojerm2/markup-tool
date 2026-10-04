import { beforeEach, expect, it } from "vitest";
import {
  defaultNavigation,
  navigationKey,
  parseNavigation,
  readNavigation,
  writeNavigation,
} from "../src/services/documentNavigation";
import { parseProject, serializeProject } from "../src/services/projectFormat";
import { emptySession } from "../src/services/annotationSession";

const source = {
  filename: "plan.pdf",
  reference: "C:/plan.pdf",
  size: 100,
  sha256: "a".repeat(64),
  pages: 32,
};
beforeEach(() => localStorage.clear());
it("preserves bookmarks and PDF-space view coordinates without changing annotations", () => {
  const navigation = {
    bookmarks: [{ page: 32, label: "Level 8 – HVAC" }],
    view: {
      page: 32,
      mode: "manual" as const,
      zoom: 12,
      center: { x: -140, y: 7500 },
    },
  };
  const project = parseProject(
    serializeProject(source, emptySession, navigation),
  );
  expect(project.navigation).toEqual(navigation);
  expect(project.session).toEqual(emptySession);
  expect(
    parseProject(serializeProject(source, emptySession)).navigation,
  ).toBeUndefined();
});
it("rejects invalid ranges, duplicate pages and malformed metadata before loading a project", () => {
  const navigation = defaultNavigation();
  for (const bad of [
    { ...navigation, view: { ...navigation.view, page: 33 } },
    { ...navigation, view: { ...navigation.view, zoom: 32.1 } },
    { ...navigation, view: { ...navigation.view, center: null } },
    { ...navigation, view: { ...navigation.view, center: { x: "12", y: 3 } } },
    {
      ...navigation,
      bookmarks: [
        { page: 1, label: "a" },
        { page: 1, label: "b" },
      ],
    },
    { ...navigation, bookmarks: [{ page: 0, label: "a" }] },
    { ...navigation, bookmarks: [{ page: 1, label: "hidden\u0000control" }] },
  ]) {
    expect(() =>
      parseProject(
        JSON.stringify({
          format: "pdf-markup-project",
          version: 2,
          source,
          session: emptySession,
          navigation: bad,
        }),
      ),
    ).toThrow("document navigation");
  }
  expect(() =>
    parseNavigation(
      { ...navigation, view: { ...navigation.view, zoom: NaN } },
      32,
    ),
  ).toThrow();
});
it("restores recent views separately per project and bounds local retention", () => {
  for (let page = 1; page <= 15; page++)
    writeNavigation(
      `project-${page}`,
      { bookmarks: [], view: { page, mode: "width", zoom: 1 } },
      32,
    );
  expect(readNavigation("project-1", 32)).toBeNull();
  expect(readNavigation("project-15", 32)?.view.page).toBe(15);
  expect(readNavigation("project-15", 2)).toBeNull();
  const a = navigationKey(source.sha256, "C:\\plans\\One.pmarkup");
  const b = navigationKey(source.sha256, "c:/plans/one.pmarkup");
  expect(a).toBe(b);
  expect(a).not.toBe(navigationKey(source.sha256, "C:/plans/two.pmarkup"));
  expect(navigationKey(source.sha256, "/One.pmarkup")).not.toBe(
    navigationKey(source.sha256, "/one.pmarkup"),
  );
});
it("ignores corrupt local state and keeps validated portable data usable", () => {
  localStorage.setItem("pdf-markup.navigation", "invalid JSON");
  expect(readNavigation("x", 32)).toBeNull();
  const portable = parseNavigation(defaultNavigation(), 32);
  expect(portable.view.page).toBe(1);
  writeNavigation("x", portable, 32);
  expect(readNavigation("x", 32)).toEqual(portable);
});
