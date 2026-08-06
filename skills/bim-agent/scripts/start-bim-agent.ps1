param(
    [string]$RepoRoot = $(
        if ($env:BIM_PERSONAL_AGENT_REPO) {
            $env:BIM_PERSONAL_AGENT_REPO
        }
        elseif (Test-Path -LiteralPath (Join-Path $env:APPDATA "BIMPersonalAgent\runtime\current")) {
            Join-Path $env:APPDATA "BIMPersonalAgent\runtime\current"
        }
        else {
            "E:\Desktop\Codex\BIM-personal-agent"
        }
    ),
    [int]$ConsolePort = 4178,
    [int]$BridgePort = 9686,
    [switch]$DeveloperMode
)

$ErrorActionPreference = "Stop"
$repoPath = [System.IO.Path]::GetFullPath($RepoRoot)
$serverPath = Join-Path $repoPath "console\server.mjs"
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "BIM Agent console server was not found: $serverPath"
}
$bundledNodePath = Join-Path $repoPath "node\node.exe"
$nodePath = if (Test-Path -LiteralPath $bundledNodePath -PathType Leaf) {
    $bundledNodePath
}
else {
    (Get-Command node -ErrorAction Stop).Source
}

$consoleUrl = "http://127.0.0.1:$ConsolePort"
$healthUrl = "$consoleUrl/health"
$metadataPath = Join-Path $repoPath "console\build-metadata.json"
$expectedBuildId = if (Test-Path -LiteralPath $metadataPath) {
    (Get-Content -LiteralPath $metadataPath -Encoding UTF8 -Raw | ConvertFrom-Json).buildId
} else { "0.8.0-development" }
$consoleRunning = $false
$consoleVersionMismatch = $null
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    if ($health.ok -eq $true -and $health.buildId -ne $expectedBuildId) {
        $consoleVersionMismatch = $health.buildId
    }
    $consoleRunning = $health.ok -eq $true -and $health.buildId -eq $expectedBuildId
}
catch {
    $consoleRunning = $false
}
if ($null -ne $consoleVersionMismatch) {
    throw "BIM Agent console $consoleVersionMismatch already occupies port $ConsolePort; expected $expectedBuildId."
}

$consoleStarted = $false
$consoleProcessId = $null
if (-not $consoleRunning) {
    $previousConsolePort = $env:BIM_AGENT_CONSOLE_PORT
    $previousBridgePort = $env:BIM_PERSONAL_AGENT_PORT
    $previousDeveloperMode = $env:BIM_AGENT_DEVELOPER_MODE
    try {
        $env:BIM_AGENT_CONSOLE_PORT = [string]$ConsolePort
        $env:BIM_PERSONAL_AGENT_PORT = [string]$BridgePort
        $env:BIM_AGENT_DEVELOPER_MODE = if ($DeveloperMode) { "1" } else { "0" }
        $process = Start-Process `
            -FilePath $nodePath `
            -ArgumentList @($serverPath) `
            -WorkingDirectory $repoPath `
            -WindowStyle Hidden `
            -PassThru
    }
    finally {
        $env:BIM_AGENT_CONSOLE_PORT = $previousConsolePort
        $env:BIM_PERSONAL_AGENT_PORT = $previousBridgePort
        $env:BIM_AGENT_DEVELOPER_MODE = $previousDeveloperMode
    }
    $consoleProcessId = $process.Id
    $consoleStarted = $true

    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
            $consoleRunning = $health.ok -eq $true -and $health.buildId -eq $expectedBuildId
        }
        catch {
            $consoleRunning = $false
        }
    } while (-not $consoleRunning -and [DateTime]::UtcNow -lt $deadline)
}

if (-not $consoleRunning) {
    throw "BIM Agent console did not become ready at $consoleUrl"
}

$revitRunning = @(Get-Process -Name Revit -ErrorAction SilentlyContinue).Count -gt 0
$bridgeListening = Test-NetConnection -ComputerName "localhost" -Port $BridgePort -InformationLevel Quiet -WarningAction SilentlyContinue

[PSCustomObject]@{
    consoleUrl = $consoleUrl
    consoleStarted = $consoleStarted
    consoleProcessId = $consoleProcessId
    revitRunning = $revitRunning
    bridgeListening = $bridgeListening
    bridgePort = $BridgePort
    buildId = $expectedBuildId
    developerMode = [bool]$DeveloperMode
} | ConvertTo-Json -Compress
