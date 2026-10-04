import fs from "node:fs";
import assert from "node:assert/strict";

const json = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const pkg = json("package.json");
const lock = json("package-lock.json");
const tauri = json("src-tauri/tauri.conf.json");
const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoLock = fs.readFileSync("src-tauri/Cargo.lock", "utf8");
const version = pkg.version;
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(lock.version, version);
assert.equal(lock.packages[""].version, version);
assert.equal(tauri.version, version);
assert.equal(cargo.match(/^version = "([^"]+)"/m)?.[1], version);
const appLock = cargoLock
  .split("[[package]]")
  .find((section) => /^\s*name = "pdf-markup-tool"/.test(section));
assert.equal(appLock?.match(/version = "([^"]+)"/)?.[1], version);
assert.equal(tauri.identifier, "com.orcific.pdf-markup-tool");
assert.equal(pkg.license, "MIT");
assert.equal(tauri.bundle.targets.includes("nsis"), true);
assert.equal(
  tauri.bundle.resources["../third_party/nsis/COPYING"],
  "licenses/NSIS_COPYING",
  "NSIS upstream license must accompany the installer",
);
assert.ok(tauri.app.security.csp);
assert.ok(!tauri.app.security.csp.includes("'unsafe-eval'"));
const tag =
  process.env.GITHUB_REF_TYPE === "tag"
    ? process.env.GITHUB_REF_NAME
    : process.argv[2];
if (tag)
  assert.equal(tag, `v${version}`, "Release tag must match the app version");
for (const file of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "third_party/nsis/COPYING",
  `docs/releases/v${version}.md`,
]) {
  assert.ok(fs.existsSync(file), `Missing release file: ${file}`);
}
console.log(`Release metadata verified: v${version}`);
