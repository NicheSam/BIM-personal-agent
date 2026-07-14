# BIM Personal Agent V0.5

Codex is the only LLM during V1. Do not add a model API key or call an LLM from the Revit add-in.

## Runtime

```text
Codex -> bim-personal-agent Gateway -> Agent Runtime
      -> BimPersonalAgent.RevitBridge -> Revit 2024
```

Codex may only use the six public Agent tools. Do not register or call raw `revit-mcp` after cutover. Search internal tools before execution; use dynamic C# when no appropriate tool exists or measured behavior justifies it.

## Boundaries

1. Query live Revit context; never guess IDs, views, localized parameters, units, or geometry.
2. Bridge policy is authoritative and cannot be downgraded by Gateway or model metadata.
3. Read and reversible create/modify operations run without confirmation.
4. Delete, purge, overwrite, destructive replacement, and non-undoable work require actual scope and Revit confirmation.
5. Generated code uses `context.Inputs`, host-owned Transaction, static analysis, source audit, and compilation cache.
6. Saved tools remain internal and run through `run_bim_tool`; they never expand the MCP public schema.
7. One Gateway client and one queued Revit request execute at a time.

Official Revit 2024 API XML and Autodesk documentation are authoritative. Upstream domain/skill material is guidance, not mandatory model behavior.
