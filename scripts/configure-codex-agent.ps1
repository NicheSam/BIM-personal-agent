param(
    [string]$ConfigPath = (Join-Path $HOME ".codex\config.toml"),
    [string]$GatewayServerPath = (Join-Path ([System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))) "gateway\build\index.js"),
    [string]$NodeCommand = "node",
    [int]$BridgePort = 9686,
    [int]$ConsolePort = 4178
)

$ErrorActionPreference = "Stop"
$configFile = [System.IO.Path]::GetFullPath($ConfigPath)
$serverFile = [System.IO.Path]::GetFullPath($GatewayServerPath)
$nodeExecutable = if ([System.IO.Path]::IsPathRooted($NodeCommand)) {
    [System.IO.Path]::GetFullPath($NodeCommand)
} else {
    $NodeCommand
}

if (-not (Test-Path -LiteralPath $configFile -PathType Leaf)) {
    throw "Codex config was not found: $configFile"
}
if (-not (Test-Path -LiteralPath $serverFile -PathType Leaf)) {
    throw "Agent Gateway was not built: $serverFile"
}
if ([System.IO.Path]::IsPathRooted($nodeExecutable) -and -not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
    throw "Node executable was not found: $nodeExecutable"
}

$original = [System.IO.File]::ReadAllText($configFile, [System.Text.Encoding]::UTF8)
$newline = if ($original.Contains("`r`n")) { "`r`n" } else { "`n" }
$sectionPattern = '(?ms)^\[mcp_servers\."(?:bim-personal-agent|revit-mcp)"\]\r?\n.*?(?=^\[|\z)'
$cleaned = [System.Text.RegularExpressions.Regex]::Replace($original, $sectionPattern, "").TrimEnd()
$escapedServer = $serverFile.Replace("\", "\\").Replace('"', '\"')
$escapedNode = $nodeExecutable.Replace("\", "\\").Replace('"', '\"')
$section = @(
    '[mcp_servers."bim-personal-agent"]',
    ('command = "' + $escapedNode + '"'),
    ('args = ["' + $escapedServer + '"]'),
    ('env = { REVIT_VERSION = "2024", BIM_PERSONAL_AGENT_PORT = "' + $BridgePort + '", BIM_AGENT_CONSOLE_PORT = "' + $ConsolePort + '", BIM_PERSONAL_AGENT_CONSOLE_URL = "http://127.0.0.1:' + $ConsolePort + '" }')
) -join $newline
$updated = $cleaned + $newline + $newline + $section + $newline

$backup = Join-Path (Split-Path $configFile -Parent) "config.toml.bak-before-bim-agent-gateway"
if (-not (Test-Path -LiteralPath $backup)) {
    [System.IO.File]::WriteAllText($backup, $original, [System.Text.UTF8Encoding]::new($false))
}
[System.IO.File]::WriteAllText($configFile, $updated, [System.Text.UTF8Encoding]::new($false))

Write-Host "Codex MCP configured: bim-personal-agent"
Write-Host "Node: $nodeExecutable"
Write-Host "Gateway: $serverFile"
Write-Host "Backup: $backup"
