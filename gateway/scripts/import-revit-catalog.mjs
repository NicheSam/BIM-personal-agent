import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const gatewayRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultModule = resolve(gatewayRoot, "..", "..", "REVIT_MCP_latest", "MCP-Server", "build", "tools", "index.js");
const modulePath = resolve(process.argv[2] || defaultModule);
process.env.MCP_PROFILE = "full";
const registry = await import(pathToFileURL(modulePath).href);
const tools = registry.registerRevitTools();

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

const catalog = tools.map((tool) => ({
  toolId: `builtin:${tool.name}`,
  name: tool.name,
  version: "upstream-cfe0739-local",
  description: tool.description || tool.name,
  inputSchema: tool.inputSchema || { type: "object", properties: {} },
  status: disabled.has(tool.name) ? "disabled" : validated.has(tool.name) ? "validated" : "experimental",
  risk: destructivePattern.test(tool.name) ? "destructive" : readPattern.test(tool.name) ? "readOnly" : "reversibleMutation",
  binding: "portable",
  tags: ["revit", "builtin"],
  source: "shuotao/REVIT_MCP_study@cfe0739+local"
}));

if (catalog.length !== 148 || new Set(catalog.map((tool) => tool.toolId)).size !== catalog.length) {
  throw new Error(`Expected 148 unique tools, received ${catalog.length}`);
}

const output = resolve(gatewayRoot, "src", "catalog", "builtin-tools.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Imported ${catalog.length} tools to ${output}`);
