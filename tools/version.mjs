// Run by `npm version` (the "version" script): copies the new package.json version into the app manifest, which the
// release workflow checks against the tag.
import { readFileSync, writeFileSync } from "node:fs";

const file = new URL("../src/appmeta/manifest.json", import.meta.url);
const manifest = JSON.parse(readFileSync(file, "utf8"));
manifest.version = process.env.npm_package_version;
writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
