$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$registryPath = Join-Path $repoRoot "config\tool-registry.json"
$upstreamLockPath = Join-Path $repoRoot "config\upstream-lock.json"
$catalogPath = Join-Path $repoRoot "gateway\src\catalog\builtin-tools.json"
$sourcesPath = Join-Path $repoRoot "knowledge\revit\official-sources.md"
$gatewaySourcePath = Join-Path $repoRoot "gateway\src\bridge-client.ts"
$bridgeSettingsPath = Join-Path $repoRoot "src\BimPersonalAgent.RevitBridge\Legacy\Configuration\ServiceSettings.cs"

foreach ($path in @($registryPath, $upstreamLockPath, $catalogPath, $sourcesPath, $gatewaySourcePath, $bridgeSettingsPath)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Required Agent file is missing: $path"
    }
}

$registry = Get-Content -Raw -Encoding UTF8 -LiteralPath $registryPath | ConvertFrom-Json
$upstreamLock = Get-Content -Raw -Encoding UTF8 -LiteralPath $upstreamLockPath | ConvertFrom-Json
$catalog = Get-Content -Raw -Encoding UTF8 -LiteralPath $catalogPath | ConvertFrom-Json
$catalogIds = @($catalog | ForEach-Object { $_.toolId })
$uniqueCatalogIds = @($catalogIds | Sort-Object -Unique)
$blockedTools = @($registry.tool_policy.blocked_tools)
$expectedBlockedTools = @(
    "copy_sheets_from_file",
    "dedup_detail_elements_in_view",
    "delete_element",
    "door-window-legend-tools",
    "export_families",
    "import_excel_to_drafting_views",
    "read_excel_tables"
)

if ($registry.mode -ne "agent-gateway") {
    throw "Unexpected registry mode."
}

if ($registry.tool_policy.public_mcp_tools -ne 6) {
    throw "Codex must see exactly six Agent MCP tools."
}

if ($catalog.Count -ne $registry.tool_policy.builtin_tools -or $uniqueCatalogIds.Count -ne $registry.tool_policy.builtin_tools) {
    throw "Built-in catalog count must match the registry and contain unique tools."
}

if ($upstreamLock.integration.internalToolCount -ne $catalog.Count -or
    ($upstreamLock.integration.upstreamToolCount + $upstreamLock.integration.agentOwnedToolCount) -ne $catalog.Count) {
    throw "Pinned upstream and Agent-owned tool counts must match the internal catalog."
}

$classified = $registry.tool_policy.validated_tools +
    $registry.tool_policy.experimental_tools +
    $registry.tool_policy.disabled_tools
if ($classified -ne $registry.tool_policy.builtin_tools) {
    throw "Tool status counts must total the registry built-in tool count."
}

if ($blockedTools.Count -ne 7 -or (Compare-Object $expectedBlockedTools ($blockedTools | Sort-Object -Unique))) {
    throw "Disabled tool boundary does not match the registry."
}

$destructivePolicy = $registry.execution_policy.destructive
if ($destructivePolicy.show_scope -ne $true -or $destructivePolicy.requires_confirmation -ne $true) {
    throw "Destructive operations must show scope and require confirmation."
}

if ($registry.performance.guidance_only -ne $true) {
    throw "Performance observations must remain guidance, not an execution gate."
}

$gatewaySource = Get-Content -Raw -Encoding UTF8 -LiteralPath $gatewaySourcePath
$bridgeSettings = Get-Content -Raw -Encoding UTF8 -LiteralPath $bridgeSettingsPath
if ($gatewaySource -notmatch 'DEFAULT_PORT\s*=\s*9686' -or
    $bridgeSettings -notmatch 'DefaultPort\s*=\s*9686') {
    throw "Gateway and Revit Bridge must both default to localhost:9686."
}

Write-Host "Agent registry verified: 6 public MCP tools, $($catalog.Count) internal tools, $($registry.tool_policy.validated_tools) validated, $($registry.tool_policy.experimental_tools) experimental, $($registry.tool_policy.disabled_tools) disabled, port 9686."
