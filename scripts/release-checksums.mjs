import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const directory = "src-tauri/target/release/bundle/nsis";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const installers = fs
  .readdirSync(directory)
  .filter((name) => name.endsWith(`_${version}_x64-setup.exe`));
if (installers.length !== 1)
  throw new Error(
    "Expected exactly one installer for this Windows x64 release",
  );
const lines = installers.map((name) => {
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
