# Revit 2024 官方來源與限制規則

這個檔案是 Codex/Revit MCP 測試模式的權威來源索引，不是完整文件鏡像。不得將 Autodesk 文件大批複製進專案；需要時讀取最小相關章節。

## 權威順序

1. 本機 Revit 2024 API XML reference：
   `C:\Program Files\Autodesk\Revit 2024\RevitAPI.xml`
2. [Autodesk Revit 2024 API Developer's Guide](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Revit_API_Developers_Guide_html.html)
3. [Autodesk Revit 2024 Help](https://help.autodesk.com/view/RVT/2024/ENU/)
4. `REVIT_MCP_study/domain/*.md` 的工作流程規則
5. 模型一般知識，只能用來提出查詢，不得直接形成模型資料或寫入值

## 必讀章節

- [Deployment Options and single-threaded API access](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Introduction/Getting_Started/Using_the_Autodesk_Revit_API/Revit_API_Revit_API_Developers_Guide_Introduction_Getting_Started_Using_the_Autodesk_Revit_API_Deployment_Options_html.html)
- [Dockable Dialog Panes and External Events](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Advanced_Topics/Revit_API_Revit_API_Developers_Guide_Advanced_Topics_Dockable_Dialog_Panes_html.html)
- [Transactions](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Basic_Interaction_with_Revit_Elements/Revit_API_Revit_API_Developers_Guide_Basic_Interaction_with_Revit_Elements_Transactions_html.html)
- [Add-in Registration](https://help.autodesk.com/cloudhelp/2024/ENU/Revit-API/files/Revit_API_Developers_Guide/Introduction/Add_In_Integration/Revit_API_Revit_API_Developers_Guide_Introduction_Add_In_Integration_Add_in_Registration_html.html)

## 限制方法

- API 實作問題先查本機 `RevitAPI.xml` 的 exact member signature，再查 Developer Guide 的 workflow。
- 目前專案的類別、參數、ID、值、數量、視圖與選取只能來自當回合 Revit MCP 回應。
- 參數查詢必須先取得 category，再取得 exact field name；禁止自行翻譯或猜測參數名稱。
- Revit 修改只能經 ExternalEvent 進入主執行緒，並在 Transaction 內執行。
- Autodesk 文件描述「API 可以怎麼做」；它不能證明目前模型「實際有什麼」。
- `REVIT_MCP_study` 的 domain 文件可以定義專業流程，但與 Autodesk API 或當前模型衝突時，必須停下並說明衝突。
