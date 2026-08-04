import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateReleaseFeed } from "../src/version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const feed = validateReleaseFeed(JSON.parse(fs.readFileSync(path.join(root, "releases/latest.json"), "utf8")));

if (pkg.version !== feed.version) {
  console.error(`Release drift: package ${pkg.version}, feed ${feed.version}`);
  process.exit(1);
}
if (!feed.release_url.endsWith(`/v${pkg.version}`)) {
  console.error("Release URL does not match the package version");
  process.exit(1);
}
console.log(`Mission Lite release metadata is aligned at ${pkg.version}.`);
