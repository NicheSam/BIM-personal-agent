param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

if (-not $SkipBuild) {
    & (Join-Path $PSScriptRoot "build.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "Build step failed."
    }
}

$artifactRoot = Join-Path $repoRoot "artifacts\BimPersonalAgent.Revit2024"
$addinRoot = Join-Path $env:APPDATA "Autodesk\Revit\Addins\2024"
$pluginRoot = Join-Path $addinRoot "BimPersonalAgent\current"

New-Item -ItemType Directory -Path $pluginRoot -Force | Out-Null
Get-ChildItem -LiteralPath $artifactRoot | Where-Object { $_.Name -ne "BimPersonalAgent.addin" } | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $pluginRoot -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $artifactRoot "BimPersonalAgent.addin") -Destination $addinRoot -Force

Write-Host "Installed BIM Personal Agent for Revit 2024."
if (Get-Process -Name Revit -ErrorAction SilentlyContinue) {
    Write-Host "Revit is running. Restart Revit before testing the add-in."
}
