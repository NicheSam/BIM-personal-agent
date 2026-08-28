# BIM Personal Agent v0.8.1

Element Lens and targeting-policy release for Revit 2024 and Codex Desktop.

## Added

- Read-only `builtin:inspect_element_context` with bounded identity, instance/type parameter, location, geometry, relationship, and view/sheet context.
- Explicit target-source policy and safe single-target auto-follow.
- Element Lens rendering in the local engineer Workbench.

## Changed

- Internal catalog: 149 tools, comprising 146 pinned `REVIT_MCP_study` tools and 3 Agent-owned tools.
- Correct Workbench saved-tool and model-impact/readback summaries.
- Rewrite installation, capability-boundary, architecture, and acknowledgment documentation.
- Credit `RevitParameterInspector` as the Element Lens design and capability-port source under the MIT License.

## Compatibility

- The six public MCP tools remain unchanged.
- Revit support remains limited to Revit 2024, one Revit session, and one active document.
- Existing saved tools remain searchable and source-hash reuse remains compatible.

## Install

1. Download `BIMPersonalAgent-v0.8.1-win-x64.zip` rather than GitHub's source ZIP.
2. Extract it and close Revit 2024 and Codex Desktop.
3. Run `install.bat -CheckOnly`.
4. Run `install.bat`.
5. Restart Revit and Codex, start `BIM Personal > Agent service`, then enter `$bim-agent` in a new task.

The SHA-256 checksum is published as a separate release asset.
