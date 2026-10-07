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

& node (Join-Path $PSScriptRoot "audit-revit-mcp-upstream.mjs") --baseline-only
if ($LASTEXITCODE -ne 0) {
    throw "Pinned upstream baseline verification failed with exit code $LASTEXITCODE."
}

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

& node (Join-Path $PSScriptRoot "generate-build-metadata.mjs")
if ($LASTEXITCODE -ne 0) {
    throw "Build metadata generation failed with exit code $LASTEXITCODE."
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "test-console-port.ps1")
if ($LASTEXITCODE -ne 0) {
    throw "Console port propagation test failed with exit code $LASTEXITCODE."
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

& $dotnet run --project (Join-Path $repoRoot "tests\FamilyAuthoring.Tests\FamilyAuthoring.Tests.csproj") -c $Configuration
if ($LASTEXITCODE -ne 0) {
    throw "Family authoring validation tests failed with exit code $LASTEXITCODE."
}

& $dotnet run --project (Join-Path $repoRoot "tests\CabinetAuthoring.Tests\CabinetAuthoring.Tests.csproj") -c $Configuration -- (Join-Path $repoRoot "tests\fixtures\cabinet-pilot.json")
if ($LASTEXITCODE -ne 0) {
    throw "Cabinet authoring validation tests failed with exit code $LASTEXITCODE."
}

& (Join-Path $PSScriptRoot "verify-codex-mode.ps1")

$artifactRoot = Join-Path $repoRoot "artifacts\BimPersonalAgent.Revit2024"
if (Test-Path -LiteralPath $artifactRoot) {
    $resolvedArtifacts = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts")) + "\"
    if (-not ([System.IO.Path]::GetFullPath($artifactRoot) + "\").StartsWith($resolvedArtifacts, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe artifact path: $artifactRoot"
    }
    Remove-Item -LiteralPath $artifactRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $artifactRoot -Force | Out-Null

$revitOutput = Join-Path $repoRoot "src\BimPersonalAgent.Revit\bin\$Configuration"
Get-ChildItem -LiteralPath $revitOutput | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $artifactRoot -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $repoRoot "addin\BimPersonalAgent.addin") -Destination $artifactRoot -Force

$gatewayArtifact = Join-Path $repoRoot "artifacts\BimPersonalAgent.Gateway"
if (Test-Path -LiteralPath $gatewayArtifact) {
    $resolvedArtifacts = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "artifacts")) + "\"
    if (-not ([System.IO.Path]::GetFullPath($gatewayArtifact) + "\").StartsWith($resolvedArtifacts, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe artifact path: $gatewayArtifact"
    }
    Remove-Item -LiteralPath $gatewayArtifact -Recurse -Force
}
New-Item -ItemType Directory -Path $gatewayArtifact -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "gateway\build") -Destination $gatewayArtifact -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "gateway\package.json") -Destination $gatewayArtifact -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "gateway\package-lock.json") -Destination $gatewayArtifact -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "console") -Destination $gatewayArtifact -Recurse -Force

Write-Host "Build, tests, and packaging completed."
Write-Host $artifactRoot
