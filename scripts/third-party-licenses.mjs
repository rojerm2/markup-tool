import fs from "node:fs";
import path from "node:path";

const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const notices = [];
for (const [location, info] of Object.entries(lock.packages)) {
  if (
    !location.startsWith("node_modules/") ||
    info.dev ||
    !fs.existsSync(location)
  )
    continue;
  const pkg = JSON.parse(
    fs.readFileSync(path.join(location, "package.json"), "utf8"),
  );
  const licenseFiles = fs
    .readdirSync(location)
    .filter(
      (name) =>
        /^(license|copying)(\..*)?$/i.test(name) &&
        fs.statSync(path.join(location, name)).isFile(),
    );
  notices.push(
    `## ${pkg.name} ${pkg.version}\nDeclared license: ${pkg.license ?? info.license ?? "See upstream package"}\n` +
      licenseFiles
        .map((name) => fs.readFileSync(path.join(location, name), "utf8"))
        .join("\n"),
  );
}
fs.writeFileSync(
  "public/THIRD_PARTY_LICENSES.txt",
  "Third-party JavaScript licenses\n\n" +
    notices.join("\n\n" + "=".repeat(72) + "\n\n"),
);
console.log(
  `Collected notices for ${notices.length} installed runtime packages`,
);
