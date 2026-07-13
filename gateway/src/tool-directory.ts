import { AgentError } from "./errors.js";
import type { BimTaskStep, BimTaskUnderstanding, JsonObject, ToolDirectoryMatch } from "./types.js";

interface ToolDirectory {
  id: string;
  name: string;
  taskTerms: string[];
  toolTerms: string[];
}

const directories: ToolDirectory[] = [
  { id: "context", name: "Project context", taskTerms: ["context", "project", "model", "selection", "目前模型", "專案", "選取"], toolTerms: ["project", "model", "selection", "schema", "document", "active view"] },
  { id: "cad-dwg", name: "CAD and DWG", taskTerms: ["cad", "dwg", "dxf", "圖層", "圖面", "連結圖"], toolTerms: ["cad", "dwg", "dxf", "layer", "import instance", "link cad"] },
  { id: "mep", name: "MEP systems", taskTerms: ["mep", "duct", "pipe", "conduit", "cable tray", "風管", "水管", "電管", "橋架", "機電"], toolTerms: ["mep", "duct", "pipe", "conduit", "cable tray", "connector", "fitting"] },
  { id: "structure", name: "Structure", taskTerms: ["structure", "beam", "column", "foundation", "結構", "梁", "柱", "基礎"], toolTerms: ["structural", "beam", "column", "foundation", "framing"] },
  { id: "elements", name: "Elements and parameters", taskTerms: ["element", "parameter", "family", "type", "元件", "參數", "族群", "類型", "修改"], toolTerms: ["element", "parameter", "family", "type", "instance", "property"] },
  { id: "rooms-spaces", name: "Rooms and spaces", taskTerms: ["room", "space", "area", "房間", "空間", "面積"], toolTerms: ["room", "space", "area", "boundary"] },
  { id: "views", name: "Views", taskTerms: ["view", "section", "elevation", "3d", "視圖", "剖面", "立面", "平面"], toolTerms: ["view", "section", "elevation", "plan view", "3d view", "camera"] },
  { id: "sheets", name: "Sheets and printing", taskTerms: ["sheet", "title block", "print", "圖紙", "圖框", "出圖"], toolTerms: ["sheet", "title block", "viewport", "print"] },
  { id: "annotations", name: "Annotations", taskTerms: ["annotation", "tag", "dimension", "legend", "標註", "標籤", "尺寸", "圖例"], toolTerms: ["annotation", "tag", "dimension", "legend", "text note"] },
  { id: "materials", name: "Materials", taskTerms: ["material", "appearance", "材質", "材料", "外觀"], toolTerms: ["material", "appearance", "asset", "paint"] },
  { id: "geometry-site", name: "Geometry and site", taskTerms: ["geometry", "site", "topography", "coordinate", "幾何", "基地", "地形", "座標"], toolTerms: ["geometry", "site", "topography", "toposolid", "coordinate", "location"] },
  { id: "quality", name: "Review and quality", taskTerms: ["check", "review", "clash", "warning", "檢查", "審查", "碰撞", "警告"], toolTerms: ["check", "review", "clash", "warning", "validate", "audit"] },
  { id: "exchange", name: "Import and export", taskTerms: ["import", "export", "ifc", "nwc", "匯入", "匯出", "交換"], toolTerms: ["import", "export", "ifc", "nwc", "link"] },
];

export function parseTaskUnderstanding(input: JsonObject): BimTaskUnderstanding {
  const raw = input.task;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentError("VALIDATION_ERROR", "task is required: understand and decompose the BIM request before searching tools.");
  }
  const task = raw as Record<string, unknown>;
  const goal = requiredText(task.goal, "task.goal", 500);
  const actions = requiredTextArray(task.actions, "task.actions", 12);
  const objects = requiredTextArray(task.objects, "task.objects", 12);
  const constraints = optionalTextArray(task.constraints, "task.constraints", 12);
  const steps = parseSteps(task.steps);
  const mode = task.mode;
  if (mode !== "assess" && mode !== "execute" && mode !== "plan") {
    throw new AgentError("VALIDATION_ERROR", "task.mode must be assess, execute, or plan.");
  }
  return { goal, actions, objects, constraints, steps, mode };
}

export function routeTask(task: BimTaskUnderstanding, hint = ""): ToolDirectoryMatch[] {
  const text = [task.goal, ...task.actions, ...task.objects, ...(task.constraints ?? []),
    ...task.steps.flatMap((step) => [step.action, step.object ?? "", step.outcome]), hint].join(" ").toLowerCase();
  const matches = directories
    .map((directory) => ({ id: directory.id, name: directory.name,
      score: directory.taskTerms.reduce((sum, term) => sum + (text.includes(term.toLowerCase()) ? 1 : 0), 0) }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
    .slice(0, 3);
  return matches.length > 0 ? matches : [{ id: "all", name: "All BIM tools", score: 0 }];
}

export function directoryToolTerms(matches: ToolDirectoryMatch[]): string[] {
  const ids = new Set(matches.map((match) => match.id));
  return directories.filter((directory) => ids.has(directory.id)).flatMap((directory) => directory.toolTerms);
}

function parseSteps(value: unknown): BimTaskStep[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new AgentError("VALIDATION_ERROR", "task.steps must contain between 1 and 20 decomposed steps.");
  }
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AgentError("VALIDATION_ERROR", `task.steps[${index}] must be an object.`);
    const step = raw as Record<string, unknown>;
    return { action: requiredText(step.action, `task.steps[${index}].action`, 300),
      object: optionalText(step.object, `task.steps[${index}].object`, 300),
      outcome: requiredText(step.outcome, `task.steps[${index}].outcome`, 300) };
  });
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > maxLength) {
    throw new AgentError("VALIDATION_ERROR", `${field} must be a non-empty string up to ${maxLength} characters.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field, maxLength);
}

function requiredTextArray(value: unknown, field: string, maxItems: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maxItems) throw new AgentError("VALIDATION_ERROR", `${field} must contain between 1 and ${maxItems} items.`);
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, 200));
}

function optionalTextArray(value: unknown, field: string, maxItems: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) throw new AgentError("VALIDATION_ERROR", `${field} must contain at most ${maxItems} items.`);
  return value.map((item, index) => requiredText(item, `${field}[${index}]`, 200));
}
