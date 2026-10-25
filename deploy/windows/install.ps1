[CmdletBinding()]
param(
  [ValidateRange(1024, 65535)]
  [int]$Port = 3000,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
if ($env:OS -ne "Windows_NT") { throw "This installer is intended for Windows PowerShell or PowerShell 7 on Windows." }
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
foreach ($relativePath in @("Dockerfile", "docker-compose.yml", "db/migrations/001_initial_schema.sql")) {
  if (-not (Test-Path -LiteralPath (Join-Path $repoRoot $relativePath) -PathType Leaf)) {
    throw "The installation bundle is incomplete: $relativePath was not found."
  }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install Docker Desktop, enable the WSL 2 backend and Linux containers, then run this installer again."
}
$previousDockerErrorActionPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  & docker compose version 2>$null | Out-Null
  $composeExitCode = $LASTEXITCODE
  & docker info 2>$null | Out-Null
  $dockerInfoExitCode = $LASTEXITCODE
} finally {
  $ErrorActionPreference = $previousDockerErrorActionPreference
}
if ($composeExitCode -ne 0) { throw "Docker Compose v2 is unavailable. Update Docker Desktop and retry." }
if ($dockerInfoExitCode -ne 0) { throw "The Docker engine is not running. Start Docker Desktop and retry." }

$environmentPath = Join-Path $repoRoot ".env"
$envLines = New-Object "System.Collections.Generic.List[string]"
if (Test-Path -LiteralPath $environmentPath -PathType Leaf) {
  foreach ($line in Get-Content -LiteralPath $environmentPath) { $envLines.Add($line) }
}

function Set-EnvSetting {
  param([System.Collections.Generic.List[string]]$Lines, [string]$Name, [string]$Value)
  $prefix = $Name + "="
  for ($index = 0; $index -lt $Lines.Count; $index++) {
    if ($Lines[$index].StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      $Lines[$index] = $prefix + $Value
      return
    }
  }
  $Lines.Add($prefix + $Value)
}
function ConvertTo-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}
function New-Pbkdf2Sha256Hash {
  param([string]$Password, [byte[]]$Salt, [int]$Iterations = 310000)
  $passwordBytes = [System.Text.Encoding]::UTF8.GetBytes($Password)
  $hmac = [System.Security.Cryptography.HMACSHA256]::new($passwordBytes)
  try {
    $blockInput = New-Object byte[] ($Salt.Length + 4)
    [Array]::Copy($Salt, 0, $blockInput, 0, $Salt.Length)
    $blockInput[$Salt.Length + 3] = 1
    $u = $hmac.ComputeHash($blockInput)
    $derived = [byte[]]$u.Clone()
    for ($round = 1; $round -lt $Iterations; $round++) {
      $u = $hmac.ComputeHash($u)
      for ($index = 0; $index -lt $derived.Length; $index++) {
        $derived[$index] = $derived[$index] -bxor $u[$index]
      }
    }
    return ("pbkdf2" + '$' + $Iterations + '$' + (ConvertTo-Base64Url $Salt) + '$' + (ConvertTo-Base64Url $derived))
  }
  finally {
    $hmac.Dispose()
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
  }
}
function New-RandomHex {
  param([int]$Bytes = 32)
  $value = New-Object byte[] $Bytes
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($value)
    return ([System.BitConverter]::ToString($value)).Replace("-", "").ToLowerInvariant()
  } finally {
    $generator.Dispose()
    [Array]::Clear($value, 0, $value.Length)
  }
}
function New-RandomPassword {
  $bytes = New-Object byte[] 24
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return ConvertTo-Base64Url $bytes
  } finally {
    $generator.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
  }
}

$passwordEntry = $null
foreach ($line in $envLines) {
  if ($line.StartsWith("POSTGRES_PASSWORD=", [System.StringComparison]::Ordinal)) {
    $passwordEntry = $line.Substring("POSTGRES_PASSWORD=".Length)
    break
  }
}
if ([string]::IsNullOrWhiteSpace($passwordEntry) -or $passwordEntry -eq "REPLACE_WITH_A_RANDOM_SECRET") {
  $passwordEntry = New-RandomHex
  Set-EnvSetting -Lines $envLines -Name "POSTGRES_PASSWORD" -Value $passwordEntry
}

$adminEmail = $envLines | Where-Object { $_.StartsWith("PID_ADMIN_EMAIL=", [System.StringComparison]::Ordinal) } | Select-Object -First 1
if ($adminEmail) { $adminEmail = $adminEmail.Substring("PID_ADMIN_EMAIL=".Length) }
if ([string]::IsNullOrWhiteSpace($adminEmail)) { $adminEmail = "admin@pid.local" }
Set-EnvSetting -Lines $envLines -Name "PID_ADMIN_EMAIL" -Value $adminEmail

$hashEntry = $null
foreach ($line in $envLines) {
  if ($line.StartsWith("PID_ADMIN_PASSWORD_HASH=", [System.StringComparison]::Ordinal)) {
    $hashEntry = $line.Substring("PID_ADMIN_PASSWORD_HASH=".Length)
    break
  }
}
$generatedAdminPassword = $null
if ([string]::IsNullOrWhiteSpace($hashEntry) -or $hashEntry -eq "REPLACE_WITH_GENERATED_PBKDF2_HASH") {
  $generatedAdminPassword = New-RandomPassword
  $salt = New-Object byte[] 16
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($salt) } finally { $generator.Dispose() }
  $hashEntry = New-Pbkdf2Sha256Hash -Password $generatedAdminPassword -Salt $salt
  [Array]::Clear($salt, 0, $salt.Length)
  Set-EnvSetting -Lines $envLines -Name "PID_ADMIN_PASSWORD_HASH" -Value $hashEntry
}

$sessionSecret = $null
foreach ($line in $envLines) {
  if ($line.StartsWith("PID_SESSION_SECRET=", [System.StringComparison]::Ordinal)) {
    $sessionSecret = $line.Substring("PID_SESSION_SECRET=".Length)
    break
  }
}
if ([string]::IsNullOrWhiteSpace($sessionSecret) -or $sessionSecret -eq "REPLACE_WITH_A_RANDOM_SECRET") {
  $sessionSecret = New-RandomHex
  Set-EnvSetting -Lines $envLines -Name "PID_SESSION_SECRET" -Value $sessionSecret
}
Set-EnvSetting -Lines $envLines -Name "APP_PORT" -Value ([string]$Port)
if (-not ($envLines | Where-Object { $_.StartsWith("APP_BIND_ADDRESS=", [System.StringComparison]::Ordinal) })) {
  Set-EnvSetting -Lines $envLines -Name "APP_BIND_ADDRESS" -Value "127.0.0.1"
}
[System.IO.File]::WriteAllLines($environmentPath, $envLines.ToArray(), [System.Text.Encoding]::ASCII)
try {
  $environmentAcl = Get-Acl -LiteralPath $environmentPath
  $environmentAcl.SetAccessRuleProtection($true, $false)
  foreach ($rule in @($environmentAcl.Access)) {
    [void]$environmentAcl.RemoveAccessRuleSpecific($rule)
  }
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $ownerRule = New-Object System.Security.AccessControl.FileSystemAccessRule($currentUser, "FullControl", "Allow")
  $environmentAcl.SetAccessRule($ownerRule)
  Set-Acl -LiteralPath $environmentPath -AclObject $environmentAcl
}
catch {
  throw "Could not restrict access to the generated .env credentials file: $($_.Exception.Message)"
}

if ($generatedAdminPassword) {
  Write-Output ("Administrator email: " + $adminEmail)
  Write-Output ("Administrator password (shown once; save it now): " + $generatedAdminPassword)
}

$previousPort = $env:APP_PORT
try {
  $env:APP_PORT = [string]$Port
  Push-Location $repoRoot
  try {
    & docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose could not build and start P&ID Flow Pro." }
  } finally { Pop-Location }
} finally {
  if ($null -eq $previousPort) { Remove-Item Env:APP_PORT -ErrorAction SilentlyContinue }
  else { $env:APP_PORT = $previousPort }
}

$url = "http://localhost:$Port"
Write-Output "P&ID Flow Pro is starting at $url"
if (-not $NoOpen) { Start-Process $url }
