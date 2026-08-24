# Revit 2024 Live Smoke - 2026-07-13

## Environment

- Project: `布袋戲傳習館_A1棟MEP_sc168jobim`
- Project fingerprint: `c046e0b87678be9f1ff96a977e1f33605b973a7c1b7d0f44c3fe408a5e8a09dd`
- Gateway: `0.5.0`
- RevitBridge: `0.5.0`
- Transport: `localhost:9686`
- Runtime config migration: v2/8964 to v3/9686 passed

## Passed

- Six-tool MCP startup and `get_agent_status`.
- Live context, active view, project fingerprint and existing read-only tool execution.
- `query_elements_with_filter` dispatcher parity.
- Existing `modify_element_parameter`, readback, restore and Revit Undo.
- Dynamic C# compile, execute, host-owned Transaction and compilation cache hit.
- Saved tool `smoke-list-writable-strings@1.0.0` persisted, was found by a new Gateway process and reused with arguments.
- Two-step read-only `run_bim_plan` committed as one atomic plan.
- Mid-plan failure rolled back a previously committed parameter modification inside the `TransactionGroup`.
- Destructive Dynamic C# displayed declared and actual scope in Revit.
- Choosing No returned `Cancelled=true` and preserved the target element.
- Choosing Yes deleted only the displayed temporary `DataStorage` target.

## Model Cleanup

- Electrical equipment `13466598` parameter `備註` was verified as an empty string after Undo.
- Temporary `DataStorage` elements `13571932` and `13571933` were verified absent.
- No smoke geometry or parameter marker remains in the model.

## Live Defects Found And Fixed

- Gateway used `127.0.0.1` while `HttpListener` registered `localhost`, causing WebSocket HTTP 400.
- `query_elements_with_filter` schema existed but its dispatcher alias was missing.
- Atomic plan used managed-reference equality for Revit documents instead of project fingerprint identity.
- Destructive before/after snapshots used an unfiltered collector, which Revit 2024 rejects.
