param(
    [string]$RepoRoot = $(if ($env:BIM_PERSONAL_AGENT_REPO) { $env:BIM_PERSONAL_AGENT_REPO } else { "E:\Desktop\Codex\BIM-personal-agent" }),
    [int]$ConsolePort = 4178,
    [int]$BridgePort = 9686
)

$ErrorActionPreference = "Stop"
$repoPath = [System.IO.Path]::GetFullPath($RepoRoot)
$serverPath = Join-Path $repoPath "console\server.mjs"
if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "BIM Agent console server was not found: $serverPath"
}

$consoleUrl = "http://127.0.0.1:$ConsolePort"
$healthUrl = "$consoleUrl/health"
$consoleRunning = $false
try {
    $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
    $consoleRunning = $health.ok -eq $true
}
catch {
    $consoleRunning = $false
}

$consoleStarted = $false
$consoleProcessId = $null
if (-not $consoleRunning) {
    $process = Start-Process `
        -FilePath "node" `
        -ArgumentList @($serverPath) `
        -WorkingDirectory $repoPath `
        -WindowStyle Hidden `
        -PassThru
    $consoleProcessId = $process.Id
    $consoleStarted = $true

    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        Start-Sleep -Milliseconds 250
        try {
            $health = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 1
            $consoleRunning = $health.ok -eq $true
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
} | ConvertTo-Json -Compress
