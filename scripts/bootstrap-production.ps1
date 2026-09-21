$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $rootDir "deploy\.env.production.example"
$targetPath = Join-Path $rootDir "deploy\.env.production"

function New-SecureToken([int]$ByteLength) {
    $buffer = New-Object byte[] $ByteLength
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }

    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

if (-not (Test-Path $sourcePath)) {
    throw "Production environment template not found: $sourcePath"
}

if (Test-Path $targetPath) {
    Write-Host "Production environment already exists: $targetPath" -ForegroundColor Yellow
    Write-Host "Existing production secrets were preserved." -ForegroundColor Yellow
    exit 0
}

$content = Get-Content $sourcePath -Raw
$sessionSecret = New-SecureToken 48
$viewerSecret = New-SecureToken 48
$adminPassword = "jc-admin-" + (New-SecureToken 18)

$content = $content.Replace(
    "JINGCANG_SESSION_SECRET=change-me-session-secret-min-32-chars",
    "JINGCANG_SESSION_SECRET=$sessionSecret"
)
$content = $content.Replace(
    "JINGCANG_VIEWER_SECRET=change-me-viewer-secret-min-32-chars",
    "JINGCANG_VIEWER_SECRET=$viewerSecret"
)
$content = $content.Replace(
    "JINGCANG_ADMIN_INITIAL_PASSWORD=change-me-admin-password-min-12-chars",
    "JINGCANG_ADMIN_INITIAL_PASSWORD=$adminPassword"
)

Set-Content -Path $targetPath -Value $content -Encoding UTF8
Write-Host "Created production environment: $targetPath" -ForegroundColor Green
Write-Host "Initial admin username: admin" -ForegroundColor Cyan
Write-Host "Initial admin password: $adminPassword" -ForegroundColor Cyan
Write-Host "Store this password securely and change it after first login." -ForegroundColor Yellow
