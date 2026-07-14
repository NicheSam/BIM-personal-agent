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

- Understand the request before searching. Identify the goal, BIM objects, intended actions, constraints, execution mode, and ordered steps.
- Call `search_bim_tools` once with the complete structured task. Let the Gateway map every step to the tools needed for the workflow; do not assume one tool must cover the whole task.
- Review the returned workflow and reuse its recommended tools and alternatives. Refine only uncovered or unsuitable steps once, including experimental tools when needed.
- Treat Dynamic C# as a per-step implementation route, not an all-or-nothing fallback. Use it for uncovered steps or when local telemetry makes the existing route inferior, then save the successful parameterized command for reuse.
- Normal read, create and reversible modify operations execute directly.
- Destructive operations require the Revit scope dialog and user confirmation.
- Never guess ElementId, localized parameter names, active view, units or project identity.
- Keep the activity console open; it refreshes automatically and is read-only.

## Bounded Harness

- Keep the direct path as the default. Set `startLoop=true` only when the request needs explicit acceptance evidence, controlled self-correction, or the user asks for verification.
- Domain profiles, acceptance criteria and verification checks guide planning; they are not a mandatory checklist for every task. Use only checks that prove the requested result.
- Reuse one complete tool search. On a retry, prefer the smallest evidence-backed correction. Replan when the evidence invalidates the original approach, but do not silently widen scope or risk.
- Treat quantity, RFI, constructability and clash work as read-only by default. A reversible model correction is allowed only when the task explicitly requires it and the available evidence can verify it.
- Stop on timeout, uncertain Revit state, document change, destructive work, repeated error or exhausted budget. Do not expand the Loop after failure.
- Dynamic C# may enter any uncovered workflow step. Inside a Loop it becomes active only after verification passes; outside a Loop the existing direct save behavior remains.

## Console Boundary

The console is for BIM engineers. Present event time, action, affected elements, result, transaction, duration and locally recorded Codex task token usage. Do not expose prompts, arguments, parameter values, generated source, MCP schemas or developer diagnostics. If a Gateway request cannot be proven to belong to a Codex task, label token usage unavailable instead of estimating it.
