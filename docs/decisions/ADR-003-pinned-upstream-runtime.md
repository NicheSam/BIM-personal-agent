# ADR-003: Pinned REVIT_MCP_study Upstream Runtime

## Status

Accepted

## Date

2026-08-04

## Context

BIM Personal Agent began as a derivative of `shuotao/REVIT_MCP_study`, but the product now owns a six-tool MCP facade, task routing, Dynamic C#, saved tools, execution policy and the activity console. Converting the whole product into a normal GitHub fork would preserve Git lineage but would not prevent two MCP servers or two Revit Add-ins from running. The runtime boundary and the source-update boundary are separate concerns.

The current Agent catalog contains 149 internal descriptors: 146 names overlap the pinned upstream runtime and three tools (`execute_dynamic_csharp`, `get_task_context`, and `inspect_element_context`) are Agent-owned. The latest audited upstream contains 167 tool names. Publishing those additional descriptors before the matching C# runtime is integrated would advertise tools that the Revit Bridge cannot execute.

## Decision

BIM Personal Agent remains an independent product repository. `REVIT_MCP_study` is a read-only upstream source, pinned by `config/upstream-lock.json`. The copied runtime under `src/BimPersonalAgent.RevitBridge/Legacy` is treated as a vendored snapshot with an Agent overlay, not as an untracked manual copy.

Upstream synchronization is split into explicit stages:

1. Audit a fetched upstream ref and produce a name-level difference report.
2. Review command, schema, dependency and Revit-version changes.
3. Integrate the matching C# runtime on a dedicated branch.
4. Build and run Gateway, parity and Revit smoke tests.
5. Import catalog descriptors only with explicit runtime-parity acknowledgement.
6. Update the pinned commit and snapshot hashes after all checks pass.

Automatic upstream merging and automatic catalog publication are prohibited. The `revit-mcp-upstream` Git remote is fetch-only. Releases continue to install only `BimPersonalAgent.addin`, and Codex continues to expose only the six Agent MCP tools.

## Consequences

- A normal clone of BIM Personal Agent remains sufficient to build a pinned release.
- A sibling `REVIT_MCP_study` checkout is needed only for development audits and upgrades, never at runtime.
- Upstream additions remain visible without silently entering the production catalog.
- The current 149-tool runtime stays unchanged until the 21 upstream-only tools pass parity work.
- A full current-upstream integration would produce 170 internal descriptors: 167 upstream plus three Agent-owned tools.
