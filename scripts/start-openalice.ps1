param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Assert-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

function Assert-PortAvailable($port) {
  $existing = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existing) {
    throw "Port $port is already in use by PID $($existing.OwningProcess). Stop the running service first."
  }
}

Assert-Command "codex"
Assert-Command "corepack"

$loginStatus = & cmd /c "codex login status 2>&1"
if ($LASTEXITCODE -ne 0 -or ($loginStatus -join "`n") -notmatch "Logged in") {
  Write-Host "Codex is not logged in yet. Run `codex login` first." -ForegroundColor Yellow
  exit 1
}

Assert-PortAvailable 3001
Assert-PortAvailable 3002
Assert-PortAvailable 6901

if (-not $NoBrowser) {
  Start-Job -ScriptBlock {
    Start-Sleep -Seconds 6
    Start-Process "http://localhost:3002"
  } | Out-Null
}

Write-Host "Starting Open Alice with Codex CLI..." -ForegroundColor Cyan
& corepack pnpm dev
