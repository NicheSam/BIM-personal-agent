param(
    [string]$Version = "0.8.1",
    [string]$NodeVersion = "24.15.0",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$artifactRoot = Join-Path $repoRoot "artifacts"
$packageName = "BIMPersonalAgent-v$Version-win-x64"
$packageRoot = Join-Path $artifactRoot $packageName
$archivePath = Join-Path $artifactRoot ($packageName + ".zip")
$cacheRoot = Join-Path $artifactRoot ".release-cache"
$nodeArchiveName = "node-v$NodeVersion-win-x64.zip"
$nodeArchive = Join-Path $cacheRoot $nodeArchiveName
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/$nodeArchiveName"
$checksumsUrl = "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt"

if (-not $packageRoot.StartsWith($artifactRoot + "\", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe release package path: $packageRoot"
}
if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
New-Item -ItemType Directory -Path $packageRoot,$cacheRoot -Force | Out-Null

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot "build.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Build failed with exit code $LASTEXITCODE."
    }
}

$revitArtifacts = Join-Path $artifactRoot "BimPersonalAgent.Revit2024"
$gatewayArtifacts = Join-Path $artifactRoot "BimPersonalAgent.Gateway"
if (-not (Test-Path -LiteralPath $revitArtifacts -PathType Container)) {
    throw "Revit artifacts were not found: $revitArtifacts"
}
if (-not (Test-Path -LiteralPath $gatewayArtifacts -PathType Container)) {
    throw "Gateway artifacts were not found: $gatewayArtifacts"
}

if (-not (Test-Path -LiteralPath $nodeArchive -PathType Leaf)) {
    Write-Host "Downloading official portable Node.js $NodeVersion..."
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeArchive
}
$checksums = (Invoke-WebRequest -Uri $checksumsUrl).Content
$checksumLine = ($checksums -split "`n" | Where-Object { $_ -match ([regex]::Escape($nodeArchiveName) + '$') } | Select-Object -First 1).Trim()
if (-not $checksumLine) {
    throw "Node.js checksum was not found for $nodeArchiveName."
}
$expectedNodeHash = ($checksumLine -split '\s+')[0].ToUpperInvariant()
$actualNodeHash = (Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash
if ($actualNodeHash -ne $expectedNodeHash) {
    throw "Portable Node.js checksum mismatch."
}

$nodeExtractRoot = Join-Path $cacheRoot "node-$NodeVersion"
if (Test-Path -LiteralPath $nodeExtractRoot) {
    Remove-Item -LiteralPath $nodeExtractRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $nodeExtractRoot -Force | Out-Null
Expand-Archive -LiteralPath $nodeArchive -DestinationPath $nodeExtractRoot -Force
$nodeDistribution = Get-ChildItem -LiteralPath $nodeExtractRoot -Directory | Select-Object -First 1
if ($null -eq $nodeDistribution) {
    throw "Portable Node.js archive did not contain a distribution folder."
}

$payloadRoot = Join-Path $packageRoot "payload"
$runtimeRoot = Join-Path $payloadRoot "runtime"
$runtimeNode = Join-Path $runtimeRoot "node"
$runtimeGateway = Join-Path $runtimeRoot "gateway"
$runtimeConsole = Join-Path $runtimeRoot "console"
$payloadRevit = Join-Path $payloadRoot "revit"
$payloadSkill = Join-Path $payloadRoot "skill\bim-agent"
New-Item -ItemType Directory -Path $runtimeNode,$runtimeGateway,$runtimeConsole,$payloadRevit,(Split-Path $payloadSkill -Parent) -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $nodeDistribution.FullName "node.exe") -Destination $runtimeNode -Force
Copy-Item -LiteralPath (Join-Path $nodeDistribution.FullName "LICENSE") -Destination (Join-Path $runtimeNode "LICENSE-node.txt") -Force

Get-ChildItem -LiteralPath $revitArtifacts | Where-Object { $_.Extension -ne ".pdb" } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $payloadRevit -Recurse -Force
}

$gatewayBuildSource = Join-Path $gatewayArtifacts "build"
$gatewayBuildTarget = Join-Path $runtimeGateway "build"
Get-ChildItem -LiteralPath $gatewayBuildSource -Recurse -File | Where-Object {
    $_.Name -notmatch '\.test\.' -and $_.Extension -notin @(".map", ".ts")
} | ForEach-Object {
    $relative = $_.FullName.Substring($gatewayBuildSource.Length).TrimStart('\')
    $target = Join-Path $gatewayBuildTarget $relative
    New-Item -ItemType Directory -Path (Split-Path $target -Parent) -Force | Out-Null
    Copy-Item -LiteralPath $_.FullName -Destination $target -Force
}
Copy-Item -LiteralPath (Join-Path $gatewayArtifacts "package.json") -Destination $runtimeGateway -Force
Copy-Item -LiteralPath (Join-Path $gatewayArtifacts "package-lock.json") -Destination $runtimeGateway -Force
Get-ChildItem -LiteralPath (Join-Path $gatewayArtifacts "console") | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $runtimeConsole -Recurse -Force
}
$buildMetadataPath = Join-Path $runtimeConsole "build-metadata.json"
if (-not (Test-Path -LiteralPath $buildMetadataPath -PathType Leaf)) {
    throw "Build metadata was not found in the Console artifact."
}
Copy-Item -LiteralPath $buildMetadataPath -Destination (Join-Path $runtimeRoot "build-metadata.json") -Force
$buildMetadata = Get-Content -LiteralPath $buildMetadataPath -Encoding UTF8 -Raw | ConvertFrom-Json

Push-Location $runtimeGateway
try {
    & npm.cmd ci --omit=dev --ignore-scripts
    if ($LASTEXITCODE -ne 0) {
        throw "Production Gateway dependency install failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Copy-Item -LiteralPath (Join-Path $repoRoot "skills\bim-agent") -Destination $payloadSkill -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot "release\install.bat") -Destination $packageRoot -Force
New-Item -ItemType Directory -Path (Join-Path $packageRoot "scripts") -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $repoRoot "release\install-release.ps1") -Destination (Join-Path $packageRoot "scripts") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\configure-codex-agent.ps1") -Destination (Join-Path $packageRoot "scripts") -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "release\README.txt") -Destination $packageRoot -Force
Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md") -Destination $packageRoot -Force

$manifest = [ordered]@{
    product = "BIM Personal Agent"
    version = $Version
    platform = "win-x64"
    revitVersion = "2024"
    portableNodeVersion = $NodeVersion
    buildId = $buildMetadata.buildId
    buildHash = $buildMetadata.buildHash
    commitHash = $buildMetadata.commitHash
    buildTimeUtc = $buildMetadata.buildTimeUtc
    gatewaySchemaVersion = $buildMetadata.gatewaySchemaVersion
    consoleSchemaVersion = $buildMetadata.consoleSchemaVersion
    createdAtUtc = [DateTime]::UtcNow.ToString("o")
}
$manifestJson = $manifest | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $packageRoot "release-manifest.json"), $manifestJson + "`n", [System.Text.UTF8Encoding]::new($false))

Compress-Archive -LiteralPath $packageRoot -DestinationPath $archivePath -CompressionLevel Optimal
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
[System.IO.File]::WriteAllText($archivePath + ".sha256", "$archiveHash  $($packageName).zip`n", [System.Text.Encoding]::ASCII)

Write-Host "Release package created:"
Write-Host $archivePath
Write-Host "SHA256: $archiveHash"
