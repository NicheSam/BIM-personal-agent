# BIM Personal Agent v0.8.0

## Tool memory and reuse

- Reuse identical saved-tool source instead of creating another patch version.
- Add an optional stable `capabilityKey` for operation-level discovery.
- Keep all 50 compiled Dynamic C# sources cached for the Revit session.
- Report compiled, cached, remaining, and maximum Dynamic C# counts from the Bridge.

## Engineer workbench

- Make the engineer-facing task state, model impact, duration, and simplified progress the default view.
- Move tool inputs, request IDs, source hashes, raw JSON, Run Diff, and Codex usage behind Developer Mode.
- Replace evidence export controls with one full task-information dialog.
- Treat successful work without requested readback as completed instead of attention-required.
- Project saved-tool `AppliedCount`, `VerifiedCount`, and `ElementIds` into accurate model-impact and readback summaries.
- Backfill compatible stored v3 task details at read time, while rejecting mismatched counts instead of overstating scope.
- Show the number of verified elements separately from the number of passed verification claims.

## Verified Revit 2024 smoke

- Confirmed Gateway `0.8.0` and Bridge `0.8.0` against a live Revit 2024 document.
- Ran an existing read-only tool without model changes.
- Applied and read back an active-view-only override on 68 selected elements with `AppliedCount=68` and `VerifiedCount=68`.
- Reused saved tool `saved:set-selected-active-view-style` v1.0.1 with the same source hash; the second run hit the compilation cache and did not create another saved-tool version.
