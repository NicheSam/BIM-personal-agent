# BIM Agent Observability V3

## Product boundary

The Revit execution path stays thin:

```text
understand -> search once -> run existing tool or Dynamic C# -> return
```

Planning, independent readback, and bounded correction are opt-in depth. They are used for complex work, elevated risk, an execution failure, or an explicit verification request. Console rendering and detail persistence run on an ordered background observation queue and do not block the main Revit response.

## Generic envelope

The core contract is [task-execution-envelope-v3.schema.json](../gateway/schemas/task-execution-envelope-v3.schema.json). It stores:

- task, request, run, and tool identity;
- input values and independently recorded input origins;
- raw result and normalized result without replacing either one;
- task-scoped model before and after identities;
- created, modified, and deleted ElementIds plus Transaction state;
- source, candidate, preview, operation, element, and verification lineage;
- required claims, observed claims, coverage, and uncovered claims;
- observed execution stages, warnings, and a classified error layer.

Feature-specific fields live only in `domain`, `domainSchemaVersion`, and `domainData`. The first registered adapter is `dwg_block_family_placement`; it does not alter the generic envelope.

## Status semantics

- `verified`: every required claim is covered and all covered claims pass.
- `completed_partially_verified`: execution completed but one or more required claims are uncovered.
- `verification_failed`: at least one claim failed.
- `not_verified`: execution completed without required verification evidence.
- `execution_failed`: execution failed before a trustworthy result was produced.
- `rolled_back`: the Transaction was rolled back.

`scope=none` or a non-empty `uncoveredClaims` list can never produce `verified`.

## Privacy modes

Public detail storage removes credentials, prompts, complete schemas, source code, local absolute paths, and account identity. Evidence Mode applies the same masking to screen and downloaded JSON while preserving engineering identity and evidence.

Developer Trace is opt-in and retained for seven days. It may retain raw payloads, source, field mappings, and stack traces for local debugging. Authentication secrets are always removed. Developer data is never merged into the public envelope.

## Review examples

Generated examples are in [docs/examples/task-detail-v3](examples/task-detail-v3):

- `success.json`
- `partial.json`
- `verificationFailed.json`
- `executionFailed.json`
- `partial-to-success.diff.json`

Issue #100 is only fixture data used to exercise Preview, Create, Readback, partial coverage, failure, pagination, search, and Diff.
