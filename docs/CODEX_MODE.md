# Codex + BIM Personal Agent

## 執行路徑

```text
使用者自然語言
  -> Codex
  -> bim-personal-agent（6 MCP tools）
  -> Agent Runtime（148-tool catalog + saved tools）
  -> localhost:9686
  -> BimPersonalAgent.RevitBridge.dll
  -> queued ExternalEvent / Transaction
  -> Revit 2024
```

Codex 是 V1 唯一 LLM。Gateway 不接模型 API，也不自行理解未結構化 prompt；Codex 先讀 live context、搜尋工具，再執行 existing/saved tool 或提交參數化 C#。

## 啟動

1. 安裝 V0.5 Add-in 並重新啟動 Revit 2024。
2. 開啟測試模型，在 `BIM Personal` 按「Agent服務 開/關」。
3. 執行 `python scripts\configure-codex-agent.py`，重新啟動 Codex 或建立新 task。
4. 呼叫 `get_agent_status`，確認 Bridge version、active document 與 catalog count。
5. 呼叫 `get_bim_context` 後再搜尋或執行工具。

## 路由指引

- `search_bim_tools` 預設搜尋 validated built-ins 與 active saved tools。
- 無合適工具時可明確搜尋 experimental tools，或使用 `execute_dynamic_csharp`。
- 效能與成功率是選擇依據，不是硬性 gate。
- Dynamic C# 成功後預設保存；下一個 task 透過 saved tool ID 重用，不重新生成 source。
- 正常 create/modify 不確認；破壞性操作的最終裁決與確認在 Revit Bridge。

同一個 Revit session 只允許一個 Gateway client。不要同時啟用 `revit-mcp` 與 `bim-personal-agent`。
