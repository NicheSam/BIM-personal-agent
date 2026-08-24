import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
if (!args.module) {
  throw new Error("Pass --module <MCP-Server/build/tools/index.js>. The importer no longer depends on an implicit sibling checkout.");
}
if (!args.upstreamRoot) {
  throw new Error("Pass --upstream-root <clean REVIT_MCP_study checkout>.");
}
if (!args.sourceRef) {
  throw new Error("Pass --source-ref <commit> so every imported descriptor keeps exact provenance.");
}

const projectRoot = resolve(gatewayRoot, "..");
const upstreamRoot = resolve(args.upstreamRoot);
const lock = JSON.parse(await readFile(resolve(projectRoot, "config", "upstream-lock.json"), "utf8"));
const expectedUpstreamCount = Number(args.expectedUpstreamCount);
if (!Number.isInteger(expectedUpstreamCount) || expectedUpstreamCount < 1) {
  throw new Error("Pass --expected-upstream-count <number>.");
}

const modulePath = resolve(args.module);
if (!isInside(upstreamRoot, modulePath)) {
  throw new Error("The built registry module must be inside --upstream-root.");
}
const upstreamHead = git(upstreamRoot, ["rev-parse", "HEAD"]);
if (upstreamHead !== args.sourceRef) {
  throw new Error(`Upstream HEAD ${upstreamHead} does not match --source-ref ${args.sourceRef}.`);
}
if (git(upstreamRoot, ["status", "--porcelain"])) {
  throw new Error("Upstream checkout is dirty. Build and import from a clean checkout at the pinned source ref.");
}
process.env.MCP_PROFILE = "full";
const registry = await import(pathToFileURL(modulePath).href);
const tools = registry.registerRevitTools();
const currentCatalogPath = resolve(gatewayRoot, "src", "catalog", "builtin-tools.json");
const currentCatalog = JSON.parse(await readFile(currentCatalogPath, "utf8"));
const agentOwnedNames = new Set(lock.integration.agentOwnedTools);
const agentOwnedTools = currentCatalog.filter((tool) => agentOwnedNames.has(tool.name));
const unexpectedAgentTools = tools.filter((tool) => agentOwnedNames.has(tool.name)).map((tool) => tool.name);
if (unexpectedAgentTools.length) {
  throw new Error(`Clean upstream registry unexpectedly contains Agent-owned tools: ${unexpectedAgentTools.join(", ")}`);
}

const validated = new Set([
  "get_task_context", "get_project_info", "get_all_levels", "get_element_info",
  "modify_element_parameter", "get_selected_elements", "get_all_views", "get_active_view",
  "get_active_schema", "get_category_fields", "get_field_values", "query_elements_with_filter",
  "move_element", "list_categories", "change_element_type", "get_types_by_category",
  "get_connector_info", "get_linked_models", "query_linked_elements", "get_element_geometry",
  "execute_dynamic_csharp"
]);
const disabled = new Set([
  "copy_sheets_from_file", "dedup_detail_elements_in_view", "delete_element",
  "door-window-legend-tools", "export_families", "import_excel_to_drafting_views",
  "read_excel_tables"
]);
const destructivePattern = /(delete|purge|overwrite|dedup|remove|replace)/i;
const readPattern = /^(get|list|query|read|analyze|check|scan|measure|find|detect|debug|inspect|calculate)_/i;

const upstreamCatalog = tools.map((tool) => ({
  toolId: `builtin:${tool.name}`,
  name: tool.name,
  version: `upstream-${args.sourceRef.slice(0, 7)}`,
  description: tool.description || tool.name,
  inputSchema: tool.inputSchema || { type: "object", properties: {} },
  status: disabled.has(tool.name) ? "disabled" : validated.has(tool.name) ? "validated" : "experimental",
  risk: destructivePattern.test(tool.name) ? "destructive" : readPattern.test(tool.name) ? "readOnly" : "reversibleMutation",
  binding: "portable",
  tags: ["revit", "builtin"],
  source: `shuotao/REVIT_MCP_study@${args.sourceRef}`
}));
const catalog = [...upstreamCatalog, ...agentOwnedTools]
  .sort((left, right) => left.name.localeCompare(right.name));

if (tools.length !== expectedUpstreamCount) {
  throw new Error(`Expected ${expectedUpstreamCount} upstream tools, received ${tools.length}`);
}
if (agentOwnedTools.length !== agentOwnedNames.size) {
  throw new Error(`Expected ${agentOwnedNames.size} Agent-owned tools, received ${agentOwnedTools.length}`);
}
if (new Set(catalog.map((tool) => tool.toolId)).size !== catalog.length) {
  throw new Error(`Tool IDs are not unique across ${catalog.length} descriptors.`);
}

console.log(`Prepared ${tools.length} upstream and ${agentOwnedTools.length} Agent-owned tools (${catalog.length} total).`);
if (!args.apply) {
  console.log("Preview only. Pass --apply --ack-runtime-parity after the matching Revit runtime passes build and smoke tests.");
  process.exit(0);
}
if (!args.ackRuntimeParity) {
  throw new Error("Catalog write refused. Pass --ack-runtime-parity only after the matching Revit command runtime has been integrated and tested.");
}

await mkdir(dirname(currentCatalogPath), { recursive: true });
await writeFile(currentCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Imported ${catalog.length} tools to ${currentCatalogPath}`);

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

function git(root, values) {
  const safeRoot = root.replaceAll("\\", "/");
  return execFileSync("git", ["-c", `safe.directory=${safeRoot}`, "-C", root, ...values], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function isInside(root, path) {
  const normalizedRoot = `${root.toLowerCase().replace(/[\\/]+$/, "")}\\`;
  return path.toLowerCase().startsWith(normalizedRoot);
}
