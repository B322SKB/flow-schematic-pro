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
foreach ($relativePath in @("Dockerfile", "docker-compose.yml", "db/migrations/001_initial_schema.sql")) {
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

$environmentPath = Join-Path $repoRoot ".env"
$envLines = New-Object "System.Collections.Generic.List[string]"
if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
  foreach ($line in Get-Content -LiteralPath $environmentPath) {
    $envLines.Add($line)
  }
}

function Set-EnvSetting {
  param(
    [System.Collections.Generic.List[string]]$Lines,
    [string]$Name,
    [string]$Value
  )
  $prefix = $Name + "="
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index].StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      $Lines[$index] = $prefix + $Value
      return
    }
  }
  $Lines.Add($prefix + $Value)
}

$passwordEntry = $null
foreach ($line in $envLines) {
  if ($line.StartsWith("POSTGRES_PASSWORD=", [System.StringComparison]::Ordinal)) {
    $passwordEntry = $line.Substring("POSTGRES_PASSWORD=".Length)
    break
  }
}
if ([string]::IsNullOrWhiteSpace($passwordEntry) -or $passwordEntry -eq "REPLACE_WITH_A_RANDOM_SECRET") {
  $bytes = New-Object byte[] 32
  $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $random.GetBytes($bytes)
  }
  finally {
    $random.Dispose()
  }
  $passwordEntry = ([System.BitConverter]::ToString($bytes)).Replace("-", "").ToLowerInvariant()
  Set-EnvSetting -Lines $envLines -Name "POSTGRES_PASSWORD" -Value $passwordEntry
}

Set-EnvSetting -Lines $envLines -Name "APP_PORT" -Value ([string]$Port)
if (-not ($envLines | Where-Object { $_.StartsWith("APP_BIND_ADDRESS=", [System.StringComparison]::Ordinal) })) {
  Set-EnvSetting -Lines $envLines -Name "APP_BIND_ADDRESS" -Value "127.0.0.1"
}
[System.IO.File]::WriteAllLines($environmentPath, $envLines.ToArray(), [System.Text.Encoding]::ASCII)

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
