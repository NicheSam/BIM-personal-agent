# BIM Personal Agent v0.8.1

Element Lens and targeting-policy release for Revit 2024 and Codex Desktop.

## Added

- Add the read-only `builtin:inspect_element_context` internal tool for identity, instance/type parameters, lightweight geometry and location, relationships, and view/sheet context.
- Add bounded inspection levels so the Gateway requests summary, parameters, or full detail only when needed.
- Add explicit targeting sources for current selection, ElementId, reviewed candidates, tool-returned ids, and created ids.
- Add safe auto-follow only when one exact target can be proven.
- Render Element Lens summaries, parameters, relationships, and selection candidates in the local Workbench.

## Changed

- Update the internal catalog to 149 tools: 146 pinned upstream tools and 3 Agent-owned tools.
- Correct the Workbench projection of saved-tool reuse and model-impact/readback counts.
- Rewrite the public README, installation guide, capability boundaries, architecture, and acknowledgments.
- Document `REVIT_MCP_study` as the pinned runtime parent project and `RevitParameterInspector` as the Element Lens design and capability-port source.

## Compatibility

- The six public MCP tools are unchanged.
- Revit support remains limited to Revit 2024, one Revit session, and one active document.
- Existing v0.8.0 saved tools remain searchable; identical source hashes do not create another tool version.

## Install

1. Download `BIMPersonalAgent-v0.8.1-win-x64.zip` rather than GitHub's source ZIP.
2. Extract it and close Revit 2024 and Codex Desktop.
3. Run `install.bat -CheckOnly`.
4. Run `install.bat`.
5. Restart Revit and Codex, start `BIM Personal > Agent service`, then enter `$bim-agent` in a new task.

The SHA-256 checksum is published as a separate release asset.
