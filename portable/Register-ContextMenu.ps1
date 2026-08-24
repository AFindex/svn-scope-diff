[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$exePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'SVN Scope.exe'))
$menuText = -join [char[]](0x7528, 0x0020, 0x0053, 0x0056, 0x004E, 0x0020, 0x0053, 0x0063, 0x006F, 0x0070, 0x0065, 0x0020, 0x67E5, 0x770B, 0x672C, 0x5730, 0x4FEE, 0x6539)
if (-not (Test-Path -LiteralPath $exePath -PathType Leaf)) {
    throw "SVN Scope.exe was not found beside this script: $exePath"
}

function Set-SvnScopeContextEntry {
    param(
        [Parameter(Mandatory = $true)][string]$RegistryPath,
        [Parameter(Mandatory = $true)][string]$DirectoryPlaceholder
    )

    New-Item -Path $RegistryPath -Force | Out-Null
    Set-Item -Path $RegistryPath -Value $menuText
    New-ItemProperty -Path $RegistryPath -Name 'Icon' -Value $exePath -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $RegistryPath -Name 'Position' -Value 'Top' -PropertyType String -Force | Out-Null

    $commandPath = Join-Path $RegistryPath 'command'
    New-Item -Path $commandPath -Force | Out-Null
    $command = '"' + $exePath + '" "' + $DirectoryPlaceholder + '"'
    Set-Item -Path $commandPath -Value $command
}

Set-SvnScopeContextEntry -RegistryPath 'HKCU:\Software\Classes\Directory\shell\SvnScope' -DirectoryPlaceholder '%1'
Set-SvnScopeContextEntry -RegistryPath 'HKCU:\Software\Classes\Directory\Background\shell\SvnScope' -DirectoryPlaceholder '%V'

Write-Host 'SVN Scope context menu registered for the current user.' -ForegroundColor Green
Write-Host 'Windows 11: the entry may appear under "Show more options".'
Write-Host 'Keep this portable folder in place; re-run this script after moving it.'
