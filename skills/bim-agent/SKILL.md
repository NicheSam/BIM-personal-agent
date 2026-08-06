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
6. Call `get_agent_status` once after startup. Call `get_bim_context` only when the request depends on selection, active view, levels, project identity, or other live model context.
7. State project and active view only when they are relevant to the requested operation.

## Operate

- Understand and classify the request before searching. Identify the goal, BIM objects, intended actions, constraints, risk, and whether explicit verification is required.
- Give the structured task a concise `displayTitle` in the user's language for the engineer workbench. Keep the full instruction in `goal`; do not use a generic title such as "BIM task".
- Use the shortest viable route. For a simple single-operation task, call `search_bim_tools` once, select a suitable existing tool, and execute it directly without creating a plan or Loop.
- Build a multi-step workflow only for tasks that genuinely require ordered operations, shared transactions, elevated risk, or explicit verification. Do not turn a simple request into a formal plan.
- Review the returned workflow and reuse its recommended tools and alternatives. Refine only uncovered or unsuitable steps once, including experimental tools when needed.
- Treat Dynamic C# as a per-step implementation route, not an all-or-nothing fallback. Use it for uncovered steps or when local telemetry makes the existing route inferior, then save the successful parameterized command for reuse.
- Before generating Dynamic C#, reuse an existing built-in or saved tool with the same operation capability. New generated manifests should use a stable `capabilityKey` and parameterized inputs; quantities, colors, levels, view IDs, ElementIds, and project-specific values must not define the tool identity.
- Normal read, create and reversible modify operations execute directly.
- Destructive operations require the Revit scope dialog and user confirmation.
- Never guess ElementId, localized parameter names, active view, units or project identity.
- The activity console is optional observability. It refreshes automatically, but it is never a prerequisite for execution.

## Bounded Harness

- Keep the direct path as the default. Set `startLoop=true` only after a failure needs a bounded correction, the request is complex or high risk, or the user explicitly asks for acceptance evidence or verification.
- Never start a correction attempt when the first execution has not failed. Do not request full Revit readback when the task has no verification requirement.
- Domain profiles, acceptance criteria and verification checks guide planning; they are not a mandatory checklist for every task. Use only checks that prove the requested result.
- Reuse one complete tool search. On a retry, prefer the smallest evidence-backed correction. Replan when the evidence invalidates the original approach, but do not silently widen scope or risk.
- Treat quantity, RFI, constructability and clash work as read-only by default. A reversible model correction is allowed only when the task explicitly requires it and the available evidence can verify it.
- Stop on timeout, uncertain Revit state, document change, destructive work, repeated error or exhausted budget. Do not expand the Loop after failure.
- Dynamic C# may enter any uncovered workflow step. Inside a Loop it becomes active only after verification passes; outside a Loop the existing direct save behavior remains.

## Console Boundary

The console is an asynchronous observation layer for BIM engineers. Present event time, action, affected elements, result, transaction, duration and locally recorded Codex task token usage without delaying the main tool response. Do not expose prompts, arguments, parameter values, generated source, MCP schemas or developer diagnostics in public mode. Read complete raw data only during explicit debugging. If a Gateway request cannot be proven to belong to a Codex task, label token usage unavailable instead of estimating it.
