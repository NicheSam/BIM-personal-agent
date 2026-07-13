# BIM Personal Agent v0.5.0

First installable Windows test release for Revit 2024 and Codex Desktop.

## Included

- Prebuilt BIM Personal Agent Revit 2024 Add-in.
- Six-tool MCP Gateway with 148 internal Revit tools.
- Dynamic C# execution and saved-tool reuse.
- BIM activity console and `$bim-agent` Codex skill.
- Portable Node.js 24.15.0 and production Gateway dependencies.
- `install.bat` for environment check and user installation.

## User requirements

- Windows.
- Autodesk Revit 2024.
- Codex Desktop.

Node.js, npm, Python, .NET SDK, and administrator permissions are not required for the release package.

## Install

1. Download `BIMPersonalAgent-v0.5.0-win-x64.zip`.
2. Extract the ZIP and close Revit and Codex Desktop.
3. Run `install.bat -CheckOnly`.
4. Run `install.bat`.
5. Restart Revit and Codex, start `BIM Personal > Agent service`, then enter `$bim-agent` in a new task.

SHA256 is provided as a separate release asset.
