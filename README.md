# BIM Personal Agent

Revit 2024 個人執行代理。Codex 負責自然語言與必要的 C# 生成；本機 Gateway 負責工具搜尋、參數驗證、保存工具與 telemetry；單一 Revit Add-in 負責 queue、`ExternalEvent`、`Transaction`、Undo 與破壞性確認。

[用圖解了解 BIM Personal Agent 如何運作](https://nichesam.github.io/BIM-personal-agent/)

```text
Codex -> BIM Personal Agent MCP Gateway -> localhost:9686
      -> BIM Personal Agent RevitBridge -> Revit API -> Revit 2024
```

V0.5 不使用模型 API Key。Revit 側邊欄保留本機選取檢查與參數修改，未來接模型 API 時共用同一 Runtime。

## 一般使用者安裝

一般 BIM 工程人員請下載 [最新 Windows 安裝包](https://github.com/NicheSam/BIM-personal-agent/releases/latest/download/BIMPersonalAgent-v0.5.0-win-x64.zip)，不要使用 GitHub 的 `Source code (zip)`。

1. 解壓縮 `BIMPersonalAgent-v0.5.0-win-x64.zip`。
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

上游 148 個 Revit 工具位於內部 catalog：21 個 `validated`、120 個 `experimental`、7 個 `disabled`。保存的 C# 不會擴增 MCP schema，而是透過 `search_bim_tools` 與 `run_bim_tool` 重用。

工具搜尋不是直接拿使用者句子反覆查詢。Codex 會先整理目標、BIM 對象、動作、限制與步驟，再由 Gateway 分到工具目錄；一次只回傳一個完整建議工具與精簡候選，第一次不適用時最多再細化搜尋一次。

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
- 讀取目前專案與 active view，建立本次 BIM 操作 context。

Skill 不會啟動第二個模型服務，也不會改用 raw `revit-mcp`。

### 活動控制台

```powershell
npm.cmd --prefix gateway run console:start
```

控制台預設位於 `http://127.0.0.1:4178`，依事件順序顯示 Agent 動作、結果、影響範圍、Transaction 與耗時。控制台不顯示 prompt、完整 arguments、參數值、動態 C# 原始碼或 MCP schema。

## 本機資料

```text
%APPDATA%\BIMPersonalAgent\config\
%APPDATA%\BIMPersonalAgent\tools\<tool-id>\<version>\
%APPDATA%\BIMPersonalAgent\telemetry\
%APPDATA%\BIMPersonalAgent\audits\
%APPDATA%\BIMPersonalAgent\events\activity.jsonl
%APPDATA%\BIMPersonalAgent\logs\
```

Performance telemetry 不保存 prompt、arguments 或模型回應。保存工具包含 `manifest.json` 與 `command.cs`；project-bound 工具只能在相同 project fingerprint 執行。

## 邊界

- 僅支援 Revit 2024、單一 Revit session、單一 active document。
- 一般 read/create/modify 不確認；delete、purge、overwrite、破壞性取代及不可 Undo 操作需在 Revit 顯示範圍並確認。
- 動態 C# 禁止檔案、網路、程序、反射、P/Invoke、threading、assembly loading、document save/open 與自行建立 Transaction。
- MCP timeout 無法安全終止已進入 Revit UI thread 的程式；明顯無限迴圈會被拒絕，但本 runtime 不是完整沙箱。
- 148 個上游工具的程式來源已納入 `BimPersonalAgent.RevitBridge`，保留 MIT attribution；`REVIT_MCP_latest` 不再是執行時依賴。

參考：[Codex 模式](docs/CODEX_MODE.md)、[執行架構](docs/EXECUTION_ARCHITECTURE.md)、[動態 C#](docs/DYNAMIC_CSHARP.md)、[遷移基準](docs/MIGRATION_BASELINE.md)、[Live smoke](docs/LIVE_SMOKE_2026-07-13.md)、[架構決策](docs/decisions/ADR-001-agent-gateway-and-single-bridge.md)。
