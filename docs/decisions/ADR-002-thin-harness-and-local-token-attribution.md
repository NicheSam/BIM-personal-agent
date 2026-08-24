# ADR-002: Thin Harness And Local Token Attribution

## Status

Accepted

## Date

2026-07-14

## Context

A domain-specific workflow engine would duplicate Codex reasoning and could force capable models through fixed checklists. The Gateway also cannot obtain model token usage through MCP, while Codex records exact per-call usage in its local session history.

## Decision

The Harness is an opt-in control layer. Codex owns task understanding, workflow design, tool selection, Dynamic C#, verification design and evidence-based replanning. Domain profiles provide guidance only. Gateway hard stops are limited to destructive work, active-document changes, uncertain Revit state, repeated errors, rollback failures and explicit cost or scope ceilings.

The activity console reads local Codex session JSONL files without modifying them. It associates `bim-personal-agent` MCP results with Gateway activity by `requestId`, aggregates `last_token_usage` for the containing Codex turn, and attaches one usage record to every Agent event in that turn. Aggregate views deduplicate by task key. Unmatched events remain explicitly unavailable and are never estimated from response bytes.

## Consequences

- Stronger models retain freedom to combine tools, generate C# and replace an invalid plan.
- Simple tasks continue to bypass the Harness.
- Bounded correction remains reversible and evidence-driven.
- Token values are exact local Codex records but only when task association can be proven.
- Prompts, tool arguments, generated source, project paths and raw session content are not returned by the console API.
