# BIM Personal Agent v0.7.0

## Main changes

- Generic execution envelope v3 for input, raw and normalized result, scoped model state, changes, lineage, claims, and error layers.
- Extensible Domain Renderer registry; Issue #100 is a fixture-backed adapter rather than a core schema dependency.
- Claim-based verification statuses and partial coverage reporting.
- Evidence Mode masking and opt-in, seven-day Developer Trace storage.
- Run-to-Run Diff for input, result, model changes, lineage, verification, and diagnostics.
- Asynchronous observation queue so Console and detail persistence do not block the main Revit response.
- Lightweight routing guidance: direct execution by default; planning, readback, and correction only when needed.

The package continues to target Revit 2024 and includes a portable Node.js runtime.
