$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

$Npm = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path -LiteralPath $Npm)) {
  Write-Host 'Node.js was not found.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$Email = Read-Host 'Account email'
$First = Read-Host 'New password (at least 10 characters)' -AsSecureString
$Second = Read-Host 'Enter the new password again' -AsSecureString
$FirstPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($First)
$SecondPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Second)

try {
  $FirstText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($FirstPtr)
  $SecondText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($SecondPtr)
  if ($FirstText -ne $SecondText) {
    Write-Host 'The two passwords do not match.' -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
  }
  $env:Path = 'C:\Program Files\nodejs;' + $env:Path
  $env:RESET_EMAIL = $Email
  $env:RESET_PASSWORD = $FirstText
  & $Npm run account:reset
} finally {
  Remove-Item Env:RESET_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:RESET_PASSWORD -ErrorAction SilentlyContinue
  if ($FirstPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($FirstPtr)
  }
  if ($SecondPtr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($SecondPtr)
  }
}

Read-Host 'Press Enter to close'
