# 產品定義：BIM Personal Agent v0.8.1

## 決策

建立共用的本機 BIM Agent Runtime。V1 以 Codex 作為唯一 LLM，對外只提供六個穩定 MCP tools；149個內部工具（146個固定上游工具加3個 Agent 自有工具）與成功保存的 C# 都留在可搜尋的內部 catalog。Revit 內不提供另一套文字指令或參數修改介面，避免繞過 Gateway、Tool Store 與任務回報。

## 使用者與核心流程

目標使用者是使用 Revit 2024 的單人工程師。核心流程：

1. 使用者在 Codex 輸入自然語言任務。
2. Codex 讀取 live BIM context 並搜尋 existing/saved tools。
3. 有合適工具就直接執行；沒有時產生參數化 C#。
4. 一般建立與修改直接執行並保留 Undo；破壞性工作由 Revit 顯示實際範圍並確認。
5. 成功的 C# 保存並版本化，下一個 Codex task 可直接搜尋與重用。

## V1 範圍

In scope：

- Revit 2024、單一 Revit session、單一 active document。
- Codex MCP Gateway、149-tool internal catalog、saved-tool store 與 performance telemetry。
- 唯讀 Element Lens、分級 context、單一目標判定與安全自動追蹤。
- 單一 BIM Personal Agent Add-in、共用 queue、`ExternalEvent`、host-owned Transaction 與 Undo。
- Revit Ribbon 的 Agent 服務開關與破壞性操作原生確認。
- Dynamic C# schema inputs、project binding、source audit、版本與 session compilation cache。
- saved-tool capability/source hash 重用、50 筆 session compilation cache 與剩餘容量回報。
- 工程師工作台的任務摘要、模型影響、已覆核元素、Transaction、耗時與可展開執行資料。
- 同文件非破壞性多步驟計畫，以 `TransactionGroup` 原子提交或 rollback。

Out of scope：

- Revit 2022/2023/2025 以上版本與多個 Revit sessions。
- 側邊欄模型 API、供應商選擇、API key、計費、帳號與多人協作。
- Revit 內獨立的自然語言輸入、選取檢查與參數編輯器。
- 跨文件原子計畫、不可復原操作的自動執行與完整作業系統沙箱。
- Python、外部程序、網路、檔案、反射、P/Invoke 或任意 assembly loading。

## 產品邊界

- Gateway 負責公開 MCP contract、schema validation、搜尋、保存與 telemetry；RevitBridge 是最終安全裁決。
- `validated` 是預設搜尋範圍；`experimental` 只能明確擴大搜尋；`disabled` 不可執行。
- Legacy built-in 若標記為 `destructive`，在能先證明實際範圍前一律拒絕。破壞性需求改用實作 `Describe()` 的 Dynamic C#。
- Dynamic C# 使用 `context.Inputs`，不得自行建立 Transaction。timeout 後不自動重試，因為已進入 Revit UI thread 的結果可能不確定。
- Tool Store 保存 source，不保存動態 DLL。Portable tool 禁止硬編 ElementId 或絕對路徑；project tool 只可在同一 project fingerprint 執行。
- Console 是非同步觀測層，不參與 Revit Transaction；若摘要與 Bridge/Revit readback 衝突，以 Bridge 回應與實際模型狀態為準。
- generic saved-tool 只有在 `AppliedCount`、`VerifiedCount` 與唯一 `ElementIds` 完全一致時，才可投影為完整修改與覆核；不一致必須保留失敗或未知狀態。
- Autodesk Revit 2024 官方操作與 API 文件是權威資料；domain/skill 文件只作指引，不作不必要的硬性限制。

## 成功標準

- Codex 只看見六個 Agent tools，能查 context、搜尋並執行 existing tool。
- 無合適工具時能執行 Dynamic C#，成功後保存為 active。
- 新 Codex task 能搜尋同一 saved tool，以不同 arguments 重用。
- 相同 saved-tool source hash 在同一 Revit session 只編譯一次，後續執行命中 cache 且不新增工具版本。
- Console 能正確呈現修改元素與已覆核元素數量，既有 v3 task detail 也能安全相容。
- 取消破壞性確認時模型不變；確認時只影響已顯示的實際範圍。
- 計畫中任一步失敗時 `TransactionGroup` 完整 rollback。
- Gateway/Bridge 額外 overhead p95 小於 250 ms；一般 context/tool call 參考目標 p95 小於 3 秒。
- Revit Addins 最終只保留 BIM Personal Agent manifest，Codex 最終只啟用 `bim-personal-agent`。

## 停止或轉向條件

- 真實任務多數無法在 Dynamic C# policy 內安全完成。
- 重複工作無法轉為參數化 saved tools，長期每次都必須重新生成 source。
- Bridge overhead 或 Revit UI thread 阻塞使主要操作無法達到可接受的互動速度。
- 使用者主要工作需要多文件、多 Revit session 或不可 Undo 的批次處理。

未來只有在 Revit 內確實需要「目前任務、連線狀態、破壞性確認」時，才重新建立精簡狀態面板；不得加入第二套 parser、catalog、router、tool store 或 Revit dispatcher。
