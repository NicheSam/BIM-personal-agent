# BIM Personal Agent v0.9.0

## Changes

- Package native family authoring 2.0.3: editable native forms, bounded geometry inputs, explicit void cuts, source-preserving copies, and save/reopen verification.
- Package parametric cabinet authoring 1.1.0: bounded dimensions, flex checks, conduit connectors, and candidate ModelText/material support.
- Keep six public MCP tools; expand the internal catalog to 152 tools, with 22 validated, 123 experimental, and 7 disabled.
- Reject family-file operations inside atomic plans and Harness runs. Preserve destructive-operation confirmation and Dynamic C# policy.
- Refresh compatible npm dependencies in the lockfile; the production dependency audit reports zero known vulnerabilities at release validation time.

## Validation and limits

Gateway/Console regression tests, family and cabinet input validators, core parser tests, and Revit 2024 solution compilation are checked for this package. Package verification does not establish live Revit behavior.

The authoring tools remain experimental. The recorded family 2.0.3 acceptance covers tested planar geometry, cut rejection, and source-preserving copy operations. Nonplanar sweeps and arbitrary source-family constraints remain untested. Cabinet geometry/ports have earlier live acceptance; the 1.1.0 batch ModelText extension still requires live verification. No new live Revit acceptance is claimed for this release. See [family authoring](../docs/family-authoring.md) and [cabinet authoring](../docs/parametric-cabinet-authoring.md).

## Install or update

1. Download `BIMPersonalAgent-v0.9.0-win-x64.zip` and its `.sha256` asset.
2. Verify the SHA-256 checksum and extract the ZIP.
3. Close Revit 2024 and Codex Desktop.
4. Run `install.bat -CheckOnly`, then `install.bat`.
5. Restart Revit and Codex, start `BIM Personal > Agent service`, and enter `$bim-agent` in a new task.

The package includes portable Node.js and production Gateway dependencies. Do not install over a running Revit session; the Bridge assembly requires a restart.
