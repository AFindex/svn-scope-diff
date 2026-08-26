[CmdletBinding()]
param(
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$portableRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'dist-portable'))
$portableDirectory = [System.IO.Path]::GetFullPath((Join-Path $portableRoot 'SVN Scope 0.1.15'))
$stableDirectory = [System.IO.Path]::GetFullPath((Join-Path $portableRoot 'SVN Scope'))
$sourceExe = Join-Path $projectRoot 'src-tauri\target\release\svn-scope.exe'
$archive = Join-Path $portableRoot 'SVN-Scope-0.1.15-win-x64.zip'
$npmCommand = (Get-Command 'npm.cmd' -ErrorAction Stop).Source

if (-not $portableRoot.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to write outside the project: $portableRoot"
}

Push-Location $projectRoot
try {
    if (-not $SkipInstall -and -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
        & $npmCommand ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    }

    & $npmCommand run tauri -- build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw 'Tauri release build failed.' }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Release executable was not produced: $sourceExe"
}

if (Test-Path -LiteralPath $portableDirectory) {
    $resolvedPortable = [System.IO.Path]::GetFullPath($portableDirectory)
    if (-not $resolvedPortable.StartsWith($portableRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to replace an unexpected directory: $resolvedPortable"
    }
    Remove-Item -LiteralPath $resolvedPortable -Recurse -Force
}

New-Item -ItemType Directory -Path $portableDirectory -Force | Out-Null
Copy-Item -LiteralPath $sourceExe -Destination (Join-Path $portableDirectory 'SVN Scope.exe')

Get-ChildItem -LiteralPath (Join-Path $projectRoot 'portable') -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $portableDirectory
}

$portableExe = Join-Path $portableDirectory 'SVN Scope.exe'
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$stream = [System.IO.File]::OpenRead($portableExe)
try {
    $hashValue = [System.BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
}
finally {
    $stream.Dispose()
    $sha256.Dispose()
}
"$hashValue  SVN Scope.exe" | Set-Content -LiteralPath (Join-Path $portableDirectory 'SHA256SUMS.txt') -Encoding utf8

if (Test-Path -LiteralPath $archive) {
    Remove-Item -LiteralPath $archive -Force
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $portableDirectory,
    $archive,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
)

$stableUpdated = $false
try {
    New-Item -ItemType Directory -Path $stableDirectory -Force | Out-Null
    Copy-Item -LiteralPath $portableExe -Destination (Join-Path $stableDirectory 'SVN Scope.exe') -Force -ErrorAction Stop
    Get-ChildItem -LiteralPath $portableDirectory -File |
        Where-Object { $_.Name -ne 'SVN Scope.exe' } |
        ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $stableDirectory -Force }
    $stableUpdated = $true
}
catch {
    Write-Warning 'The versioned build succeeded, but the stable portable folder is in use. Close SVN Scope and run the build again to refresh the registered path.'
}

Write-Host ''
Write-Host 'Portable build ready:' -ForegroundColor Green
Write-Host "  Folder: $portableDirectory"
Write-Host "  ZIP:    $archive"
Write-Host "  SHA256: $hashValue"
if ($stableUpdated) {
    Write-Host "  Stable: $stableDirectory"
}
