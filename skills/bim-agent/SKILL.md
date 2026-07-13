---
name: bim-agent
description: Activate BIM Personal Agent for an open Revit 2024 model, open the BIM activity console in the Codex in-app browser, verify the localhost Bridge, and begin natural-language BIM work. Use when the user says to enable, start, connect, or use the BIM Agent, work on the current Revit model, or open the BIM activity timeline.
---

# BIM Agent

Activate the existing local BIM Personal Agent. Codex remains the language model; do not start a second model service or raw `revit-mcp`.

## Start

1. Run `scripts/start-bim-agent.ps1`.
2. Read its JSON result.
3. If `revitRunning=false`, ask the user to open Revit 2024 and the intended model.
4. If `bridgeListening=false`, ask the user to press `BIM Personal > Agent服務 開/關` in Revit.
5. Open `consoleUrl` in the Codex in-app browser. Reuse that tab during the task.
6. Call `get_agent_status`, then `get_bim_context`.
7. State the connected project and active view before executing the BIM request.

## Operate

- Search existing and saved tools before generating C#.
- Use Dynamic C# only when no suitable tool exists or the measured route is inferior.
- Normal read, create and reversible modify operations execute directly.
- Destructive operations require the Revit scope dialog and user confirmation.
- Never guess ElementId, localized parameter names, active view, units or project identity.
- Keep the activity console open; it refreshes automatically and is read-only.

## Console Boundary

The console is for BIM engineers. Present event time, action, affected elements, result, transaction and duration. Do not expose prompts, arguments, parameter values, generated source, MCP schemas or developer diagnostics.
