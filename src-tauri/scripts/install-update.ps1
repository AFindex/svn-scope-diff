param([string]$Target, [string]$Directory, [int]$ParentId)
$ErrorActionPreference = 'Stop'
function Get-UpdateFileHash([string]$Path) {
    $algorithm = [Security.Cryptography.SHA256]::Create()
    $inputStream = [IO.File]::OpenRead($Path)
    try { return [BitConverter]::ToString($algorithm.ComputeHash($inputStream)).Replace('-', '') }
    finally { $inputStream.Dispose(); $algorithm.Dispose() }
}

$backupPath = "$Target.backup"
$pendingPath = "$Target.pending"
$logPath = Join-Path $Directory 'install.log'
$didBackup = $false
try {
    $process = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
    if ($null -ne $process -and -not $process.WaitForExit(120000)) { throw 'Client did not exit in time' }
    $sourcePath = Join-Path $Directory 'SVN Scope.exe'
    $expectedHash = (Get-Content -LiteralPath (Join-Path $Directory 'exe.sha256') -Raw).Trim()
    if ((Get-UpdateFileHash $sourcePath) -ne $expectedHash) { throw 'Staged executable checksum mismatch' }
    Copy-Item -LiteralPath $sourcePath -Destination $pendingPath -Force
    Move-Item -LiteralPath $Target -Destination $backupPath -Force
    $didBackup = $true
    Move-Item -LiteralPath $pendingPath -Destination $Target -Force
    Start-Process -FilePath $Target -WorkingDirectory (Split-Path -Parent $Target) -WindowStyle Hidden
    'Update installed successfully' | Set-Content -LiteralPath $logPath
    # Cleanup failure must not roll back an already started client
    try { Remove-Item -LiteralPath $backupPath -Force }
    catch { $_ | Out-String | Add-Content -LiteralPath $logPath -ErrorAction SilentlyContinue }
} catch {
    $_ | Out-String | Set-Content -LiteralPath $logPath
    if ($didBackup) { Copy-Item -LiteralPath $backupPath -Destination $Target -Force }
    if (Test-Path -LiteralPath $Target) { Start-Process -FilePath $Target -WindowStyle Hidden }
}
