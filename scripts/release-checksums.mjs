import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const directory = "src-tauri/target/release/bundle/nsis";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
// GitHub normalizes spaces in uploaded filenames. Use one stable filename
// locally and remotely so users can verify checksums without renaming files.
const canonicalName = `pdf-markup-tool_${version}_x64-setup.exe`;
const productName = JSON.parse(
  fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
).productName;
const generatedName = `${productName}_${version}_x64-setup.exe`;
if (fs.existsSync(path.join(directory, generatedName)))
  fs.renameSync(
    path.join(directory, generatedName),
    path.join(directory, canonicalName),
  );
if (!fs.existsSync(path.join(directory, canonicalName)))
  throw new Error("Missing installer for this Windows x64 release");
const lines = [canonicalName].map((name) => {
  const hash = createHash("sha256")
    .update(fs.readFileSync(path.join(directory, name)))
    .digest("hex");
  return `${hash}  ${name}`;
});
fs.writeFileSync(
  path.join(directory, "SHA256SUMS.txt"),
  lines.join("\n") + "\n",
);
console.log(lines.join("\n"));
