# BIM Personal Agent

BIM Personal Agent 是給 Revit 2024 單機工作流程使用的本機執行代理。使用者在 Codex 描述工作；Gateway 負責工具搜尋、參數驗證、工具記憶、任務狀態與遙測；Revit Add-in 透過 `ExternalEvent` 與 host-owned `Transaction` 執行，並保留 Revit 原生 Undo 與破壞性確認。

[圖解介紹與安裝說明](https://nichesam.github.io/BIM-personal-agent/) · [GitHub Releases](https://github.com/NicheSam/BIM-personal-agent/releases)

```text
Codex -> BIM Personal Agent MCP Gateway -> localhost:9686
      -> BIM Personal Agent RevitBridge -> Revit API -> Revit 2024
```

目前版本為 **v0.9.0**，安裝包包含原生族群建模 2.0.3 與參數化電盤建模 1.1.0。這些新增工具仍標示為 experimental；ModelText 批次功能仍待實機驗證。公開 MCP 介面仍維持六個工具。完整更新與限制見 [v0.9.0 發布說明](release/RELEASE_NOTES_V0.9.0.md)。

原生族群工具的已測試操作與限制見 [family authoring](docs/family-authoring.md)。參數化電盤的幾何與連接埠已有先前實機驗證紀錄，但新增 ModelText 批次功能仍待實機驗證，見 [parametric cabinet authoring](docs/parametric-cabinet-authoring.md)。

## 適合誰

- 使用 Revit 2024、希望由 Codex 協助執行重複 BIM 工作的單人工程師。
- 需要把一次成功的 Dynamic C# 轉成可搜尋、可帶不同參數重用工具的人。
- 需要在執行前掌握文件、視圖、選取與範圍，執行後保留 Transaction、模型影響與驗證紀錄的人。

它不是多人雲端協作平台、Revit 內聊天視窗、通用 Revit 資料庫瀏覽器，也不是無限制執行任意 C# 的沙箱。

## 主要能力

- **工具搜尋與重用**：152 個內部工具，包括 146 個固定上游工具與 6 個 Agent 自有工具；相同 saved-tool source hash 不會產生重複版本或重複編譯。
- **Element Lens**：以 `builtin:inspect_element_context` 唯讀取得單一元素的 identity、instance/type parameters、位置、輕量幾何、關聯及 view/sheet context。
- **安全目標判定**：區分目前選取、明確 ElementId、候選覆核、工具回傳與新建元素；只有一個可證明的目標才會自動追蹤。
- **Dynamic C#**：由 Revit host 管理 Transaction；禁止檔案、網路、程序、反射、P/Invoke、threading、assembly loading 與 document save/open。
- **工程師工作台**：在 `http://127.0.0.1:4178` 顯示任務摘要、執行結果、模型影響、驗證、Transaction 與可展開資料。
- **有限 Harness**：只在明確要求證據、自動修正或 `startLoop=true` 時啟用，並受次數、時間及修改範圍限制。

## 一般使用者安裝

下載 [BIMPersonalAgent-v0.9.0-win-x64.zip](https://github.com/NicheSam/BIM-personal-agent/releases/download/v0.9.0/BIMPersonalAgent-v0.9.0-win-x64.zip)，不要使用 GitHub 自動產生的 `Source code (zip)`。同一發布頁提供 SHA-256 校驗檔。

1. 解壓縮安裝包。
2. 關閉 Revit 2024 與 Codex Desktop。
3. 執行 `install.bat -CheckOnly`，確認環境與安裝目標。
4. 通過後執行 `install.bat`。
5. 開啟 Revit 2024 與目標模型，在 Ribbon 啟動 Agent service。
6. 重新開啟 Codex Desktop，在新 task 輸入 `$bim-agent`。

安裝包包含 portable Node.js、production Gateway、Console、預建 Revit DLL 與 `bim-agent` skill；一般使用者不需要另裝 Node.js、npm、Python 或 .NET SDK，也不需要系統管理員權限。安裝器會先備份既有 runtime、Add-in 與 skill；Revit 執行中時不會覆寫載入中的 DLL。

## 日常工作方式

1. Agent 先確認 Gateway／Bridge 版本、active document、active view 與必要 selection。
2. 簡單工作只搜尋一次；優先使用既有或 saved tool。
3. 沒有合適工具時，才針對缺口執行受限 Dynamic C#。
4. 模型修改應先限定範圍，執行後讀回必要結果，並回報 Undo 方式。
5. 文件切換、timeout、狀態不確定、範圍超限或可能改變設計意圖時停止。

工作台是非同步觀測層，不是執行權威。若摘要與 Bridge 回應或 Revit readback 衝突，以 Bridge 回應與實際模型狀態為準。

## MCP 與內部工具

Codex 固定只看見六個公開工具：

- `get_agent_status`
- `get_bim_context`
- `search_bim_tools`
- `run_bim_tool`
- `run_bim_plan`
- `execute_dynamic_csharp`

內部 catalog 有 152 個工具：146 個來自固定版本的 `REVIT_MCP_study` runtime，6 個 Agent 自有工具為 `execute_dynamic_csharp`、`get_task_context`、`inspect_element_context`、`create_family_file`、`create_lighting_family_file`、`create_parametric_cabinet_files`。目前狀態為 22 個 `validated`、123 個 `experimental`、7 個 `disabled`。保存的 C# 透過 `search_bim_tools` 與 `run_bim_tool` 重用，不會增加公開 MCP schema。

## Element Lens 的功能邊界

- 只讀，不修改模型。
- 需要明確 ElementId 或恰好一個選取元素；空選取或多選不猜測。
- 預設回傳 summary，需要參數工作才提升到 parameters，診斷才使用 bounded full。
- `maxParameters` 限制回傳量；`maxViewsScanned` 目前保留，並不啟動專案全視圖掃描。
- 保留原始 Revit API 名稱；在地化顯示只能附加，不能覆蓋原始名稱。
- 它不是 RevitParameterInspector 的 UI、匯出器或第二套 Add-in。

## 功能與責任邊界

- **Codex**：理解需求、選工具、組合流程、產生必要 C#、判讀證據。
- **Gateway**：公開 MCP contract、schema validation、搜尋、工具記憶、政策與 telemetry。
- **RevitBridge**：最終安全裁決、queue、`ExternalEvent`、Transaction、Undo 與模型 readback。
- **Console**：顯示背景保存的任務與證據，不參與 Revit Transaction。
- **Skill**：啟動與檢查 Agent，不能取代 Bridge 安全政策，也不代表可任意修改模型。

目前只支援 Revit 2024、單一 Revit session 與單一 active document。MCP timeout 無法安全終止已進入 Revit UI thread 的程式，因此 timeout 後不自動重試。delete、purge、overwrite、破壞性取代及不可 Undo 操作仍需明確範圍與 Revit 原生確認。

## 上游、設計來源與致謝

### REVIT_MCP_study

[shuotao/REVIT_MCP_study](https://github.com/shuotao/REVIT_MCP_study) 是本專案 Revit 工具 runtime 的母專案。BIM Personal Agent 固定使用 commit [`cfe073951fa1e43792f9d93f015d7b82416df621`](https://github.com/shuotao/REVIT_MCP_study/commit/cfe073951fa1e43792f9d93f015d7b82416df621) 的 146 個工具，並在其上加入 Gateway、queue、Dynamic C#、安全政策、工具記憶、Element Lens 與工作台。感謝原作者與貢獻者以 MIT License 開放此基礎。

`config/upstream-lock.json` 記錄固定 commit、Agent overlay、工具數與 source SHA-256。上游更新只會先稽核，不會自動 merge 或直接發布。正式安裝只載入 BIM Personal Agent Add-in，不需要另一份上游 checkout 或服務。詳見[上游維護](docs/UPSTREAM_MAINTENANCE.md)與[架構決策](docs/decisions/ADR-003-pinned-upstream-runtime.md)。

### RevitParameterInspector

[laytonluo/RevitParameterInspector](https://github.com/laytonluo/RevitParameterInspector) 是 Element Lens 的重要設計與能力移植來源。BIM Personal Agent 採納其結構化元素 context、instance/type parameter 分離、位置／幾何／關聯／view-sheet reader 思路與 AI 可讀輸出方向，再依 Gateway 的單一目標、分級深度、token 邊界與 readback 流程重新整合。

本專案沒有併入 RevitParameterInspector 的 WPF UI、Ribbon、Excel／Markdown 匯出器或獨立 Add-in；執行時也不依賴它。感謝原作者與貢獻者以 MIT License 提供可研究與移植的實作。完整授權與來源聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 原始碼建置

需求：Windows、Autodesk Revit 2024、.NET SDK 10、Node.js 22 以上與 npm。建置會從標準 Revit 2024 安裝位置參考 Autodesk DLL，但不會把 Autodesk DLL 納入 repository。

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

建置會執行 Gateway／Console 測試、C# 核心測試、RevitBridge 建置與 registry 驗證，輸出到：

```text
artifacts\BimPersonalAgent.Revit2024\
artifacts\BimPersonalAgent.Gateway\
```

建立一般使用者安裝包：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-release.ps1 -Version 0.9.0
```

其他診斷命令：

```powershell
npm.cmd --prefix gateway run smoke:mcp
npm.cmd --prefix gateway run console:start
npm.cmd --prefix gateway run smoke:live
```

`smoke:live` 需要 Revit 已開啟模型且 Agent service 已啟動。source build、測試通過、已安裝 DLL 與 live Revit smoke 是不同驗證層級，不能互相替代。

## Repository 結構

```text
gateway/     MCP Gateway、catalog、policy、tool store、tests
console/     本機工程師工作台
src/         RevitBridge、Revit Add-in、C# tests
skills/      $bim-agent skill
config/      tool registry、upstream lock、policy
docs/        架構、維護、決策與 GitHub Pages
release/     安裝器模板與 release notes
scripts/     build、package、upstream audit
```

## 本機資料與隱私

設定、saved tools、telemetry、task details 與 logs 位於 `%APPDATA%\BIMPersonalAgent\`。Performance telemetry 不保存 prompt、完整 arguments 或模型回應。Developer Trace 必須明確啟用且最多保存七天；認證資料不保存。Console 對 Codex session 的背景關聯只回傳任務識別與 token 數字，不顯示 prompt、完整 schema、動態 C# 原始碼、本機絕對路徑或帳號資料。

## English summary

BIM Personal Agent is a local Revit 2024 execution agent for Codex. It exposes six stable MCP tools, keeps 152 Revit operations in a searchable internal catalog, supports bounded Dynamic C# and saved-tool reuse, and records task-level model impact and verification in a local workbench. Release v0.9.0 includes native family authoring 2.0.3 and parametric cabinet authoring 1.1.0. These authoring tools remain experimental; batch ModelText runtime verification remains pending. See the linked authoring documents and release notes for tested operations and limitations.

## 授權與第三方聲明

BIM Personal Agent 自有程式碼採用 [MIT License](LICENSE)，版權標示為 `Copyright (c) 2026 BIM Personal Agent contributors`。MIT License 允許使用、複製、修改、合併、發布、散布、再授權及銷售，但必須在軟體副本或重要部分保留原版權與授權聲明，且軟體不提供任何保證。

MIT License 只涵蓋本專案有權授權的內容，不會改寫 Autodesk Revit、portable Node.js、`REVIT_MCP_study`、`RevitParameterInspector` 或其他相依套件各自的授權。完整第三方來源、固定版本與聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
