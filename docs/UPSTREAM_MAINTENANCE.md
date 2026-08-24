# REVIT_MCP_study 上游維護

BIM Personal Agent 是獨立產品，`REVIT_MCP_study` 是 Revit 工具與執行核心的上游來源。Fork 關係不負責控制執行程序；正式環境仍只能啟用一個 `BimPersonalAgent.addin` 與一個 `bim-personal-agent` MCP server。

## 目前基準

- 上游基準 commit：`cfe073951fa1e43792f9d93f015d7b82416df621`
- 內部 catalog：148 個工具
- 上游來源工具：146 個
- Agent 自有工具：`execute_dynamic_csharp`、`get_task_context`
- 固定版本與雜湊：`config/upstream-lock.json`
- 自動產生的最新差異：`docs/UPSTREAM_SYNC_REPORT.md`

## 只讀檢查

先在獨立的 `REVIT_MCP_study` checkout 執行 `git fetch`，再於 Agent repository 執行：

```powershell
node scripts\audit-revit-mcp-upstream.mjs `
  --upstream "E:\Desktop\Codex\REVIT_MCP_latest" `
  --ref origin/main `
  --write-report docs\UPSTREAM_SYNC_REPORT.md
```

也可設定 `REVIT_MCP_UPSTREAM_ROOT`，避免把個人絕對路徑寫進命令。稽核只讀取 Git object 與 Agent catalog，不會 checkout、merge 或修改上游 worktree。

## 安全同步

不要只更新 `builtin-tools.json`。每個上游工具至少涉及 MCP schema 與 Revit command runtime；部分工具還有 helper、model、dependency 或 Revit 版本差異。

同步順序：

1. 從差異報告選定要導入的工具與上游 commit。
2. 在獨立整合 branch 更新 `RevitBridge/Legacy` 與必要 dependency。
3. 執行 Gateway tests、.NET build 與 catalog/runtime parity test。
4. 在 Revit 執行 read-only smoke，再執行可 Undo 的 mutation smoke。
5. 使用 catalog importer 預覽結果。
6. runtime parity 通過後，才允許 importer 寫入 catalog。
7. 更新 `upstream-lock.json` 的 commit、工具數與兩個 SHA-256。

Importer 預設只預覽：

```powershell
node gateway\scripts\import-revit-catalog.mjs `
  --upstream-root "<clean-upstream>" `
  --module "<clean-upstream>\MCP-Server\build\tools\index.js" `
  --source-ref "<full-commit>" `
  --expected-upstream-count 167
```

完成 runtime parity 後才加入：

```text
--apply --ack-runtime-parity
```

這個確認只防止誤寫 catalog，不取代編譯、Revit smoke 或人工 code review。
