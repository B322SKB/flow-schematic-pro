[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 3000,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "This installer is intended for Windows PowerShell or PowerShell 7 on Windows."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
foreach ($relativePath in @("Dockerfile", "docker-compose.yml")) {
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relativePath) -PathType Leaf)) {
    throw "The installation bundle is incomplete: $relativePath was not found."
  }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install Docker Desktop, enable the WSL 2 backend and Linux containers, then run this installer again."
}

& docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Compose v2 is unavailable. Update Docker Desktop and retry."
}

& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "The Docker engine is not running. Start Docker Desktop and retry."
}

$previousPort = $env:APP_PORT
try {
  $env:APP_PORT = [string]$Port
  Push-Location $repoRoot
  try {
    & docker compose up -d --build
    if ($LASTEXITCODE -ne 0) {
      throw "Docker Compose could not build and start P&ID Flow Pro."
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  if ($null -eq $previousPort) {
    Remove-Item Env:APP_PORT -ErrorAction SilentlyContinue
  }
  else {
    $env:APP_PORT = $previousPort
  }
}

$url = "http://localhost:$Port"
Write-Output "P&ID Flow Pro is starting at $url"
if (-not $NoOpen) {
  Start-Process $url
}
