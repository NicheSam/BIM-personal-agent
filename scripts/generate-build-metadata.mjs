import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(resolve(root, "gateway", "package.json"), "utf8"));
const sourceRoots = ["gateway/src", "gateway/schemas", "console", "scripts", "release", "skills/bim-agent"];
const files = [];
for (const sourceRoot of sourceRoots) await collect(resolve(root, sourceRoot), files);
files.sort((left, right) => left.localeCompare(right));
const hash = createHash("sha256");
for (const file of files) {
  hash.update(relative(root, file).replaceAll("\\", "/"));
  hash.update("\0");
  hash.update(await readFile(file));
  hash.update("\0");
}
const buildHash = hash.digest("hex");
let commitHash;
try {
  commitHash = execFileSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  commitHash = null;
}
const metadata = {
  semanticVersion: packageJson.version,
  buildHash,
  commitHash,
  buildTimeUtc: new Date().toISOString(),
  gatewaySchemaVersion: 3,
  consoleSchemaVersion: 3,
  buildId: `${packageJson.version}-${buildHash.slice(0, 8)}`,
};
const json = `${JSON.stringify(metadata, null, 2)}\n`;
await writeFile(resolve(root, "gateway", "build", "build-metadata.json"), json, "utf8");
await writeFile(resolve(root, "console", "build-metadata.json"), json, "utf8");
process.stdout.write(`${metadata.buildId}\n`);

async function collect(directory, output) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", "build", ".git"].includes(entry.name) || entry.name === "build-metadata.json" || entry.name.endsWith(".test.mjs")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path, output);
    else output.push(path);
  }
}
