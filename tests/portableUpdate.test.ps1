$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("svn-scope-update-test-" + [Guid]::NewGuid().ToString('N'))
$stagePath = Join-Path $testRoot 'stage'
New-Item -ItemType Directory -Path $stagePath -Force | Out-Null
$targetPath = Join-Path $testRoot 'client.exe'
$sourcePath = Join-Path $stagePath 'SVN Scope.exe'
$scriptPath = Join-Path $PSScriptRoot '../src-tauri/scripts/install-update.ps1'
# Use existing Windows executables with no persistent side effects
Copy-Item -LiteralPath "$env:SystemRoot/System32/hostname.exe" -Destination $targetPath
Copy-Item -LiteralPath "$env:SystemRoot/System32/where.exe" -Destination $sourcePath
function Get-TestHash([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $algorithm.Dispose() }
}
$oldHash = Get-TestHash $targetPath
$newHash = Get-TestHash $sourcePath
$newHash | Set-Content -LiteralPath (Join-Path $stagePath 'exe.sha256') -Encoding ascii
& $scriptPath -Target $targetPath -Directory $stagePath -ParentId 2147483647
if ((Get-TestHash $targetPath) -ne $newHash) { throw 'Update was not installed' }
if ((Get-TestHash "$targetPath.backup") -ne $oldHash) { throw 'Old client backup was not preserved' }
'wrong hash' | Set-Content -LiteralPath (Join-Path $stagePath 'exe.sha256') -Encoding ascii
& $scriptPath -Target $targetPath -Directory $stagePath -ParentId 2147483647
if ((Get-TestHash $targetPath) -ne $newHash) { throw 'A corrupted update replaced the client' }
$failureLog = [IO.File]::ReadAllText((Join-Path $stagePath 'install.log'))
if (-not $failureLog.Contains('checksum mismatch')) { throw 'Missing installation failure diagnosis' }
Write-Output "PASS: installation, backup and checksum rejection. Test files: $testRoot"
