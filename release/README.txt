BIM Personal Agent V0.8.1 - User Package

Requirements:
- Windows
- Autodesk Revit 2024
- Codex Desktop

Node.js, npm, Python, and .NET SDK are included or not required.

Installation:
1. Close Revit and Codex Desktop.
2. Run install.bat -CheckOnly to verify the computer.
3. Run install.bat to install.
4. Start Revit 2024 and open the intended model.
5. Click BIM Personal > Agent service.
6. Restart Codex Desktop and enter $bim-agent in a new task.

The local BIM Agent Workbench groups search, execution, verification, and results by task. It reads Codex token usage from the local .codex/sessions history in the background. It does not upload prompts, tool arguments, project paths, or token history.

Project:
https://github.com/NicheSam/BIM-personal-agent

Guide:
https://nichesam.github.io/BIM-personal-agent/

Project license:
- BIM Personal Agent original project code: MIT License
- License text: LICENSE

Upstream and acknowledgments:
- REVIT_MCP_study: https://github.com/shuotao/REVIT_MCP_study
- RevitParameterInspector: https://github.com/laytonluo/RevitParameterInspector
- Full notices: THIRD_PARTY_NOTICES.md
