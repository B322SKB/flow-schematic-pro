$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$requiredFiles = @(
  "Dockerfile",
  "docker-compose.yml",
  "deploy/windows/install.ps1",
  "deploy/windows/uninstall.ps1",
  "docs/windows-install.md"
)

foreach ($relativePath in $requiredFiles) {
  $path = Join-Path $repoRoot $relativePath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Windows install package is missing: $relativePath"
  }
}

foreach ($relativePath in @("deploy/windows/install.ps1", "deploy/windows/uninstall.ps1")) {
  $path = Join-Path $repoRoot $relativePath
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$parseErrors) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw ("PowerShell syntax errors in " + $relativePath + ": " + ($parseErrors -join "; "))
  }
}

$installScript = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "deploy/windows/install.ps1")
$uninstallScript = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "deploy/windows/uninstall.ps1")
$deploymentGuide = Get-Content -Raw -LiteralPath (Join-Path $repoRoot "docs/windows-install.md")

if ($installScript -notmatch "docker compose up -d --build") {
  throw "Installer must build and start the Compose application."
}
if ($uninstallScript -match "down\s+(-v|--volumes)") {
  throw "Uninstaller must not remove persistent Docker volumes."
}
if ($deploymentGuide -notmatch "localStorage" -or $deploymentGuide -notmatch "PostgreSQL") {
  throw "Windows deployment guide must state current persistence and PostgreSQL limitations."
}

Write-Output "Windows install package checks passed."
