# BIM Personal Agent

Personal Autodesk/Revit agent concept and execution plan.

## Status

Planning and validation stage. No production code yet.

## Purpose

This project defines a focused MVP for a personal BIM automation agent inspired by BIMGO AI-style workflows:

- natural-language task input
- task planning
- reviewed Revit tool execution
- local skill storage
- reusable personal automation flows

The first version is intentionally narrow. It targets Revit first, not the full Autodesk ecosystem.

## Planned MVP

The V0.1 product shape is a Revit side panel with four tabs:

- Agent: command input, task plan, confirmation, execution log
- Tools: reviewed Revit tools and parameter schemas
- Skills: saved workflows that can be rerun
- Context: active model, active view, selected elements, standards files

## First Tool Set

- Get selected elements
- Get element info
- Query elements by category or view
- Set parameter value
- Batch rename views
- Apply view template
- Create simple pipe from two points
- Read connector info
- Save skill
- Run saved skill

## Safety Principles

- AI selects from reviewed tools instead of executing arbitrary generated code.
- Mutating actions require user confirmation.
- Every execution is logged.
- Early tests should run on copied models, not production files.

## Repository Structure

Current:

```text
README.md
EXECUTION_PLAN.md
.gitignore
```

Planned:

```text
revit-addin/
agent-service/
skills/
knowledge/
docs/
samples/
```

## Key References

- Autodesk Platform Services Design Automation API: https://aps.autodesk.com/apis-and-services/design-automation-api
- Dynamo BIM: https://dynamobim.org/
- pyRevit: https://github.com/pyrevitlabs/pyRevit
- REVIT_MCP_study: https://github.com/shuotao/REVIT_MCP_study
- Revit API docs entry: https://www.revitapidocs.com/

## 中文說明

這是一個個人用 Autodesk/Revit Agent 的計畫文件。第一版目標不是複製完整 BIMGO AI，而是做出自己夠用的 Revit 內嵌 Agent：

- 在 Revit 側邊面板輸入自然語言指令
- Agent 拆解任務
- 呼叫固定且可審查的 Revit tools
- 執行前顯示計畫並要求確認
- 成功流程可存成個人 Skill 重複使用

第一版應避免任意生成並執行 C# 程式碼，也不先挑戰完整 CAD-to-BIM。建議先做選取元素、查詢元素、批量改參數、視圖命名、套用 view template、簡單管線建立等高成功率任務。
