# Migration Baseline

Date: 2026-07-13

## Source Baseline

- BIM Personal Agent base commit: `815310ab4431c8b9e57afd619c880fadc0769cf1`
- REVIT_MCP_latest source commit: `cfe073951fa1e43792f9d93f015d7b82416df621`
- Both worktrees contained local changes before migration. No clean, reset, checkout, or revert was used during the extraction.
- REVIT_MCP_latest remains a sibling reference repository and is not a runtime dependency.

## Catalog Baseline

- `gateway/src/catalog/builtin-tools.json`: SHA-256 `066A71872C920564EBB79ACFE1552727E65F0873EBC7805D3B5E3C52A188456D`
- `config/tool-registry.json`: SHA-256 `A7D4A4C981C716D4BF37A7B58445BE82DEBD22F2F0BC288362D8159F0D85B271`
- Counts: 148 built-ins, 21 validated, 120 experimental, 7 disabled, 6 public MCP tools.

## Installed V0.5 Artifacts

- `BimPersonalAgent.Revit.dll`: SHA-256 `5F989E6DFA303F1FFADC2AB2AEEDCC38F98888B3ED3DF5DF7DF69ADF5ED0DB98`
- `BimPersonalAgent.RevitBridge.dll`: SHA-256 `D101E74418873165EF339C6E6541D7D0B6185B9DD80F4254D59ED1E65FEB56D7`
- Build artifacts and installed DLL hashes were verified equal after final deployment.
- Gateway and Bridge default to `localhost:9686`; config schema v3 migrates the previous v2/8964 runtime setting.

## Rollback Evidence

- Codex config backup: `%USERPROFILE%\.codex\config.toml.bak-before-bim-agent-gateway`
- Legacy manifest backup: `%APPDATA%\Autodesk\Revit\Addins\2024\RevitMCP.addin.disabled-before-bim-agent-0.5`
- Active Agent manifest: `%APPDATA%\Autodesk\Revit\Addins\2024\BimPersonalAgent.addin`

The legacy manifest backup intentionally does not end in `.addin`, so Revit will not load it during V0.5 smoke testing.
