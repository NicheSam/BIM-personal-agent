import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface BuildMetadata {
  semanticVersion: string;
  buildHash: string;
  commitHash: string | null;
  buildTimeUtc: string;
  gatewaySchemaVersion: number;
  consoleSchemaVersion: number;
  buildId: string;
}

export function getBuildMetadata(): BuildMetadata {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "build-metadata.json"), "utf8")) as BuildMetadata;
  } catch {
    return {
      semanticVersion: "0.8.0",
      buildHash: "development",
      commitHash: null,
      buildTimeUtc: "development",
      gatewaySchemaVersion: 3,
      consoleSchemaVersion: 3,
      buildId: "0.8.0-development",
    };
  }
}
