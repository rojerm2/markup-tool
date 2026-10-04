import { expect, it } from "vitest";
import { checkRustAdvisories } from "../scripts/check-rust-advisories.mjs";

const metadata = {
  packages: [{ id: "windows", name: "tauri", version: "2.11.5" }],
  resolve: { nodes: [{ id: "windows" }] },
};
const report = () => ({
  database: { "last-commit": "a".repeat(40), "advisory-count": 1290 },
  vulnerabilities: { count: 0, found: false, list: [] as unknown[] },
  warnings: {},
});
const warning = (name: string, version: string) => ({
  package: { name, version },
  advisory: { id: "RUSTSEC-test" },
});

it("rejects known vulnerabilities and incomplete or inconsistent audit results", () => {
  const value = report();
  value.vulnerabilities = { count: 1, found: true, list: [{}] };
  expect(() => checkRustAdvisories(value, metadata)).toThrow(
    "Known Rust vulnerability",
  );
  expect(() => checkRustAdvisories({}, metadata)).toThrow("database");
  const inconsistent = report();
  inconsistent.vulnerabilities.count = 1;
  expect(() => checkRustAdvisories(inconsistent, metadata)).toThrow(
    "Inconsistent",
  );
  expect(() =>
    checkRustAdvisories(report(), { ...metadata, packages: [] }),
  ).toThrow("Incomplete Windows");
});
it("blocks unsound Windows dependencies while retaining non-Windows and unmaintained findings for review", () => {
  const value = report();
  value.warnings = { unsound: [warning("tauri", "2.11.5")] };
  expect(() => checkRustAdvisories(value, metadata)).toThrow(
    "Unresolved unsound",
  );
  value.warnings = {
    unsound: [warning("glib", "0.18.5")],
    unmaintained: [warning("tauri", "2.11.5")],
  };
  const result = checkRustAdvisories(value, metadata);
  expect(result.warnings).toEqual([
    {
      kind: "unsound",
      id: "RUSTSEC-test",
      package: "glib",
      version: "0.18.5",
      inWindowsGraph: false,
    },
    {
      kind: "unmaintained",
      id: "RUSTSEC-test",
      package: "tauri",
      version: "2.11.5",
      inWindowsGraph: true,
    },
  ]);
  value.warnings = { unsound: [{}] };
  expect(() => checkRustAdvisories(value, metadata)).toThrow(
    "Incomplete advisory",
  );
});
