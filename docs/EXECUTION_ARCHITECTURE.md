# Execution Architecture

## Ownership

- Codex：自然語言、任務拆解、C# 生成。
- Gateway：六個 MCP tools、schema validation、catalog search、saved-tool store、telemetry。
- RevitBridge：single-flight queue、`ExternalEvent`、Revit API、Transaction、Undo、動態編譯與破壞性確認。
- Dockable Pane：共用同一 Bridge queue；V1 的文字 parser 只作離線 fallback。

Gateway 的早期驗證不能降低 Bridge 判定的風險。所有模型相關資料必須來自同回合 live Revit response。

## Tool Catalog

`gateway/src/catalog/builtin-tools.json` 固定保存 148 個 internal descriptors，建置時驗證唯一性。Codex 不直接載入這些 schemas，而是先搜尋，再以 `toolId + arguments` 執行。

狀態：

- `validated`：21 個預設核心工具。
- `experimental`：120 個可明確擴大搜尋的上游工具。
- `disabled`：7 個已知破壞性、跨文件覆寫或不適合目前容量邊界的工具。
- `active` / `draft`：本機保存工具。

## Operation Plan

每個 step 包含 `toolId`、可選版本、arguments、scope 與 atomic compatibility。Gateway 在送出前驗證全部 steps；Bridge 對同文件非破壞性 plan 使用一個 `TransactionGroup`，任一步失敗即 rollback。

跨文件、不可復原與已知破壞性 built-ins 不進 V1 atomic plan。破壞性 Dynamic C# 仍依未提交 Transaction 的實際 before/after IDs 顯示 Revit Yes/No。

## Persistence And Telemetry

工具庫使用 immutable version directories 與 atomic directory rename。Portable tool 禁止硬編 ElementId 與絕對路徑；project tool 需符合 SHA-256 project fingerprint。

Telemetry 僅記錄 timestamp、tool ID、duration、success、response bytes、error code 與 cache hit。三筆樣本、p95 3000 ms、95% success rate 是 routing guidance。

## Transport

Gateway 對 Revit request 排隊，最多一個 in flight。Bridge 拒絕第二個 WebSocket client。一般 timeout 30 秒，dynamic/plan 最長 120 秒；timeout 回報 `REVIT_COMMAND_TIMEOUT_UNCERTAIN`，不自動重試模型修改。
