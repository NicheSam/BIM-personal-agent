$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()
$result = $null
try {
    $json = & (Join-Path $repoRoot "skills\bim-agent\scripts\start-bim-agent.ps1") -RepoRoot $repoRoot -ConsolePort $port -BridgePort 9686
    $result = $json | ConvertFrom-Json
    if ($result.consoleUrl -ne "http://127.0.0.1:$port") {
        throw "Console URL did not use the requested port."
    }
    $health = Invoke-RestMethod -Uri "$($result.consoleUrl)/health" -TimeoutSec 3
    if ($health.ok -ne $true -or -not $health.buildId) {
        throw "Console health did not return the expected build identity."
    }
    Write-Host "Console port propagation passed: $port ($($health.buildId))"
}
finally {
    if ($result -and $result.consoleStarted -and $result.consoleProcessId) {
        Stop-Process -Id $result.consoleProcessId -Force -ErrorAction SilentlyContinue
    }
}
