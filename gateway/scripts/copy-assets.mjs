import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(root, "build", "catalog", "builtin-tools.json");
mkdirSync(dirname(destination), { recursive: true });
cpSync(resolve(root, "src", "catalog", "builtin-tools.json"), destination);
