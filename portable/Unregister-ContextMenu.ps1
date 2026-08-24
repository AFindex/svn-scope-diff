[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$registryPaths = @(
    'HKCU:\Software\Classes\Directory\shell\SvnScope',
    'HKCU:\Software\Classes\Directory\Background\shell\SvnScope'
)

foreach ($registryPath in $registryPaths) {
    if (Test-Path -Path $registryPath) {
        Remove-Item -Path $registryPath -Recurse -Force
    }
}

Write-Host 'SVN Scope context menu removed for the current user.' -ForegroundColor Green
Write-Host 'You can now delete the portable folder.'
