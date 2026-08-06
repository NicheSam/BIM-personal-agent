# BIM Personal Agent

Revit 2024 個人執行與回報代理。Codex 負責自然語言與必要的 C# 生成；本機 Gateway 負責工具搜尋、參數驗證、保存工具、任務狀態與 telemetry；單一 Revit Add-in 負責 queue、`ExternalEvent`、`Transaction`、Undo、破壞性確認與即時進度回報。

[用圖解了解 BIM Personal Agent 如何運作](https://nichesam.github.io/BIM-personal-agent/)

```text
Codex -> BIM Personal Agent MCP Gateway -> localhost:9686
      -> BIM Personal Agent RevitBridge -> Revit API -> Revit 2024
```

目前版本為 **v0.8.0**。產品不使用模型 API Key，也不在 Revit 內維護第二套文字輸入或參數編輯器。任務從 Codex 輸入，執行紀錄由瀏覽器工作台非同步回報；Revit Ribbon 只保留 Agent 服務開關，破壞性操作仍由 Revit 原生對話框確認。

v0.8.0 已在 Revit 2024 實機確認 Gateway/Bridge 版本一致、既有唯讀工具可執行、active-view 視圖覆寫可 Undo、68 個選取元素可完整讀回驗證，且相同 saved-tool source hash 第二次執行會命中 session compilation cache，不建立重複工具版本。詳見 [v0.8.0 release notes](release/RELEASE_NOTES_V0.8.0.md)。

## 一般使用者安裝

一般 BIM 工程人員請下載 [v0.8.0 Windows 安裝包](https://github.com/NicheSam/BIM-personal-agent/releases/download/v0.8.0/BIMPersonalAgent-v0.8.0-win-x64.zip)，不要使用 GitHub 的 `Source code (zip)`。

1. 解壓縮 `BIMPersonalAgent-v0.8.0-win-x64.zip`。
2. 關閉 Revit 2024 與 Codex Desktop。
3. 執行 `install.bat -CheckOnly`。
4. 檢查通過後執行 `install.bat`。
5. 重新開啟 Revit 與 Codex，在新 task 輸入 `$bim-agent`。

使用者安裝包已包含 portable Node.js、production Gateway、預建 Revit DLL 與 skill；同事不需要另裝 Node.js、npm、Python 或 .NET SDK，也不需要系統管理員權限。

## MCP 工具

Codex 固定只看見六個工具：

- `get_agent_status`
- `get_bim_context`
- `search_bim_tools`
- `run_bim_tool`
- `run_bim_plan`
- `execute_dynamic_csharp`

內部 catalog 目前有148個工具：146個來自固定版本的 `REVIT_MCP_study` runtime，另有 `execute_dynamic_csharp`、`get_task_context` 兩個 Agent 自有工具；狀態為21個 `validated`、120個 `experimental`、7個 `disabled`。保存的 C# 不會擴增 MCP schema，而是透過 `search_bim_tools` 與 `run_bim_tool` 重用。

工具搜尋不是直接拿使用者句子反覆查詢。Codex 會先整理目標、BIM 對象、動作、限制與步驟，再由 Gateway 為每個步驟設計工具流程；一次回傳完成任務所需工具的完整 schema，其他候選保持精簡。只有未覆蓋或不適用的步驟才再細化搜尋一次，仍無工具時只在該步驟加入 Dynamic C#，不重寫整個流程。

### 有限 Harness

Harness 預設不介入一般工作。普通讀取、建立、修改、單次 plan 與 Dynamic C# 維持原本直接路徑；只有任務明確要求驗收證據、自動修正，或呼叫端設定 `startLoop=true` 時才建立 run。啟用後標準任務最多兩次執行，明確標記的複雜任務最多三次，並以搜尋、MCP 呼叫、Dynamic C#、修改範圍與十分鐘作為成本上限。Codex 保留選工具、組合流程、產生 C#、設計驗證及根據證據重新規劃的自由；Gateway 只在 timeout、文件切換、重複錯誤、破壞性需求、範圍超限或結果不確定時硬停止。領域 profile 與驗證項目是方向建議，不是固定工作表或領域禁令。

## 原始碼開發需求

- Windows 與 Autodesk Revit 2024。
- .NET SDK 10（用於建置 `net48` RevitBridge 與 Revit Add-in）。
- Node.js 22 以上與 npm。
- Codex Desktop 或支援 stdio MCP server 的 Codex 環境。

建置時會從標準安裝位置 `C:\Program Files\Autodesk\Revit 2024` 參考 `RevitAPI.dll` 與 `RevitAPIUI.dll`，不會把 Autodesk DLL 納入 repository。

## 建置

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

建置會執行 Gateway 測試、C# 核心測試、完整 RevitBridge 建置、registry 驗證，並輸出：

```text
artifacts\BimPersonalAgent.Revit2024\
artifacts\BimPersonalAgent.Gateway\
```

MCP protocol 與本機 overhead smoke：

```powershell
cd gateway
npm.cmd run smoke:mcp
```

Revit 開啟模型且 Agent 服務啟動後，執行 read-only live smoke：

```powershell
cd gateway
npm.cmd run smoke:live
```

開發時可透過同一 MCP Gateway 診斷單一公開工具：

```powershell
npm.cmd run call:live -- get_agent_status '{}'
```

## 上游 REVIT_MCP_study

BIM Personal Agent 維持獨立產品 repository，`REVIT_MCP_study` 作為固定版本、唯讀追蹤的上游執行核心。Fork 或保留上游 checkout 不代表執行兩套服務；正式安裝仍只載入 Agent Add-in，Codex 仍只連六工具 Gateway。

`config/upstream-lock.json` 記錄上游 commit、Agent overlay、工具數及 vendored source SHA-256。`scripts/audit-revit-mcp-upstream.mjs` 可比較最新上游，但不會自動 merge 或發布工具。只有對應的 C# runtime 通過 build、parity 與 Revit smoke 後，catalog importer 才允許明確寫入。詳見[上游維護](docs/UPSTREAM_MAINTENANCE.md)與[架構決策](docs/decisions/ADR-003-pinned-upstream-runtime.md)。

## 從原始碼安裝

```powershell
install.bat -CheckOnly
install.bat
```

Repository 根目錄的 `install.bat` 是開發者版本，會從原始碼建置，因此需要 Node.js 22+ 與 .NET SDK 10。一般使用者應使用 GitHub Release 內附的 `install.bat`，兩者用途不同。

### BIM Agent skill

專案內含 `skills/bim-agent`。安裝到 Codex 個人 skills 目錄後，可在新 task 輸入 `$bim-agent` 或「啟用 BIM Agent」完成以下流程：

- 檢查 Revit 2024 與 localhost Bridge。
- 開啟 BIM 工程師使用的唯讀活動控制台。
- 只在任務需要選取、active view、樓層或專案識別時讀取對應 context。

Skill 不會啟動第二個模型服務，也不會改用 raw `revit-mcp`。

### BIM Agent 工作台

```powershell
npm.cmd --prefix gateway run console:start
```

工作台預設位於 `http://127.0.0.1:4178`。v0.8.0 以通用 execution envelope 保存輸入來源、原始與正規化結果、限定範圍的模型前後狀態、Transaction、元素變更、資料血緣、claim-based verification 與錯誤層。摘要會顯示實際修改元素與已覆核元素數量；舊任務若保留一致的 `AppliedCount`、`VerifiedCount` 與 `ElementIds`，讀取時也會安全投影。摘要、輸入、結果、驗證、Raw JSON 五頁與 Run Diff 只屬於觀測層，不是工具執行的必經流程。

一般任務採最短路徑：先理解、搜尋一次、直接執行。只有複雜、高風險、失敗或明確要求驗證的任務才建立 plan、readback 或有限修正。Console、Evidence Mode、Domain Renderer 與詳細 JSON 由背景佇列保存，不阻塞主要 Revit 回應。完整契約與案例見[工作台觀測架構](docs/OBSERVABILITY_V3.md)。

每個可關聯的任務會顯示本機 Codex session 實際記錄的未快取輸入、快取輸入、輸出與總 Token。Token 關聯在背景執行，不阻塞 Revit 狀態回報；無法透過 Gateway `requestId` 證明關聯時顯示尚未關聯，不以 bytes 推估。工作台不顯示 prompt、完整 arguments、參數值、動態 C# 原始碼或 MCP schema。

## 本機資料

```text
%APPDATA%\BIMPersonalAgent\config\
%APPDATA%\BIMPersonalAgent\tools\<tool-id>\<version>\
%APPDATA%\BIMPersonalAgent\telemetry\
%APPDATA%\BIMPersonalAgent\audits\
%APPDATA%\BIMPersonalAgent\events\activity.jsonl
%APPDATA%\BIMPersonalAgent\tasks\<task-id>\summary.json
%APPDATA%\BIMPersonalAgent\tasks\<task-id>\events.jsonl
%APPDATA%\BIMPersonalAgent\tasks\<task-id>\details\<request-id>.json
%APPDATA%\BIMPersonalAgent\developer-traces\<task-id>\<request-id>.json
%APPDATA%\BIMPersonalAgent\logs\
```

Performance telemetry 不保存 prompt、arguments 或模型回應。保存工具包含 `manifest.json` 與 `command.cs`；project-bound 工具只能在相同 project fingerprint 執行。

Developer Trace 必須明確啟用，最多保存七天；認證資料即使在 Developer Mode 也不保存。公開工作台與 Evidence Mode 不顯示 prompt、完整 schema、原始程式碼、本機絕對路徑或帳號資料。

控制台會唯讀掃描 `%USERPROFILE%\.codex\sessions` 中的 `session_meta`、`turn_context`、`mcp_tool_call_end` 與 `token_count`，只回傳任務識別與 Token 數字，不回傳 prompt、工具參數、專案路徑或 session 原文。

## 邊界

- 僅支援 Revit 2024、單一 Revit session、單一 active document。
- Console 是非同步觀測層；Gateway/Bridge 回應與 Revit 實際模型狀態才是執行結果的權威來源。
- 一般 read/create/modify 不確認；delete、purge、overwrite、破壞性取代及不可 Undo 操作需在 Revit 顯示範圍並確認。
- 動態 C# 禁止檔案、網路、程序、反射、P/Invoke、threading、assembly loading、document save/open 與自行建立 Transaction。
- MCP timeout 無法安全終止已進入 Revit UI thread 的程式；明顯無限迴圈會被拒絕，但本 runtime 不是完整沙箱。
- 146 個上游工具與2個 Agent 自有工具已納入 `BimPersonalAgent.RevitBridge` 的148工具內部 catalog，保留 MIT attribution；上游 checkout 不再是執行時依賴。

參考：[Codex 模式](docs/CODEX_MODE.md)、[執行架構](docs/EXECUTION_ARCHITECTURE.md)、[動態 C#](docs/DYNAMIC_CSHARP.md)、[遷移基準](docs/MIGRATION_BASELINE.md)、[上游維護](docs/UPSTREAM_MAINTENANCE.md)、[Live smoke](docs/LIVE_SMOKE_2026-07-13.md)、[Gateway 架構決策](docs/decisions/ADR-001-agent-gateway-and-single-bridge.md)、[Thin Harness 決策](docs/decisions/ADR-002-thin-harness-and-local-token-attribution.md)、[上游固定版本決策](docs/decisions/ADR-003-pinned-upstream-runtime.md)。
