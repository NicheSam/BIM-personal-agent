param(
    [switch]$CheckOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$revitApi = "C:\Program Files\Autodesk\Revit 2024\RevitAPI.dll"
$codexConfig = Join-Path $HOME ".codex\config.toml"
$skillSource = Join-Path $repoRoot "skills\bim-agent"
$skillRoot = Join-Path $HOME ".codex\skills"
$skillTarget = Join-Path $skillRoot "bim-agent"

function Require-Command([string]$Name, [string]$Help) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "$Name was not found. $Help"
    }
    return $command.Source
}

Write-Host "Checking BIM Personal Agent requirements..."
if (-not (Test-Path -LiteralPath $revitApi -PathType Leaf)) {
    throw "Revit 2024 was not found at the standard installation path."
}
$node = Require-Command "node" "Install Node.js 22 or newer."
$npm = Require-Command "npm.cmd" "Install Node.js 22 or newer."
$nodeVersion = (& $node --version).Trim().TrimStart("v")
$nodeMajor = [int]($nodeVersion.Split(".")[0])
if ($nodeMajor -lt 22) {
    throw "Node.js 22 or newer is required. Found: $nodeVersion"
}
if (-not (Test-Path -LiteralPath $codexConfig -PathType Leaf)) {
    throw "Codex Desktop config was not found: $codexConfig"
}
if (-not (Test-Path -LiteralPath $skillSource -PathType Container)) {
    throw "BIM Agent skill source was not found: $skillSource"
}

$dotnetCandidates = @(
    (Join-Path (Split-Path $repoRoot -Parent) ".tools\dotnet10\dotnet.exe"),
    (Get-Command "dotnet" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }
if (-not $SkipBuild -and $dotnetCandidates.Count -eq 0) {
    throw ".NET SDK 10 was not found. Install it before building this source package."
}

$revitRunning = @(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -gt 0
Write-Host "Revit 2024: found"
Write-Host "Node.js: $nodeVersion"
Write-Host "Codex config: found"
Write-Host ("Revit running: " + $revitRunning)
if ($CheckOnly) {
    Write-Host "Check completed. No files were changed."
    exit 0
}
if ($revitRunning) {
    throw "Close Revit before installation so the Add-in can be replaced safely."
}

if (-not $SkipBuild) {
    Write-Host "Installing locked Gateway dependencies..."
    Push-Location (Join-Path $repoRoot "gateway")
    try {
        & $npm ci
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }

    Write-Host "Building and testing BIM Personal Agent..."
    & (Join-Path $PSScriptRoot "build.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE."
    }
}

$artifactRoot = Join-Path $repoRoot "artifacts\BimPersonalAgent.Revit2024"
if (-not (Test-Path -LiteralPath $artifactRoot -PathType Container)) {
    throw "Revit Add-in artifacts were not found: $artifactRoot"
}

Write-Host "Installing the Revit 2024 Add-in..."
& (Join-Path $PSScriptRoot "install.ps1") -SkipBuild

Write-Host "Configuring Codex MCP..."
& (Join-Path $PSScriptRoot "configure-codex-agent.ps1")

Write-Host "Installing the BIM Agent skill..."
New-Item -ItemType Directory -Path $skillRoot -Force | Out-Null
if (Test-Path -LiteralPath $skillTarget) {
    $backupName = "bim-agent.backup-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    $backupPath = Join-Path $skillRoot $backupName
    Move-Item -LiteralPath $skillTarget -Destination $backupPath
    Write-Host "Existing skill backed up: $backupPath"
}
Copy-Item -LiteralPath $skillSource -Destination $skillTarget -Recurse

Write-Host ""
Write-Host "BIM Personal Agent is installed."
Write-Host "Next:"
Write-Host "1. Start Revit 2024 and open the intended model."
Write-Host "2. Click BIM Personal > Agent service."
Write-Host "3. Restart Codex Desktop and enter `$bim-agent in a new task."
