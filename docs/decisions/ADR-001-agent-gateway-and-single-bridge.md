# ADR-001: Agent Gateway And Single Revit Bridge

## Status

Accepted

## Date

2026-07-13

## Context

Directly exposing 148 Revit tools to Codex increased schema cost and allowed Codex to bypass the BIM Personal Agent product layer. The existing Agent pane and RevitMCP add-in also maintained separate ExternalEvent paths, while generated C# could execute only as one-off source without reusable arguments.

## Decision

Codex sees six stable Gateway tools. Built-in and saved tools are internal searchable descriptors. `BimPersonalAgent.RevitBridge.dll` owns one WebSocket client, one queued ExternalEvent dispatcher, transactions, dynamic compilation and destructive confirmation. Successful parameterized C# is versioned in a local tool store and reused through `run_bim_tool`.

The full upstream command runtime is copied into the Agent repository under a legacy namespace to preserve behavior without a sibling runtime dependency. Namespace cleanup is intentionally deferred; the product-facing assembly, host and manifest are Agent-owned.

## Consequences

- New saved tools do not require MCP reload.
- Side panel and Codex share one Revit execution queue.
- Only one Agent Add-in manifest remains after parity smoke.
- V1 remains Revit 2024 and Codex-only.
- Dynamic C# remains an in-process controlled runtime, not a hard sandbox.
