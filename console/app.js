const taskList = document.querySelector("#task-list");
const taskTemplate = document.querySelector("#task-template");
const eventTemplate = document.querySelector("#event-template");
const eventTimeline = document.querySelector("#event-timeline");
const detailEmpty = document.querySelector("#detail-empty");
const taskDetail = document.querySelector("#task-detail");
const bridgeState = document.querySelector("#bridge-state");
const bridgeLabel = document.querySelector("#bridge-label");
const lastUpdated = document.querySelector("#last-updated");
const buildId = document.querySelector("#build-id");
const filters = [...document.querySelectorAll(".filter-button")];
const openResultDetail = document.querySelector("#open-result-detail");
const resultDrawer = document.querySelector("#result-drawer");
const detailBackdrop = document.querySelector("#detail-backdrop");
const closeResultDetail = document.querySelector("#close-result-detail");
const drawerBody = document.querySelector("#drawer-body");
const detailTabs = [...document.querySelectorAll("#detail-tabs button")];
const developerToggle = document.querySelector("#developer-mode");
const executionPicker = document.querySelector("#execution-picker");
const executionSelect = document.querySelector("#execution-select");
const compareRunsButton = document.querySelector("#compare-runs");
const diffPanel = document.querySelector("#diff-panel");
const diffBase = document.querySelector("#diff-base");
const diffCompare = document.querySelector("#diff-compare");
const runDiffButton = document.querySelector("#run-diff");
const closeDiffButton = document.querySelector("#close-diff");

let tasks = [];
let activeFilter = "all";
let selectedTaskId = new URLSearchParams(location.search).get("task");
let selectedEvents = [];
let refreshTimer;
let selectedDetailRequestId;
let detailExecutions = [];
let activeDetailSection = "summary";
let detailPage = 0;
let detailQuery = "";
let detailStatusFilter = "";

openResultDetail.addEventListener("click", () => void openDetailDrawer());
closeResultDetail.addEventListener("click", closeDetailDrawer);
detailBackdrop.addEventListener("click", closeDetailDrawer);
developerToggle.addEventListener("change", () => {
  document.body.classList.toggle("developer-view", developerToggle.checked);
  if (!developerToggle.checked && ["input", "raw"].includes(activeDetailSection)) {
    void loadDetailSection("summary");
    return;
  }
  void loadDetailSection(activeDetailSection);
});
compareRunsButton.addEventListener("click", () => { diffPanel.hidden = false; populateDiffSelectors(); });
closeDiffButton.addEventListener("click", () => { diffPanel.hidden = true; void loadDetailSection(activeDetailSection); });
runDiffButton.addEventListener("click", () => void loadRunDiff());
executionSelect.addEventListener("change", () => {
  selectedDetailRequestId = executionSelect.value;
  detailPage = 0;
  void loadDetailSection("summary");
});
detailTabs.forEach((button) => button.addEventListener("click", () => {
  detailPage = 0;
  detailQuery = "";
  detailStatusFilter = "";
  void loadDetailSection(button.dataset.section || "summary");
}));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !resultDrawer.hidden) closeDetailDrawer();
});

filters.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filters.forEach((item) => item.classList.toggle("is-active", item === button));
    renderTasks();
  });
});

async function refreshAll() {
  await Promise.all([refreshStatus(), refreshTasks()]);
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const status = await response.json();
    bridgeState.dataset.connected = String(status.bridgeConnected === true);
    bridgeLabel.textContent = status.bridgeConnected
      ? `Revit 已連線 · ${status.bridgePort}`
      : `Revit 未連線 · ${status.bridgePort}`;
    lastUpdated.textContent = `更新於 ${formatClock(status.updatedAtUtc)}`;
    buildId.textContent = `Build ${status.buildId || "unknown"}`;
    developerToggle.disabled = status.developerModeAvailable !== true;
    if (developerToggle.disabled) developerToggle.checked = false;
  } catch {
    bridgeState.dataset.connected = "false";
    bridgeLabel.textContent = "工作台資料暫時無法讀取";
  }
}

async function refreshTasks() {
  try {
    const response = await fetch("/api/tasks?limit=200", { cache: "no-store" });
    const payload = await response.json();
    tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
    if (!selectedTaskId || !tasks.some((task) => task.taskId === selectedTaskId)) {
      selectedTaskId = tasks[0]?.taskId;
    }
    renderSummary();
    renderTasks();
    await refreshSelectedEvents();
  } catch {
    tasks = [];
    renderSummary();
    renderTasks();
    renderDetail();
  }
}

async function refreshSelectedEvents() {
  if (!selectedTaskId) {
    selectedEvents = [];
    renderDetail();
    return;
  }
  try {
    const response = await fetch(`/api/tasks/${selectedTaskId}/events?limit=1000`, { cache: "no-store" });
    const payload = await response.json();
    selectedEvents = Array.isArray(payload.events) ? payload.events : [];
  } catch {
    selectedEvents = [];
  }
  renderDetail();
}

function renderSummary() {
  const running = tasks.filter((task) => ["pending", "running"].includes(task.executionStatus)).length;
  const succeeded = tasks.filter((task) => task.executionStatus === "succeeded").length;
  const attention = tasks.filter(isAttention).length;
  document.querySelector("#task-count").textContent = String(tasks.length);
  document.querySelector("#running-count").textContent = String(running);
  document.querySelector("#success-count").textContent = String(succeeded);
  document.querySelector("#attention-count").textContent = String(attention);
}

function renderTasks() {
  const visible = tasks.filter((task) => {
    if (activeFilter === "running") return ["pending", "running"].includes(task.executionStatus);
    if (activeFilter === "succeeded") return task.executionStatus === "succeeded" && !isAttention(task);
    if (activeFilter === "attention") return isAttention(task);
    return true;
  });
  document.querySelector("#visible-count").textContent = String(visible.length);
  taskList.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = tasks.length === 0 ? "尚無 V0.6 任務紀錄" : "此篩選沒有任務";
    taskList.append(empty);
    return;
  }
  for (const task of visible) {
    const row = taskTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.status = task.executionStatus;
    row.classList.toggle("is-selected", task.taskId === selectedTaskId);
    renderBilingual(row.querySelector("strong"), task.title || "BIM task", translateTaskTitle(task.title));
    row.querySelector(".task-meta").textContent = `${formatDateTime(task.updatedAtUtc)} · ${taskProgressLabel(task)}`;
    row.querySelector(".task-status").textContent = engineeringShortLabel(task.engineeringStatus, task);
    row.addEventListener("click", async () => {
      selectedTaskId = task.taskId;
      history.replaceState(null, "", `/?task=${encodeURIComponent(task.taskId)}`);
      renderTasks();
      await refreshSelectedEvents();
    });
    taskList.append(row);
  }
}

function renderDetail() {
  const task = tasks.find((item) => item.taskId === selectedTaskId);
  detailEmpty.hidden = Boolean(task);
  taskDetail.hidden = !task;
  if (!task) return;
  document.querySelector("#detail-time").textContent = formatDateTime(task.createdAtUtc);
  renderBilingual(document.querySelector("#detail-title"), task.title || "BIM task", translateTaskTitle(task.title));
  const status = document.querySelector("#detail-status");
  status.dataset.status = task.executionStatus;
  status.textContent = engineeringLabel(task.engineeringStatus, task);
  document.querySelector("#detail-execution").textContent = executionLabel(task.executionStatus);
  document.querySelector("#detail-impact").textContent = taskImpactLabel(task);
  document.querySelector("#detail-elapsed").textContent = formatDurationBilingual(taskElapsedMs(task));
  document.querySelector("#detail-processing").textContent = task.durationMs === undefined ? "--" : formatDurationBilingual(task.durationMs);
  openResultDetail.disabled = ["pending", "running"].includes(task.executionStatus);
  openResultDetail.textContent = "展開完整資訊";
  renderEvents();
}

function renderEvents() {
  eventTimeline.replaceChildren();
  if (selectedEvents.length === 0) {
    const empty = document.createElement("div");
    empty.className = "list-empty";
    empty.textContent = "尚無執行事件";
    eventTimeline.append(empty);
    return;
  }
  for (const event of compactUserEvents(selectedEvents)) {
    const row = eventTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.status = event.executionStatus;
    row.querySelector("strong").textContent = phaseLabel(event.phase);
    row.querySelector("time").textContent = formatClock(event.timestampUtc);
    const originalMessage = event.message || eventTitle(event);
    renderBilingual(row.querySelector("p"), originalMessage, translateEventMessage(originalMessage, event));
    renderScope(row.querySelector(".event-scope"), event);
    eventTimeline.append(row);
  }
}

function renderScope(container, event) {
  const scope = event.scope || {};
  const values = [];
  if (scope.stepNumber !== undefined && scope.stepCount > 1) values.push(`步驟 ${scope.stepNumber} / ${scope.stepCount}`);
  if (scope.elementIds?.length) values.push(`元素 / Elements：${formatIds(scope.elementIds)}`);
  if (scope.createdElementIds?.length) values.push(`建立 / Created：${formatIds(scope.createdElementIds)}`);
  if (scope.deletedElementIds?.length) values.push(`刪除 / Deleted：${formatIds(scope.deletedElementIds)}`);
  if (scope.rolledBack === true) values.push("已回復模型 / Rolled back");
  for (const value of values) {
    const item = document.createElement("span");
    item.textContent = value;
    container.append(item);
  }
}

function connectEventStream() {
  const stream = new EventSource("/api/events/stream");
  stream.addEventListener("task-event", () => scheduleRefresh());
  stream.onerror = () => {
    lastUpdated.textContent = "即時連線重試中";
  };
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => void refreshTasks(), 120);
}

function isAttention(task) {
  return ["failed", "stopped", "unknown"].includes(task.executionStatus)
    || ["failed", "insufficient_evidence"].includes(task.verificationStatus)
    || ["completed_partially_verified", "verification_failed", "execution_failed", "rolled_back"].includes(task.engineeringStatus);
}

function eventTitle(event) {
  if (event.errorCode) return `錯誤：${event.errorCode}`;
  if (event.phase === "completed") return "這個階段已完成。";
  if (event.phase === "queued") return "等待 Revit 執行。";
  if (event.phase === "executing") return "正在 Revit 中執行。";
  return event.eventType || "任務狀態已更新";
}

function executionLabel(value) {
  return ({ pending: "等待中 / Pending", running: "執行中 / Running", succeeded: "完成 / Completed", failed: "失敗 / Failed", stopped: "已停止 / Stopped", unknown: "狀態不確定 / Unknown" })[value] || "未知 / Unknown";
}

function verificationLabel(value) {
  return ({ not_requested: "未要求 / Not requested", pending: "驗證中 / Verifying", passed: "通過 / Passed", failed: "未通過 / Failed", insufficient_evidence: "證據不足 / Insufficient evidence" })[value] || "未知 / Unknown";
}

function engineeringLabel(value, task = {}) {
  const labels = {
    verified: "已完成並覆核",
    completed_partially_verified: "已完成，部分待確認",
    verification_failed: "結果不符，未提交",
    not_verified: "已完成",
    execution_failed: "執行失敗",
    rolled_back: "已取消並復原",
  };
  if (labels[value]) return labels[value];
  if (task.executionStatus === "succeeded" && task.verificationStatus === "passed") return labels.verified;
  if (task.executionStatus === "succeeded") return labels.not_verified;
  return executionLabel(task.executionStatus);
}

function engineeringShortLabel(value, task = {}) {
  return ({
    verified: "完成並覆核",
    completed_partially_verified: "部分待確認",
    verification_failed: "結果不符",
    not_verified: "完成",
    execution_failed: "執行失敗",
    rolled_back: "已回復",
  })[value] || (task.executionStatus === "succeeded" ? (task.verificationStatus === "passed" ? "完成並覆核" : "完成") : executionLabel(task.executionStatus).split(" /")[0]);
}

function phaseLabel(value) {
  return ({ received: "收到任務 / Received", preparing: "準備執行 / Preparing", routing: "安排工具 / Routing", queued: "等待 Revit / Queued", executing: "執行模型操作 / Executing", verifying: "檢查結果 / Verifying", completed: "任務完成 / Completed", stopped: "任務停止 / Stopped", failed: "執行失敗 / Failed", rolled_back: "已回復模型 / Rolled back", unknown: "狀態待確認 / Unknown" })[value] || value;
}

function humanizeTool(toolId = "") {
  return toolId.replace(/^(agent|builtin|saved|dynamic):/, "").replaceAll("_", " ").replaceAll("-", " ");
}

function executionMethodLabel(toolId = "") {
  if (toolId.startsWith("saved:")) return "使用已保存工具";
  if (toolId.startsWith("builtin:")) return "使用內建工具";
  if (toolId.startsWith("dynamic:")) return "建立新的操作方法";
  if (toolId === "agent:run_bim_plan") return "執行多步驟工作";
  return "由 BIM Agent 處理";
}

function savedToolLabel(detail = {}) {
  if (String(detail.toolId || "").startsWith("saved:")) return `已保存，可供後續重用${detail.version ? `（版本 ${detail.version}）` : ""}`;
  if (String(detail.toolId || "").startsWith("builtin:")) return "內建工具，不需重新建立";
  if (String(detail.toolId || "").startsWith("dynamic:")) return "本次為新操作，尚未成為可重用工具";
  return "不適用";
}

function modelChangedLabel(changes = {}) {
  if (changes?.rolledBack) return "變更已復原";
  if (changes?.modelChanged === true) return "模型已更新";
  if (changes?.modelChanged === false) return "沒有修改模型";
  return "工具未回報";
}

function verificationSummaryLabel(verification = {}) {
  const status = verification?.status;
  if (status === "passed") return "已完成模型覆核";
  if (status === "failed") return "覆核未通過";
  if (status === "insufficient_evidence") return "部分結果待確認";
  if (status === "pending") return "正在覆核";
  return "本次未要求額外覆核";
}

function taskProgressLabel(task = {}) {
  if (["pending", "running"].includes(task.executionStatus)) return "處理中";
  if (task.executionStatus === "succeeded") return "已完成";
  if (task.executionStatus === "failed") return "執行失敗";
  if (task.executionStatus === "stopped") return "已停止";
  return "狀態待確認";
}

function taskImpactLabel(task = {}) {
  const scope = task.scope || {};
  if (scope.rolledBack) return "已復原變更";
  const created = scope.createdElementIds?.length || 0;
  const deleted = scope.deletedElementIds?.length || 0;
  if (created || deleted) return `建立 ${created} · 刪除 ${deleted}`;
  if (task.executionStatus === "succeeded") return "任務已完成";
  return "沒有保留模型變更";
}

function compactUserEvents(events = []) {
  const allowed = new Set(["received", "executing", "verifying", "completed", "failed", "rolled_back", "stopped", "unknown"]);
  const compact = [];
  for (const event of events) {
    if (!allowed.has(event.phase)) continue;
    if (event.toolId === "agent:search_bim_tools" && event.phase === "completed") continue;
    const previous = compact.at(-1);
    const hasModelScope = event.scope?.createdElementIds?.length || event.scope?.deletedElementIds?.length || event.scope?.elementIds?.length;
    if (previous?.phase === event.phase && !event.errorCode && !hasModelScope) continue;
    compact.push(event);
  }
  return compact;
}

function developerTokenLabel(usage) {
  if (!usage) return "未關聯";
  return `${formatTokens(usage.totalTokens)}（未快取輸入 ${formatTokens(usage.uncachedInputTokens)}，輸出 ${formatTokens(usage.outputTokens)}）`;
}

function formatIds(ids) {
  const visible = ids.slice(0, 12).join(", ");
  return ids.length > 12 ? `${visible} 等 ${ids.length} 個` : visible;
}

function formatTokens(value) {
  const tokens = Number(value || 0);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 1 : 2)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}K`;
  return String(Math.round(tokens));
}

function formatDuration(value) {
  const duration = Number(value || 0);
  if (duration >= 3_600_000) {
    const hours = Math.floor(duration / 3_600_000);
    const minutes = Math.floor((duration % 3_600_000) / 60_000);
    return `${hours} 小時 ${minutes} 分`;
  }
  if (duration >= 60_000) {
    const minutes = Math.floor(duration / 60_000);
    const seconds = Math.floor((duration % 60_000) / 1000);
    return `${minutes} 分 ${seconds} 秒`;
  }
  return duration >= 1000 ? `${(duration / 1000).toFixed(duration >= 10000 ? 0 : 1)} 秒` : `${Math.round(duration)} ms`;
}

function formatDurationEnglish(value) {
  const duration = Number(value || 0);
  if (duration >= 3_600_000) return `${Math.floor(duration / 3_600_000)}h ${Math.floor((duration % 3_600_000) / 60_000)}m`;
  if (duration >= 60_000) return `${Math.floor(duration / 60_000)}m ${Math.floor((duration % 60_000) / 1000)}s`;
  return duration >= 1000 ? `${(duration / 1000).toFixed(duration >= 10000 ? 0 : 1)}s` : `${Math.round(duration)}ms`;
}

function formatDurationBilingual(value) {
  return `${formatDuration(value)} / ${formatDurationEnglish(value)}`;
}

function taskElapsedMs(task) {
  const startedAt = Date.parse(task.createdAtUtc);
  const finishedAt = ["pending", "running"].includes(task.executionStatus)
    ? Date.now()
    : Date.parse(task.updatedAtUtc);
  return Number.isFinite(startedAt) && Number.isFinite(finishedAt) ? Math.max(0, finishedAt - startedAt) : 0;
}

function renderBilingual(container, original, translated) {
  container.replaceChildren();
  const primary = document.createElement("span");
  primary.className = "bilingual-primary";
  primary.textContent = translated || original;
  container.append(primary);
  if (translated && translated.trim() !== original.trim()) {
    const secondary = document.createElement("span");
    secondary.className = "bilingual-secondary";
    secondary.textContent = original;
    container.append(secondary);
  }
}

function translateTaskTitle(value = "") {
  const exact = {
    "BIM task": "BIM 任務",
    "Get Project Info": "讀取專案資訊",
    "Read active context smoke": "讀取目前 Revit 狀態測試",
    "Read project information without changing the Revit model": "讀取專案資訊，不修改 Revit 模型",
  };
  if (exact[value]) return exact[value];
  const sanitary = value.match(/^Set the exact (\d+) currently selected sanitary pipes and fittings to semi-transparent green in the active view for a reversible smoke test$/i);
  if (sanitary) return `將目前選取的 ${sanitary[1]} 個污水管與管配件，在目前視圖設為半透明綠色，進行可還原測試`;
  if (/^Set selected elements to a verified active-view color and transparency$/i.test(value)) {
    return "設定並驗證選取元素在目前視圖中的顏色與透明度";
  }
  return undefined;
}

function translateEventMessage(message = "", event = {}) {
  const exact = {
    "task.received": "已收到任務",
    "Waiting for the Revit UI thread.": "正在等待 Revit 主執行緒",
    "Executing in Revit.": "正在 Revit 中執行模型操作",
    "Revit execution completed.": "Revit 模型操作已完成",
    "Set selected elements to a verified active-view color and transparency": "已設定並驗證選取元素在目前視圖中的顏色與透明度",
  };
  if (exact[message]) return exact[message];
  if (message.startsWith("Unsafe, pointer, stackalloc")) return "Dynamic C# 被安全政策阻擋，未執行模型修改";
  if (message.startsWith("Dynamic C# compilation failed:")) return "Dynamic C# 編譯失敗，詳細錯誤如下";
  if (message.startsWith("The collector does not have a filter applied.")) return "Revit 拒絕未套用篩選條件的元素收集器，該次修改已失敗";
  if (event.errorCode && !containsCjk(message)) return `執行錯誤：${event.errorCode}`;
  return containsCjk(message) ? undefined : "系統原始訊息";
}

function containsCjk(value) {
  return /[\u3400-\u9fff]/.test(value);
}

function formatClock(value) {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

async function openDetailDrawer() {
  const task = tasks.find((item) => item.taskId === selectedTaskId);
  if (!task) return;
  resultDrawer.hidden = false;
  detailBackdrop.hidden = false;
  document.body.classList.add("drawer-open");
  document.querySelector("#drawer-title").textContent = task.title || "BIM 任務詳細結果";
  document.querySelector("#drawer-tool").textContent = "正在整理執行結果與模型影響";
  renderDrawerLoading();
  try {
    const response = await fetch(`/api/tasks/${task.taskId}/details`, { cache: "no-store" });
    const payload = await response.json();
    detailExecutions = Array.isArray(payload.details) ? payload.details : [];
    if (detailExecutions.length === 0) {
      renderMissingDetail();
      return;
    }
    const preferred = detailExecutions.find((item) => !["get_agent_status", "get_bim_context", "search_bim_tools"].includes(item.publicTool));
    selectedDetailRequestId = preferred?.requestId || detailExecutions[0].requestId;
    renderExecutionPicker();
    await loadDetailSection("summary");
    drawerBody.focus();
  } catch {
    renderDrawerError("詳細結果暫時無法讀取", "請確認工作台服務仍在執行，再重新開啟詳情。");
  }
}

function closeDetailDrawer() {
  resultDrawer.hidden = true;
  detailBackdrop.hidden = true;
  document.body.classList.remove("drawer-open", "developer-view");
  developerToggle.checked = false;
  diffPanel.hidden = true;
  openResultDetail.focus();
}

function renderExecutionPicker() {
  executionSelect.replaceChildren();
  for (const detail of detailExecutions) {
    const option = document.createElement("option");
    option.value = detail.requestId;
    option.selected = detail.requestId === selectedDetailRequestId;
    option.textContent = developerToggle.checked
      ? `${humanizeTool(detail.toolId)} · ${formatClock(detail.startedAtUtc)} · ${engineeringLabel(detail.status || detail.engineeringStatus)}`
      : `${formatClock(detail.startedAtUtc)} · ${executionMethodLabel(detail.toolId)} · ${engineeringLabel(detail.status || detail.engineeringStatus)}`;
    executionSelect.append(option);
  }
  executionPicker.hidden = detailExecutions.length < 2;
  compareRunsButton.disabled = detailExecutions.length < 2;
}

async function loadDetailSection(section) {
  if (!selectedTaskId || !selectedDetailRequestId) return;
  activeDetailSection = section;
  detailTabs.forEach((button) => button.classList.toggle("is-active", button.dataset.section === section));
  renderDrawerLoading();
  const parameters = new URLSearchParams({
    section,
    offset: String(detailPage * 20),
    limit: "20",
  });
  if (detailQuery) parameters.set("query", detailQuery);
  if (detailStatusFilter) parameters.set("status", detailStatusFilter);
  if (developerToggle.checked && section === "raw") parameters.set("developer", "1");
  try {
    const response = await fetch(`/api/tasks/${selectedTaskId}/details/${selectedDetailRequestId}?${parameters}`, { cache: "no-store" });
    if (!response.ok) throw new Error("detail unavailable");
    const payload = await response.json();
    renderDetailSection(section, payload.detail);
  } catch {
    renderDrawerError("這一頁無法讀取", "實際payload不存在或工作台服務暫時無法回應。");
  }
}

function renderDetailSection(section, detail) {
  drawerBody.replaceChildren();
  const selected = detailExecutions.find((item) => item.requestId === selectedDetailRequestId);
  document.querySelector("#drawer-tool").textContent = selected
    ? developerToggle.checked
      ? `${humanizeTool(selected.toolId)} · Request ${shortId(selected.requestId)}`
      : `${executionMethodLabel(selected.toolId)} · ${formatClock(selected.startedAtUtc)}`
    : "";
  if (section === "summary") renderDetailSummary(detail);
  else if (section === "input") renderDetailInput(detail);
  else if (section === "verification") renderVerification(detail);
  else if (section === "raw") renderRawJson(detail);
  else renderResult(detail);
}

function renderDetailSummary(detail) {
  const statusValue = detail.status || detail.engineeringStatus;
  const verdict = document.createElement("section");
  verdict.className = "detail-verdict";
  verdict.dataset.status = statusValue;
  const verdictCopy = document.createElement("div");
  const heading = document.createElement("strong");
  heading.textContent = engineeringLabel(statusValue);
  const explanation = document.createElement("p");
  explanation.textContent = engineeringExplanation(statusValue);
  verdictCopy.append(heading, explanation);
  const duration = document.createElement("span");
  duration.textContent = formatDurationBilingual(detail.durationMs);
  verdict.append(verdictCopy, duration);
  drawerBody.append(verdict);

  drawerBody.append(
    createEvidenceSection("這次怎麼執行", "", [
      ["執行方式", executionMethodLabel(detail.toolId)],
      ["工具記憶", savedToolLabel(detail)],
      ["專案", detail.modelAfter?.projectName || detail.modelBefore?.projectName || "未由工具回傳"],
      ["作用中視圖", detail.modelAfter?.activeView || detail.modelBefore?.activeView || "未由工具回傳"],
      ["開始時間", formatDateTimeFull(detail.startedAtUtc)],
      ["Revit處理時間", formatDurationBilingual(detail.durationMs)],
    ]),
    createEvidenceSection(domainResultTitle(detail.domainView), "", domainSummaryRows(detail.domainView)),
    createEvidenceSection("模型影響", "", [
      ["模型是否變更", modelChangedLabel(detail.changes)],
      ["建立元素", detail.changes?.createdElementIds?.length ?? 0],
      ["修改元素", detail.changes?.modifiedElementIds?.length ?? 0],
      ["刪除元素", detail.changes?.deletedElementIds?.length ?? 0],
      ["是否復原", detail.changes?.rolledBack ? "已復原，模型未保留變更" : "否"],
      ["警告", detail.warningCount ? `${detail.warningCount} 項` : "無"],
    ]),
    createEvidenceSection("模型覆核", "", [
      ["覆核狀態", verificationSummaryLabel(detail.verification)],
      ["已覆核元素", detail.verification?.checkedElementCount ?? 0],
      ["通過項目", detail.verification?.passedCount ?? 0],
      ["未通過項目", detail.verification?.failedCount ?? 0],
      ["待確認項目", detail.verification?.uncoveredCount ?? 0],
    ]),
  );

  if (developerToggle.checked) {
    drawerBody.append(
      createEvidenceSection("開發者執行資料", "Developer execution", [
        ["工具 / Tool", detail.toolId],
        ["版本 / Version", detail.version || "--"],
        ["風險 / Risk", detail.risk || "--"],
        ["Request ID", detail.requestId],
        ["Run ID", detail.runId || "--"],
        ["Source hash", detail.sourceHash ? shortHash(detail.sourceHash) : "--"],
        ["Domain", detail.domain || "generic_revit_operation"],
        ["Domain schema", detail.domainSchemaVersion ?? "--"],
        ["Codex Token", developerTokenLabel(tasks.find((task) => task.taskId === selectedTaskId)?.codexUsage)],
      ]),
      createEvidenceSection("開發者模型資料", "Developer model data", [
        ["Project fingerprint", detail.modelAfter?.projectFingerprint ? shortHash(detail.modelAfter.projectFingerprint) : "--"],
        ["Revit version", detail.modelAfter?.revitVersion || "--"],
        ["View ID", detail.modelAfter?.activeViewId ?? "--"],
        ["Transaction", detail.changes?.transactionName || "--"],
        ["Created Element IDs", detail.changes?.createdElementIds?.length ? detail.changes.createdElementIds.join(", ") : "0"],
        ["Modified Element IDs", detail.changes?.modifiedElementIds?.length ? detail.changes.modifiedElementIds.join(", ") : "0"],
        ["Deleted Element IDs", detail.changes?.deletedElementIds?.length ? detail.changes.deletedElementIds.join(", ") : "0"],
        ["Verification scope", detail.verification?.verificationScope || "none"],
      ]),
    );
  }

  if (developerToggle.checked && Array.isArray(detail.stageTrace) && detail.stageTrace.length) {
    drawerBody.append(createCollectionPanel({ path: "stageTrace", total: detail.stageTrace.length, filteredTotal: detail.stageTrace.length, offset: 0, limit: detail.stageTrace.length, items: detail.stageTrace }, "summary"));
  }

  if (detail.error) drawerBody.append(createErrorPanel(detail.error));
}

function domainSummaryRows(domainView = {}) {
  const rows = Array.isArray(domainView.summaryRows) ? domainView.summaryRows : [];
  return rows.length
    ? rows.map((row) => [row.label || humanizeField(row.key), row.value ?? "未由工具回傳 / Not reported"])
    : [["結果摘要", "工具未提供額外工程摘要"]];
}

function domainResultTitle(domainView = {}) {
  const title = String(domainView.title || "").trim();
  return !title || title === "generic_revit_operation" || title === "Generic Revit operation" ? "工程結果" : title;
}

function renderDetailInput(detail) {
  const intro = createSectionIntro("實際送入工具的參數", "Actual parameters sent to the tool. Values are not reconstructed from the task title.");
  drawerBody.append(intro);
  const rows = flattenValues(detail.input).map((row) => ({ ...row, ...(detail.inputOrigins?.[row.path] || {}) }));
  if (rows.length === 0) return appendEmpty(drawerBody, "這次工具沒有輸入參數 / No input arguments");
  const table = createTable(["欄位 / Field", "值 / Value", "來源 / Origin"]);
  for (const row of rows) {
    const tr = document.createElement("tr");
    tr.append(
      tableCellWithSecondary(humanizeField(row.path), row.path),
      valueCell(row.unit ? `${displayValue(row.value)} ${row.unit}` : row.value),
      textCell(inputOriginLabel(row.origin, row.defaultValue)),
    );
    table.tBodies[0].append(tr);
  }
  drawerBody.append(wrapTable(table));
}

function renderResult(detail) {
  const result = detail?.value ?? detail;
  const collection = detail?.collection;
  drawerBody.append(createSectionIntro("工具結果與正規化資料", "Raw result is preserved separately. Domain renderers only provide a readable projection."));
  for (const tableView of detail?.domainView?.tables || []) {
    if (!Array.isArray(tableView.rows) || tableView.rows.length === 0) continue;
    const section = document.createElement("section");
    section.className = "evidence-section";
    const heading = document.createElement("h3");
    heading.textContent = tableView.title || tableView.id;
    section.append(heading, createDynamicTable(tableView.rows));
    drawerBody.append(section);
  }
  const rows = flattenValues(result?.normalizedResult || result, "", [], 100).filter((row) => !row.path.includes("deferred"));
  if (rows.length) drawerBody.append(createKeyValueGrid(rows.slice(0, 40)));
  if (collection) drawerBody.append(createCollectionPanel(collection, "result"));
  if (!rows.length && !collection) appendEmpty(drawerBody, "工具回傳空結果 / Empty result payload");
}

function renderVerification(detail) {
  const verification = detail?.value ?? detail;
  const collection = detail?.collection;
  const status = verification?.status || "not_requested";
  const panel = document.createElement("section");
  panel.className = "verification-callout";
  panel.dataset.status = status;
  const title = document.createElement("strong");
  title.textContent = verificationLabel(status);
  const copy = document.createElement("p");
  copy.textContent = status === "not_requested"
    ? "這項工作沒有要求額外模型覆核；任務已依 Revit 執行結果完成。"
    : status === "insufficient_evidence"
      ? "部分必要 Claim 尚未被驗證證據涵蓋。"
      : status === "failed"
        ? "至少一項必要 Claim 驗證失敗。"
        : "所有必要 Claim 均有對應證據且通過。";
  panel.append(title, copy);
  drawerBody.append(panel);
  drawerBody.append(createEvidenceSection("覆核結果", "", [
    ["覆核方式", verification?.method || (status === "not_requested" ? "未要求額外覆核" : "未由工具回傳")],
    ["檢查元素", verification?.checkedElementCount ?? "--"],
    ["通過項目", verification?.passedCount ?? 0],
    ["未通過項目", verification?.failedCount ?? 0],
    ["待確認項目", verification?.uncoveredClaims?.length ?? 0],
    ["覆核時間", verification?.verifiedAtUtc ? formatDateTimeFull(verification.verifiedAtUtc) : "--"],
  ]));
  if (developerToggle.checked) {
    drawerBody.append(createEvidenceSection("開發者覆核資料", "Developer verification", [
      ["Verification request", verification?.verificationRequestId || "--"],
      ["Verification scope", verification?.verificationScope || "none"],
      ["Required claims", verification?.requiredClaims?.length ?? 0],
      ["Covered claims", verification?.coveredClaims?.length ? verification.coveredClaims.join(", ") : "--"],
      ["Uncovered claims", verification?.uncoveredClaims?.length ? verification.uncoveredClaims.join(", ") : "--"],
    ]));
  }
  if (collection) drawerBody.append(createCollectionPanel(collection, "verification"));
}

function renderRawJson(detail) {
  const controls = document.createElement("div");
  controls.className = "raw-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "複製JSON / Copy";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
    copy.textContent = "已複製 / Copied";
  });
  controls.append(copy);
  const metadata = document.createElement("p");
  metadata.className = "raw-meta";
  const envelope = detail.envelope || detail;
  metadata.textContent = `Schema v${envelope.schemaVersion ?? "?"} · ${envelope.tool?.toolId || envelope.toolId || "unknown tool"} · ${envelope.generatedAtUtc ? formatDateTimeFull(envelope.generatedAtUtc) : ""}`;
  const pre = document.createElement("pre");
  pre.className = "json-viewer";
  pre.textContent = JSON.stringify(detail, null, 2);
  drawerBody.append(controls, metadata, pre);
}

function createCollectionPanel(collection, section) {
  const panel = document.createElement("section");
  panel.className = "collection-panel";
  const heading = document.createElement("div");
  heading.className = "collection-heading";
  const title = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = humanizeField(collection.path || "items");
  const count = document.createElement("span");
  count.textContent = `本頁 ${collection.items.length} 筆 · 篩選後 ${collection.filteredTotal ?? collection.total} 筆 · 全部 ${collection.total} 筆`;
  title.append(strong, count);
  const controls = document.createElement("div");
  controls.className = "collection-controls";
  const search = document.createElement("input");
  search.type = "search";
  search.placeholder = "搜尋Candidate或Element ID";
  search.value = detailQuery;
  const status = document.createElement("select");
  for (const [value, label] of [["", "全部狀態 / All"], ["ready", "Ready"], ["ready_to_create", "Ready to create"], ["verified", "Verified"], ["review", "Review"], ["review_required", "Review required"], ["blocked", "Blocked"], ["failed", "Failed"], ["passed", "Passed"]]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    status.append(option);
  }
  status.value = detailStatusFilter;
  const apply = document.createElement("button");
  apply.type = "button";
  apply.textContent = "篩選";
  apply.addEventListener("click", () => {
    detailQuery = search.value;
    detailStatusFilter = status.value;
    detailPage = 0;
    void loadDetailSection(section);
  });
  controls.append(search, status, apply);
  heading.append(title, controls);
  panel.append(heading);
  if (collection.items.length) panel.append(createDynamicTable(collection.items));
  else appendEmpty(panel, "沒有符合條件的資料 / No matching records");

  const pagination = document.createElement("div");
  pagination.className = "pagination";
  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "上一頁";
  previous.disabled = detailPage === 0;
  previous.addEventListener("click", () => { detailPage -= 1; void loadDetailSection(section); });
  const page = document.createElement("span");
  const total = collection.filteredTotal ?? collection.total;
  page.textContent = `第 ${detailPage + 1} / ${Math.max(1, Math.ceil(total / collection.limit))} 頁`;
  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "下一頁";
  next.disabled = (detailPage + 1) * collection.limit >= total;
  next.addEventListener("click", () => { detailPage += 1; void loadDetailSection(section); });
  pagination.append(previous, page, next);
  panel.append(pagination);
  return panel;
}

function createDynamicTable(items) {
  const preferred = ["stage", "errorLayer", "sourceId", "candidateId", "CandidateId", "previewId", "operationId", "elementId", "ElementId", "verificationId", "claimId", "status", "Status", "result", "Result", "blockName", "BlockName", "level", "Level"];
  const available = [...new Set(items.flatMap((item) => item && typeof item === "object" ? Object.keys(item) : ["value"]))];
  const keys = [...preferred.filter((key) => available.includes(key)), ...available.filter((key) => !preferred.includes(key))].slice(0, 7);
  const table = createTable(keys.map(humanizeField));
  for (const item of items) {
    const tr = document.createElement("tr");
    for (const key of keys) {
      const value = key === "value" ? item : item?.[key];
      const cell = valueCell(value);
      if (/(candidateId|elementId)$/i.test(key) && value !== undefined) cell.append(copyValueButton(value));
      tr.append(cell);
    }
    table.tBodies[0].append(tr);
  }
  return wrapTable(table);
}

function createEvidenceSection(title, secondary, rows) {
  const section = document.createElement("section");
  section.className = "evidence-section";
  const heading = document.createElement("h3");
  heading.textContent = secondary ? `${title} / ${secondary}` : title;
  section.append(heading);
  const grid = document.createElement("dl");
  grid.className = "evidence-grid";
  for (const [label, value] of rows) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = label;
    const dd = document.createElement("dd");
    dd.textContent = displayValue(value);
    item.append(dt, dd);
    grid.append(item);
  }
  section.append(grid);
  return section;
}

function createSectionIntro(title, description) {
  const section = document.createElement("div");
  section.className = "section-intro";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  section.append(heading, copy);
  return section;
}

function createKeyValueGrid(rows) {
  const section = document.createElement("section");
  section.className = "evidence-section";
  const grid = document.createElement("dl");
  grid.className = "evidence-grid result-values";
  for (const row of rows) {
    const item = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = humanizeField(row.path);
    const dd = document.createElement("dd");
    dd.textContent = displayValue(row.value);
    item.append(dt, dd);
    grid.append(item);
  }
  section.append(grid);
  return section;
}

function createErrorPanel(error) {
  const panel = document.createElement("section");
  panel.className = "error-panel";
  panel.append(
    createEvidenceSection("錯誤說明", "Error", [
      ["Code", error.code],
      ["錯誤層 / Error layer", error.errorLayer || "未分類 / Unclassified"],
      ["技術說明 / Technical", error.technicalMessage],
      ["工程說明 / Engineering", error.engineeringMessage],
      ["建議處理 / Suggested action", error.suggestedAction],
    ]),
  );
  if (developerToggle.checked && error.stack) {
    const stack = document.createElement("pre");
    stack.className = "json-viewer";
    stack.textContent = error.stack;
    panel.append(stack);
  }
  return panel;
}

function createTable(headers) {
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((header) => {
    const th = document.createElement("th");
    th.textContent = header;
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead, document.createElement("tbody"));
  return table;
}

function wrapTable(table) {
  const wrapper = document.createElement("div");
  wrapper.className = "table-scroll";
  wrapper.append(table);
  return wrapper;
}

function textCell(value) {
  const cell = document.createElement("td");
  cell.textContent = displayValue(value);
  return cell;
}

function valueCell(value) {
  const cell = document.createElement("td");
  cell.className = "value-cell";
  const text = document.createElement("span");
  text.textContent = displayValue(value);
  cell.append(text);
  return cell;
}

function tableCellWithSecondary(primary, secondary) {
  const cell = document.createElement("td");
  const strong = document.createElement("strong");
  strong.textContent = primary;
  const small = document.createElement("small");
  small.textContent = secondary;
  cell.append(strong, small);
  return cell;
}

function copyValueButton(value) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-icon";
  button.title = "複製";
  button.setAttribute("aria-label", `複製 ${value}`);
  button.textContent = "⧉";
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(String(value));
    button.textContent = "✓";
  });
  return button;
}

function flattenValues(value, path = "", rows = [], maximum = 500) {
  if (rows.length >= maximum) return rows;
  if (Array.isArray(value)) {
    if (value.length === 0) rows.push({ path, value: "[]" });
    else value.forEach((item, index) => flattenValues(item, `${path}[${index}]`, rows, maximum));
  } else if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) rows.push({ path, value: "{}" });
    else entries.forEach(([key, child]) => flattenValues(child, path ? `${path}.${key}` : key, rows, maximum));
  } else {
    rows.push({ path, value });
  }
  return rows;
}

function humanizeField(value = "") {
  const leaf = value.split(".").at(-1) || value;
  return leaf.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "未提供 / Missing";
  if (value === "") return "空字串 / Empty string";
  if (typeof value === "boolean") return value ? "是 / Yes" : "否 / No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatBoolean(value) {
  if (value === undefined) return "未回傳 / Not reported";
  return value ? "是 / Yes" : "否 / No";
}

function shortId(value = "") { return value.length > 12 ? `${value.slice(0, 8)}...` : value; }
function shortHash(value = "") { return value.length > 12 ? `${value.slice(0, 12)}...` : value; }

function formatDateTimeFull(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

function engineeringExplanation(status) {
  return ({
    verified: "所有必要工程主張均有對應證據且通過。",
    completed_partially_verified: "工具已完成，但目前證據只涵蓋部分工程主張；請查看驗證範圍。",
    verification_failed: "至少一項必要工程主張驗證失敗。",
    not_verified: "任務已完成，本次沒有要求額外模型覆核。",
    execution_failed: "工具執行失敗，請依錯誤層檢查輸入、傳輸或 Revit 執行階段。",
    rolled_back: "操作未提交，模型變更已回復。",
  })[status] || "狀態資料不足。";
}

function inputOriginLabel(origin, defaultValue) {
  const label = ({
    user_provided: "使用者指定 / User provided",
    default: "預設值 / Default",
    agent_resolved: "Agent解析 / Agent resolved",
    tool_derived: "工具推導 / Tool derived",
    system_injected: "系統注入 / System injected",
  })[origin] || "來源未記錄 / Origin missing";
  return defaultValue === undefined ? label : `${label} · default ${displayValue(defaultValue)}`;
}

function populateDiffSelectors() {
  const current = selectedDetailRequestId;
  const options = detailExecutions.map((detail) => ({
    value: detail.requestId,
    label: `${formatClock(detail.startedAtUtc)} · ${humanizeTool(detail.toolId)} · ${engineeringShortLabel(detail.status || detail.engineeringStatus, detail)}`,
  }));
  diffBase.replaceChildren();
  diffCompare.replaceChildren();
  for (const item of options) {
    const baseOption = document.createElement("option");
    baseOption.value = item.value;
    baseOption.textContent = item.label;
    diffBase.append(baseOption);
    diffCompare.append(baseOption.cloneNode(true));
  }
  diffCompare.value = current || options[0]?.value || "";
  diffBase.value = options.find((item) => item.value !== diffCompare.value)?.value || diffCompare.value;
}

async function loadRunDiff() {
  if (!selectedTaskId || !diffBase.value || !diffCompare.value) return;
  renderDrawerLoading();
  const params = new URLSearchParams({ base: diffBase.value, compare: diffCompare.value });
  if (developerToggle.checked) params.set("developer", "1");
  try {
    const response = await fetch(`/api/tasks/${selectedTaskId}/diff?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error("diff unavailable");
    const payload = await response.json();
    renderRunDiff(payload.diff);
  } catch {
    renderDrawerError("無法比較這兩次執行", "請確認兩筆 Run 仍存在；Developer Mode 必須由啟動參數明確開啟。");
  }
}

function renderRunDiff(diff) {
  drawerBody.replaceChildren();
  drawerBody.append(createSectionIntro("Run差異 / Run diff", `共 ${diff.changeCount ?? 0} 項差異；大量差異最多顯示 2000 項。`));
  drawerBody.append(createEvidenceSection("比較範圍", "Comparison", [
    ["Base", diff.base?.requestId || "--"],
    ["Compare", diff.compare?.requestId || "--"],
    ["差異 / Changes", diff.changeCount ?? 0],
    ["截斷 / Truncated", formatBoolean(diff.truncated)],
  ]));
  const changes = Array.isArray(diff.changes) ? diff.changes : [];
  if (!changes.length) return appendEmpty(drawerBody, "兩次 Run 在比較範圍內沒有差異 / No differences");
  drawerBody.append(createDynamicTable(changes));
}

function appendEmpty(container, message) {
  const empty = document.createElement("div");
  empty.className = "detail-empty";
  empty.textContent = message;
  container.append(empty);
}

function renderDrawerLoading() {
  drawerBody.replaceChildren(document.querySelector("#detail-loading-template").content.cloneNode(true));
}

function renderMissingDetail() {
  executionPicker.hidden = true;
  document.querySelector("#drawer-tool").textContent = "舊版任務紀錄 / Legacy task record";
  drawerBody.replaceChildren();
  renderDrawerError(
    "這筆任務沒有保存執行payload",
    "此任務建立於詳細結果功能之前。工作台只能顯示既有事件，不能從任務標題推測工具輸入或Revit結果。請重新執行唯讀測試以建立可驗證證據。",
  );
}

function renderDrawerError(title, description) {
  drawerBody.replaceChildren();
  const panel = document.createElement("div");
  panel.className = "detail-empty detail-error";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = description;
  panel.append(strong, copy);
  drawerBody.append(panel);
}

void refreshAll();
connectEventStream();
setInterval(() => void refreshAll(), 10_000);
