# BIM Personal Agent v0.6.0

Executor and reporter release for Revit 2024 and Codex Desktop.

## Added

- One `taskId` across tool search, execution, verification, and reporting.
- Revit Bridge progress events for queued, executing, completed, and failed states.
- Local Task Store with one summary and ordered event stream per BIM task.
- Task-oriented BIM Agent Workbench with live SSE updates.
- Background Codex token attribution that does not block live execution status.

## Compatibility

- The six public MCP tools remain unchanged; optional `taskId` correlation was added.
- V1 activity events remain available for older console and audit consumers.
- Existing built-in tools, saved tools, Dynamic C#, policy, and Harness behavior remain available.

## User requirements

- Windows.
- Autodesk Revit 2024.
- Codex Desktop.

Node.js, npm, Python, .NET SDK, and administrator permissions are not required for the release package.

## Install

1. Download `BIMPersonalAgent-v0.6.0-win-x64.zip`.
2. Extract the ZIP and close Revit and Codex Desktop.
3. Run `install.bat -CheckOnly`.
4. Run `install.bat`.
5. Restart Revit and Codex, start `BIM Personal > Agent service`, then enter `$bim-agent` in a new task.

SHA256 is provided as a separate release asset.
