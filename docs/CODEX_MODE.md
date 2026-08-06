# Codex + BIM Personal Agent

## 執行路徑

```text
使用者自然語言
  -> Codex
  -> bim-personal-agent（6 MCP tools）
  -> Agent Runtime（146 upstream + 2 Agent tools + saved tools）
  -> localhost:9686
  -> BimPersonalAgent.RevitBridge.dll
  -> queued ExternalEvent / Transaction
  -> Revit 2024
```

Codex 是 V1 唯一 LLM。Gateway 不接模型 API，也不自行理解未結構化 prompt；Codex 先讀 live context，將需求整理為目標、對象、動作、限制與步驟，再提交結構化任務給 Gateway 搜尋工具。

## 啟動

1. 安裝 V0.6 Add-in 並重新啟動 Revit 2024。
2. 開啟測試模型，在 `BIM Personal` 按「Agent服務 開/關」。
3. 執行 `python scripts\configure-codex-agent.py`，重新啟動 Codex 或建立新 task。
4. 呼叫 `get_agent_status`，確認 Bridge version、active document 與 catalog count。
5. 呼叫 `get_bim_context` 後再搜尋或執行工具。

## 路由指引

- `search_bim_tools` 必須接收已理解並拆解的結構化任務，再由工具目錄路由到 validated built-ins 與 active saved tools。
- 一次搜尋會為每個任務步驟配對工具，並展開完成流程所需工具的完整 schema；其餘候選使用精簡摘要。只有未覆蓋或不適用的步驟才再細化一次。
- Dynamic C# 是逐步驟的實作路由：只補上沒有合適工具或既有路徑效能劣化的步驟，其餘步驟繼續使用現有工具。
- 無合適工具時可明確搜尋 experimental tools，或使用 `execute_dynamic_csharp`。
- 效能與成功率是選擇依據，不是硬性 gate。
- Dynamic C# 成功後預設保存；下一個 task 透過 saved tool ID 重用，不重新生成 source。
- 正常 create/modify 不確認；破壞性操作的最終裁決與確認在 Revit Bridge。

## Harness 使用邊界

- 一般任務不啟用 Loop，也不被 snapshot、驗證 DSL 或修正預算包住。
- 只有需要明確驗收證據或有限自動修正時，第一次搜尋才設定 `startLoop=true`；後續以同一 `runId` 執行 plan。
- `domain`、`acceptanceCriteria` 與 `evidenceRequirements` 用來幫助 Codex規劃，不要求模型填滿不相關項目。
- 驗證檢查只加入足以證明任務完成的最小集合。每輪只修正一個有證據支持的假設。
- Gateway 以呼叫次數、搜尋次數、回傳 bytes、編譯數、修正次數與時間控制成本，不宣稱取得精確 token 數。
- Dynamic C# 可放在任一未覆蓋步驟；Loop 內通過驗證才成為 active，Loop 外維持成功即保存。

同一個 Revit session 只允許一個 Gateway client。不要同時啟用 `revit-mcp` 與 `bim-personal-agent`。

## 任務回報

- `search_bim_tools` 會建立或沿用 `taskId`；後續 `run_bim_tool`、`run_bim_plan` 或 `execute_dynamic_csharp` 應沿用同一個 `taskId`。
- Gateway 回應包含 `executionStatus`、`verificationStatus` 與 `reportUrl`，Codex 只需回傳工程師需要的摘要。
- Revit Bridge 在排隊、執行、完成或失敗時送出進度事件；完整事件保存在本機工作台，不增加 MCP 工具數量。
