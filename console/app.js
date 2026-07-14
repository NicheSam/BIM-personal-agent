const timeline = document.querySelector("#timeline");
const template = document.querySelector("#event-template");
const bridgeState = document.querySelector("#bridge-state");
const bridgeLabel = document.querySelector("#bridge-label");
const lastUpdated = document.querySelector("#last-updated");
const filters = [...document.querySelectorAll(".filter-button")];

let events = [];
let activeFilter = "all";

filters.forEach((button) => {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter;
    filters.forEach((item) => item.classList.toggle("is-active", item === button));
    renderEvents();
  });
});

async function refresh() {
  try {
    const [statusResponse, eventResponse] = await Promise.all([
      fetch("/api/status", { cache: "no-store" }),
      fetch("/api/events?limit=300", { cache: "no-store" }),
    ]);
    const status = await statusResponse.json();
    const payload = await eventResponse.json();
    events = Array.isArray(payload.events) ? payload.events : [];
    bridgeState.dataset.connected = String(status.bridgeConnected === true);
    bridgeLabel.textContent = status.bridgeConnected
      ? `Revit 已連線 · ${status.bridgePort}`
      : `Revit 未連線 · ${status.bridgePort}`;
    lastUpdated.textContent = `更新於 ${formatClock(status.updatedAtUtc)}`;
    renderSummary();
    renderEvents();
  } catch {
    bridgeState.dataset.connected = "false";
    bridgeLabel.textContent = "控制台資料暫時無法讀取";
  }
}

function renderSummary() {
  const succeeded = events.filter((event) => event.status === "succeeded").length;
  const attention = events.length - succeeded;
  const average = events.length === 0
    ? 0
    : Math.round(events.reduce((total, event) => total + Number(event.durationMs || 0), 0) / events.length);
  document.querySelector("#event-count").textContent = String(events.length);
  document.querySelector("#success-count").textContent = String(succeeded);
  document.querySelector("#attention-count").textContent = String(attention);
  document.querySelector("#average-duration").textContent = formatDuration(average);
}

function renderEvents() {
  const visible = events.filter((event) => {
    if (activeFilter === "attention") return event.status !== "succeeded";
    if (activeFilter === "operation") return ["operation", "plan", "dynamic"].includes(event.kind);
    return true;
  });
  timeline.replaceChildren();
  if (visible.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const title = document.createElement("strong");
    title.textContent = events.length === 0 ? "尚無 Agent 活動" : "此篩選沒有事件";
    const detail = document.createElement("span");
    detail.textContent = events.length === 0 ? "執行 BIM 任務後，事件會依時間出現在這裡。" : "切換其他篩選查看紀錄。";
    empty.append(title, detail);
    timeline.append(empty);
    return;
  }

  visible.forEach((event) => {
    const row = template.content.firstElementChild.cloneNode(true);
    row.dataset.status = event.status;
    row.querySelector("time").textContent = formatDateTime(event.completedAtUtc);
    row.querySelector("h2").textContent = event.title || humanizeTool(event.toolId);
    row.querySelector(".event-status").textContent = statusLabel(event.status);
    row.querySelector(".event-summary").textContent = event.summary || "";
    row.querySelector(".event-tool").textContent = humanizeTool(event.toolId);
    row.querySelector(".event-duration").textContent = formatDuration(event.durationMs);
    row.querySelector(".event-transaction").textContent = event.transactionName || "";
    renderScope(row.querySelector(".event-scope"), event.scope);
    timeline.append(row);
  });
}

function renderScope(container, scope) {
  if (!scope) return;
  const values = [];
  if (scope.phase) values.push(`流程：${phaseLabel(scope.phase)}`);
  if (scope.verdict) values.push(`驗證：${verdictLabel(scope.verdict)}`);
  if (scope.attempt !== undefined) values.push(`執行：第 ${scope.attempt} 次`);
  if (scope.remainingCalls !== undefined) values.push(`剩餘呼叫：${scope.remainingCalls}`);
  if (scope.responseBytes !== undefined) values.push(`回傳：${formatBytes(scope.responseBytes)}`);
  if (scope.parameterName) values.push(`參數：${scope.parameterName}`);
  if (scope.stepCount !== undefined) values.push(`步驟：${scope.stepCount}`);
  if (scope.elementIds?.length) values.push(`元素：${scope.elementIds.join(", ")}`);
  if (scope.createdElementIds?.length) values.push(`建立：${scope.createdElementIds.join(", ")}`);
  if (scope.deletedElementIds?.length) values.push(`刪除：${scope.deletedElementIds.join(", ")}`);
  values.forEach((value) => {
    const item = document.createElement("span");
    item.textContent = value;
    container.append(item);
  });
}

function phaseLabel(phase) {
  return ({ planned: "已規劃", executing: "執行中", verifying: "驗證中", correcting: "修正中", passed: "完成", failed: "未通過", stopped: "已停止" })[phase] || phase;
}

function verdictLabel(verdict) {
  return ({ pending: "待驗證", passed: "通過", failed: "未通過", stopped: "停止", unverified: "未啟用" })[verdict] || verdict;
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${Math.round(bytes)} B`;
}

function statusLabel(status) {
  if (status === "cancelled") return "已取消";
  if (status === "failed") return "失敗";
  return "完成";
}

function humanizeTool(toolId = "") {
  return toolId.replace(/^(agent|builtin|saved|dynamic):/, "").replaceAll("_", " ").replaceAll("-", " ");
}

function formatDuration(value) {
  const duration = Number(value || 0);
  return duration >= 1000 ? `${(duration / 1000).toFixed(duration >= 10000 ? 0 : 1)} 秒` : `${Math.round(duration)} ms`;
}

function formatClock(value) {
  return new Intl.DateTimeFormat("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(new Date(value));
}

refresh();
setInterval(refresh, 2500);
