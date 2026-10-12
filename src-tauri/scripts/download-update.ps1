param([string]$Version, [string]$Sha256, [string]$Directory)
$ErrorActionPreference = 'Stop'
function Get-UpdateFileHash([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $inputStream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($inputStream)).Replace('-', '') }
    finally { $inputStream.Dispose(); $algorithm.Dispose() }
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$archivePath = Join-Path $Directory 'update.zip'
$exePath = Join-Path $Directory 'SVN Scope.exe'
Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 -Uri "https://github.com/AFindex/svn-scope-diff/releases/download/v$Version/SVN-Scope-$Version-win-x64.zip" -OutFile $archivePath
if ((Get-UpdateFileHash $archivePath) -ne $Sha256) { throw 'Update archive SHA-256 mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entry = $archive.GetEntry('SVN Scope.exe')
    if ($null -eq $entry) { throw 'Update archive does not contain SVN Scope.exe' }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $exePath, $true)
} finally { $archive.Dispose() }
(Get-UpdateFileHash $exePath) | Set-Content -LiteralPath (Join-Path $Directory 'exe.sha256') -Encoding ascii
