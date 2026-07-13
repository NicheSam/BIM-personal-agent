param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$solution = Join-Path $repoRoot "BIMPersonalAgent.sln"
$env:NUGET_PACKAGES = Join-Path $repoRoot ".packages"
$env:NUGET_CERT_REVOCATION_MODE = "offline"
$dotnetCandidates = @(
    (Join-Path (Split-Path $repoRoot -Parent) ".tools\dotnet10\dotnet.exe"),
    "dotnet"
)
$dotnet = $dotnetCandidates | Where-Object { $_ -eq "dotnet" -or (Test-Path -LiteralPath $_) } | Select-Object -First 1

Push-Location (Join-Path $repoRoot "gateway")
try {
    & npm.cmd test
    if ($LASTEXITCODE -ne 0) {
        throw "Gateway tests failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

& $dotnet build $solution -c $Configuration -p:RestoreIgnoreFailedSources=true
if ($LASTEXITCODE -ne 0) {
    throw "Build failed with exit code $LASTEXITCODE."
}

$testExe = Join-Path $repoRoot "tests\BimPersonalAgent.Core.Tests\bin\$Configuration\BimPersonalAgent.Core.Tests.exe"
& $testExe
if ($LASTEXITCODE -ne 0) {
    throw "Tests failed with exit code $LASTEXITCODE."
}

& (Join-Path $PSScriptRoot "verify-codex-mode.ps1")

$artifactRoot = Join-Path $repoRoot "artifacts\BimPersonalAgent.Revit2024"
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

$revitOutput = Join-Path $repoRoot "src\BimPersonalAgent.Revit\bin\$Configuration"
Get-ChildItem -LiteralPath $revitOutput | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $artifactRoot -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $repoRoot "addin\BimPersonalAgent.addin") -Destination $artifactRoot -Force

$gatewayArtifact = Join-Path $repoRoot "artifacts\BimPersonalAgent.Gateway"
New-Item -ItemType Directory -Path $gatewayArtifact -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "gateway\build") -Destination $gatewayArtifact -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "gateway\package.json") -Destination $gatewayArtifact -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "gateway\package-lock.json") -Destination $gatewayArtifact -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "console") -Destination $gatewayArtifact -Recurse -Force

Write-Host "Build, tests, and packaging completed."
Write-Host $artifactRoot
