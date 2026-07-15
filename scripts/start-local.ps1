$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

$Node = 'C:\Program Files\nodejs\node.exe'
$Npm = 'C:\Program Files\nodejs\npm.cmd'
if (-not (Test-Path -LiteralPath $Node)) {
  Write-Host 'Node.js was not found. Install Node.js LTS first.' -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$env:Path = 'C:\Program Files\nodejs;' + $env:Path
if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
  Write-Host 'First run: installing required files...'
  & $Npm install --no-audit --no-fund
}
if (
  -not (Test-Path -LiteralPath (Join-Path $Root 'dist-server\server\index.js')) -or
  -not (Test-Path -LiteralPath (Join-Path $Root 'dist\index.html'))
) {
  Write-Host 'Preparing the application...'
  & $Npm run build
}

$Url = 'http://127.0.0.1:4317'
try {
  $Existing = Invoke-RestMethod -Uri ($Url + '/api/health') -TimeoutSec 2
  if ($Existing.ok) {
    if ($env:DIL_NO_BROWSER -ne '1') {
      Start-Process $Url
    }
    Write-Host 'The application is already running.'
    Read-Host 'Press Enter to close'
    exit 0
  }
} catch {
  # No existing local server; continue and start it.
}

$env:NODE_ENV = 'production'
$env:PORT = '4317'
$ServerEntry = Join-Path $Root 'dist-server\server\index.js'
$ServerArgument = '"' + $ServerEntry + '"'
$Server = Start-Process -FilePath $Node -ArgumentList @($ServerArgument) -WorkingDirectory $Root -WindowStyle Hidden -PassThru

try {
  $Ready = $false
  for ($Attempt = 0; $Attempt -lt 60; $Attempt++) {
    if ($Server.HasExited) {
      throw 'The local server failed to start.'
    }
    try {
      $Health = Invoke-RestMethod -Uri ($Url + '/api/health') -TimeoutSec 2
      if ($Health.ok) {
        $Ready = $true
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if (-not $Ready) {
    throw 'The local server timed out while starting.'
  }
  if ($env:DIL_NO_BROWSER -ne '1') {
    Start-Process $Url
  }
  Write-Host ''
  Write-Host 'Do It Laaaaaater is running at: ' -NoNewline
  Write-Host $Url -ForegroundColor Cyan
  Write-Host 'Keep this window open while using the app. Press Ctrl+C to stop.'
  Wait-Process -Id $Server.Id
} finally {
  if ($Server -and -not $Server.HasExited) {
    Stop-Process -Id $Server.Id -Force
  }
}
