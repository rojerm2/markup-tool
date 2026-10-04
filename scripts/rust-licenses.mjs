import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--locked",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
      "--format-version",
      "1",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ),
);
const notices = [];
const selected = new Set(metadata.resolve.nodes.map((node) => node.id));
for (const pkg of metadata.packages) {
  if (!pkg.source || !selected.has(pkg.id)) continue;
  const directory = path.dirname(pkg.manifest_path);
  const candidates = fs
    .readdirSync(directory)
    .filter(
      (name) =>
        /^(license|copying)([-_.].*)?$/i.test(name) &&
        fs.statSync(path.join(directory, name)).isFile(),
    );
  if (pkg.license_file && !candidates.includes(pkg.license_file))
    candidates.push(pkg.license_file);
  notices.push(
    `## ${pkg.name} ${pkg.version}\nDeclared license: ${pkg.license ?? "See upstream crate"}\n${pkg.repository ?? ""}\n` +
      candidates
        .map((name) => fs.readFileSync(path.join(directory, name), "utf8"))
        .join("\n"),
  );
}
fs.writeFileSync(
  "public/RUST_LICENSES.txt",
  "Third-party Rust licenses (locked Windows graph, including build dependencies)\n\n" +
    notices.join("\n\n" + "=".repeat(72) + "\n\n"),
);
console.log(`Collected notices for ${notices.length} Rust packages`);
