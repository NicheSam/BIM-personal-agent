# Dynamic C# Runtime

Dynamic C# 在 Revit UI thread 內編譯與執行。Host 擁有 Transaction；生成程式只實作 `IDynamicRevitCommand`。

```csharp
using Autodesk.Revit.DB;
using RevitMCP.Core;

public sealed class GeneratedCommand : IDynamicRevitCommand
{
    public DynamicCommandMetadata Describe(DynamicRevitContext context)
    {
        return DynamicCommandMetadata.Reversible("Set a parameter from validated inputs");
    }

    public object Execute(DynamicRevitContext context)
    {
        string value = context.Inputs.Value<string>("value");
        return new { Value = value, SelectedCount = context.SelectedElementIds.Count };
    }
}
```

Gateway 先用 manifest 的 JSON schema 驗證 `arguments`，Bridge 再把資料放入 `context.Inputs`。Source hash compilation cache 每個 Revit session 保留全部 50 筆已編譯 source；相同 source 不重複編譯或建立工具版本。

## Saved Tool

`execute_dynamic_csharp` 需要 manifest。成功執行後預設保存為 `active`；執行失敗但已通過編譯可保存為 `draft`；編譯或 policy 失敗不進工具庫。同 tool ID 的新 source 建立下一個 patch version。

Portable source 禁止硬編 `new ElementId(<literal>)` 與絕對 Windows path。需要固定專案資料時使用 `binding=project`，並由 Gateway 綁定目前 project fingerprint。

## Required Boundaries

- 禁止 file、network、process、registry、reflection、P/Invoke、threading、unsafe、assembly loading、document save/open。
- 禁止自行建立 Transaction、fields、events、constructors、async、明顯無界 `while(true)`、`do...while(true)`、`for(;;)`。
- Source 上限 60,000 characters，破壞性 scope 上限 5,000 elements。
- `Document.Delete` 必須在 `Describe()` 宣告 destructive targets。
- Host 比較執行前後 element IDs，在未 commit 的 Transaction 中顯示實際刪除與建立範圍；No 會 rollback。

Audit 位於 `%APPDATA%\BIMPersonalAgent\audits\DynamicCSharp\YYYYMMDD`。MCP timeout 不能強制取消 Revit UI thread；這是受控本機 runtime，不是完整安全沙箱。
