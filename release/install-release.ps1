param(
    [switch]$CheckOnly,
    [switch]$TestMode,
    [string]$InstallRoot = (Join-Path $env:APPDATA "BIMPersonalAgent\runtime\0.5.0"),
    [string]$RevitAddinRoot = (Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024"),
    [string]$CodexConfig = (Join-Path $HOME ".codex\config.toml"),
    [string]$SkillRoot = (Join-Path $HOME ".codex\skills")
)

$ErrorActionPreference = "Stop"
$packageRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$payloadRoot = Join-Path $packageRoot "payload"
$runtimeSource = Join-Path $payloadRoot "runtime"
$revitSource = Join-Path $payloadRoot "revit"
$skillSource = Join-Path $payloadRoot "skill\bim-agent"
$configureScript = Join-Path $packageRoot "scripts\configure-codex-agent.ps1"
$revitApi = "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll"

function Assert-Leaf([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label was not found: $Path"
    }
}

function Assert-Directory([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label was not found: $Path"
    }
}

function Backup-Directory([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Container) {
        $backup = $Path + ".backup-" + (Get-Date -Format "yyyyMMdd-HHmmss")
        Move-Item -LiteralPath $Path -Destination $backup
        Write-Host "Backed up: $backup"
    }
}

$installPath = [System.IO.Path]::GetFullPath($InstallRoot)
$addinPath = [System.IO.Path]::GetFullPath($RevitAddinRoot)
$configPath = [System.IO.Path]::GetFullPath($CodexConfig)
$skillPath = [System.IO.Path]::GetFullPath($SkillRoot)
$nodePath = Join-Path $installPath "node\node.exe"
$gatewayPath = Join-Path $installPath "gateway\build\index.js"

if ($TestMode) {
    $tempRoot = [System.IO.Path]::GetFullPath($env:TEMP).TrimEnd('\') + '\'
    foreach ($path in @($installPath, $addinPath, $configPath, $skillPath)) {
        if (-not $path.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "TestMode destinations must stay under TEMP: $path"
        }
    }
}

Assert-Leaf $revitApi "Revit 2024"
Assert-Leaf (Join-Path $runtimeSource "node\node.exe") "Portable Node.js"
Assert-Leaf (Join-Path $runtimeSource "gateway\build\index.js") "Gateway"
Assert-Leaf (Join-Path $revitSource "BimPersonalAgent.Revit.dll") "Revit Add-in"
Assert-Leaf (Join-Path $revitSource "BimPersonalAgent.addin") "Revit manifest"
Assert-Directory $skillSource "BIM Agent skill"
Assert-Leaf $configureScript "Codex configuration script"
Assert-Leaf $configPath "Codex Desktop config"

$revitRunning = @(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -gt 0
Write-Host "BIM Personal Agent release package: ready"
Write-Host "Revit 2024: found"
Write-Host "Codex Desktop config: found"
Write-Host "Portable Node.js: included"
Write-Host ("Revit running: " + $revitRunning)
if ($CheckOnly) {
    Write-Host "Check completed. No files were changed."
    exit 0
}
if ($revitRunning -and -not $TestMode) {
    throw "Close Revit before installation so the Add-in can be replaced safely."
}

Backup-Directory $installPath
New-Item -ItemType Directory -Path (Split-Path $installPath -Parent) -Force | Out-Null
Copy-Item -LiteralPath $runtimeSource -Destination $installPath -Recurse

$pluginPath = Join-Path $addinPath "BimPersonalAgent\0.5.0"
Backup-Directory $pluginPath
New-Item -ItemType Directory -Path $pluginPath -Force | Out-Null
Get-ChildItem -LiteralPath $revitSource | Where-Object { $_.Name -ne "BimPersonalAgent.addin" } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $pluginPath -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $revitSource "BimPersonalAgent.addin") -Destination $addinPath -Force

& $configureScript -ConfigPath $configPath -GatewayServerPath $gatewayPath -NodeCommand $nodePath

New-Item -ItemType Directory -Path $skillPath -Force | Out-Null
$skillTarget = Join-Path $skillPath "bim-agent"
Backup-Directory $skillTarget
Copy-Item -LiteralPath $skillSource -Destination $skillTarget -Recurse

Get-ChildItem -LiteralPath $installPath,$pluginPath -Recurse -File | Unblock-File -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "BIM Personal Agent V0.5.0 is installed."
Write-Host "1. Start Revit 2024 and open the intended model."
Write-Host "2. Click BIM Personal > Agent service."
Write-Host "3. Restart Codex Desktop and enter `$bim-agent in a new task."
