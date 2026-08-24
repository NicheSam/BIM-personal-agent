import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const lockPath = resolve(projectRoot, args.lock || "config/upstream-lock.json");
const lock = JSON.parse(await readFile(lockPath, "utf8"));
const baseline = await verifyBaseline(lock);
if (args.baselineOnly) {
  process.stdout.write(`${JSON.stringify({ baseline }, null, 2)}\n`);
  process.exit(0);
}

const upstreamRoot = resolveUpstreamRoot(args.upstream);
const ref = args.ref || lock.syncPolicy.auditRef || "origin/main";
const upstream = inspectUpstream(upstreamRoot, ref);
const catalogPath = resolve(projectRoot, lock.integration.catalogPath);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
const agentTools = [...new Set(catalog.map((tool) => tool.name))].sort();
const agentOwned = new Set(lock.integration.agentOwnedTools || []);
const expectedUpstreamTools = agentTools.filter((name) => !agentOwned.has(name));
const upstreamOnly = upstream.tools.filter((name) => !agentTools.includes(name));
const agentOnly = agentTools.filter((name) => !upstream.tools.includes(name));
const overlap = agentTools.filter((name) => upstream.tools.includes(name));

const result = {
  generatedAt: new Date().toISOString(),
  baseline,
  upstream: {
    repository: lock.upstream.repository,
    root: upstreamRoot,
    ref,
    commit: upstream.commit,
    commitDate: upstream.commitDate,
    subject: upstream.subject,
    toolCount: upstream.tools.length
  },
  agent: {
    internalToolCount: agentTools.length,
    expectedUpstreamToolCount: expectedUpstreamTools.length,
    agentOwnedTools: [...agentOwned].sort()
  },
  comparison: {
    exactNameOverlap: overlap.length,
    upstreamOnly,
    agentOnly
  },
  note: "Name-level audit only. Runtime implementation and schema parity require build and Revit smoke tests."
};

if (args.writeReport) {
  const reportPath = resolve(projectRoot, args.writeReport);
  await writeFile(reportPath, renderMarkdown(result), "utf8");
  result.reportPath = reportPath;
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) {
      throw new Error(`Unexpected argument: ${value}`);
    }
    const key = value.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function resolveUpstreamRoot(explicitRoot) {
  const candidates = [
    explicitRoot,
    process.env.REVIT_MCP_UPSTREAM_ROOT,
    resolve(projectRoot, "..", "REVIT_MCP_latest"),
    resolve(projectRoot, "..", "REVIT MCP")
  ].filter(Boolean);
  const root = candidates.find((candidate) => existsSync(resolve(candidate, ".git")));
  if (!root) {
    throw new Error("REVIT_MCP_study checkout not found. Pass --upstream <path> or set REVIT_MCP_UPSTREAM_ROOT.");
  }
  return resolve(root);
}

function git(root, values) {
  const safeRoot = root.replaceAll("\\", "/");
  return execFileSync("git", ["-c", `safe.directory=${safeRoot}`, "-C", root, ...values], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function inspectUpstream(root, targetRef) {
  const commit = git(root, ["rev-parse", targetRef]);
  const metadata = git(root, ["show", "-s", "--format=%cI%n%s", commit]).split(/\r?\n/);
  const paths = git(root, ["ls-tree", "-r", "--name-only", commit, "--", "MCP-Server/src/tools"])
    .split(/\r?\n/)
    .filter((path) => path.endsWith(".ts"));
  const names = new Set();
  const declarationPattern = /\bname\s*:\s*["'`]([^"'`]+)["'`]/g;
  for (const path of paths) {
    const source = git(root, ["show", `${commit}:${path}`]);
    for (const match of source.matchAll(declarationPattern)) {
      names.add(match[1]);
    }
  }
  return {
    commit,
    commitDate: metadata[0] || "",
    subject: metadata.slice(1).join(" "),
    tools: [...names].sort()
  };
}

async function verifyBaseline(currentLock) {
  const vendoredRoot = resolve(projectRoot, currentLock.integration.vendoredSourceRoot);
  const catalogPath = resolve(projectRoot, currentLock.integration.catalogPath);
  const vendoredTreeSha256 = await hashTree(vendoredRoot);
  const catalogSha256 = await hashFile(catalogPath);
  const valid = vendoredTreeSha256 === currentLock.integration.vendoredTreeSha256
    && catalogSha256 === currentLock.integration.catalogSha256;
  if (!valid && !args.allowDirtyBaseline) {
    throw new Error("Vendored baseline differs from config/upstream-lock.json. Review the local changes or pass --allow-dirty-baseline for an audit-only comparison.");
  }
  return {
    valid,
    commit: currentLock.upstream.baselineCommit,
    vendoredTreeSha256,
    catalogSha256
  };
}

async function hashFile(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function hashTree(root) {
  const files = await walk(root);
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function walk(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function renderMarkdown(data) {
  return [
    "# REVIT_MCP_study Upstream Audit",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    "## Baseline",
    "",
    `- Pinned commit: \`${data.baseline.commit}\``,
    `- Vendored baseline valid: \`${data.baseline.valid}\``,
    `- Agent internal tools: \`${data.agent.internalToolCount}\``,
    `- Agent-owned tools: \`${data.agent.agentOwnedTools.join("\`, \`")}\``,
    "",
    "## Audited Upstream",
    "",
    `- Ref: \`${data.upstream.ref}\``,
    `- Commit: \`${data.upstream.commit}\``,
    `- Commit date: \`${data.upstream.commitDate}\``,
    `- Runtime tool names: \`${data.upstream.toolCount}\``,
    `- Exact overlap with Agent catalog: \`${data.comparison.exactNameOverlap}\``,
    "",
    `## Upstream-only Tools (${data.comparison.upstreamOnly.length})`,
    "",
    ...data.comparison.upstreamOnly.map((name) => `- \`${name}\``),
    "",
    `## Agent-only Tools (${data.comparison.agentOnly.length})`,
    "",
    ...data.comparison.agentOnly.map((name) => `- \`${name}\``),
    "",
    "> This is a name-level audit. Do not publish new catalog entries until the corresponding Revit runtime implementation passes build and smoke tests.",
    ""
  ].join("\n");
}
