[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$composeFile = Join-Path $repoRoot "docker-compose.yml"

if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) {
  throw "docker-compose.yml was not found. Run this script from the extracted installation bundle."
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install Docker Desktop before removing the application container."
}

Push-Location $repoRoot
try {
  & docker compose down
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Compose could not stop the P&ID Flow Pro application."
  }
}
finally {
  Pop-Location
}

Write-Output "P&ID Flow Pro has been stopped. The application image and Docker volumes were preserved."
