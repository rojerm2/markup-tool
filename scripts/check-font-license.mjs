import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

// Pin the distributed asset and corresponding upstream source independently.
for (const [path, expected] of [
  [
    "src/assets/LegendSans.ttf",
    "fc977b8f8a736c45ee4126383d0b8a929af7d4f4a9c4a1c974ed5a32387db822",
  ],
  [
    "third_party/fonts/liberation-fonts-1.07.4.tar.gz",
    "ad98b7498dc2992f7f0868f79b65ce4a720a3acdb63ab3f1f1cb6881117a5406",
  ],
]) {
  assert.equal(
    createHash("sha256").update(readFileSync(path)).digest("hex"),
    expected,
    `Font provenance changed: ${path}. Review the asset, source and license together.`,
  );
}
const config = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
for (const path of [
  "../src/assets/LegendSans.LICENSE",
  "../third_party/fonts/README.md",
  "../third_party/fonts/liberation-fonts-1.07.4.tar.gz",
]) {
  assert.ok(
    config.bundle.resources[path],
    `Missing bundled font notice/source: ${path}`,
  );
}
console.log(
  "Font asset, corresponding source and distribution resources verified",
);
