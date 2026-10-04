import assert from "node:assert/strict";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** Cargo.lock includes non-Windows dependencies. Retain their warnings, while
 * gating unsound code against the actual Windows graph; never ignore a known
 * vulnerability or silently accept an incomplete advisory response.
 */
export function checkRustAdvisories(audit, metadata) {
  assert.ok(
    audit.database?.["last-commit"],
    "Missing advisory database identity",
  );
  assert.ok(audit.database["advisory-count"] > 0, "Empty advisory database");
  const vulnerabilities = audit.vulnerabilities;
  assert.ok(
    vulnerabilities && Array.isArray(vulnerabilities.list),
    "Incomplete vulnerability report",
  );
  assert.equal(
    vulnerabilities.count,
    vulnerabilities.list.length,
    "Inconsistent vulnerability report",
  );
  assert.equal(
    vulnerabilities.found,
    vulnerabilities.count > 0,
    "Inconsistent vulnerability flag",
  );
  assert.equal(vulnerabilities.count, 0, "Known Rust vulnerability detected");
  assert.ok(
    Array.isArray(metadata.packages) && metadata.resolve?.nodes?.length,
    "Missing Windows dependency graph",
  );
  const selected = new Set(metadata.resolve.nodes.map((node) => node.id));
  const packages = metadata.packages.filter((pkg) => selected.has(pkg.id));
  assert.equal(
    packages.length,
    selected.size,
    "Incomplete Windows dependency graph",
  );
  const warnings = Object.entries(audit.warnings ?? {}).flatMap(
    ([kind, entries]) => {
      assert.ok(Array.isArray(entries), "Malformed advisory warnings");
      return entries.map((warning) => {
        assert.ok(
          warning.package?.name &&
            warning.package.version &&
            warning.advisory?.id,
          "Incomplete advisory warning",
        );
        const inWindowsGraph = packages.some(
          (pkg) =>
            pkg.name === warning.package.name &&
            pkg.version === warning.package.version,
        );
        assert.ok(
          !inWindowsGraph || kind === "unmaintained",
          `Unresolved ${kind} advisory in Windows graph: ${warning.advisory.id}`,
        );
        return {
          kind,
          id: warning.advisory.id,
          package: warning.package.name,
          version: warning.package.version,
          inWindowsGraph,
        };
      });
    },
  );
  return {
    databaseCommit: audit.database["last-commit"],
    windowsPackages: packages.length,
    vulnerabilities: 0,
    warnings,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const read = (file) =>
    JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  console.log(
    JSON.stringify(
      checkRustAdvisories(read(process.argv[2]), read(process.argv[3])),
      null,
      2,
    ),
  );
}
