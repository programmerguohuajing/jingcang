$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $rootDir ".env"
$envExamplePath = Join-Path $rootDir ".env.example"

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

Write-Host "Initializing JingCang..." -ForegroundColor Cyan

if (-not (Test-Path $envPath)) {
    Copy-Item $envExamplePath $envPath
    Write-Host "Created .env from .env.example." -ForegroundColor Green
}

$envContent = Get-Content $envPath -Raw
$changed = $false
$generatedAdminPassword = $null

$sessionPattern = 'JINGCANG_SESSION_SECRET=(change-me-[^\r\n]*|jingcang-default-session-secret-key-32chars)'
if ($envContent -match $sessionPattern) {
    $sessionSecret = New-SecureToken 48
    $envContent = $envContent -replace $sessionPattern, "JINGCANG_SESSION_SECRET=$sessionSecret"
    $changed = $true
}

$viewerPattern = 'JINGCANG_VIEWER_SECRET=(change-me-[^\r\n]*|jingcang-default-viewer-secret-key-32chars)'
if ($envContent -match $viewerPattern) {
    $viewerSecret = New-SecureToken 48
    $envContent = $envContent -replace $viewerPattern, "JINGCANG_VIEWER_SECRET=$viewerSecret"
    $changed = $true
}

$adminPattern = 'JINGCANG_ADMIN_INITIAL_PASSWORD=(change-me-[^\r\n]*|admin-initial-password-123)'
if ($envContent -match $adminPattern) {
    $generatedAdminPassword = "jc-admin-" + (New-SecureToken 18)
    $envContent = $envContent -replace $adminPattern, "JINGCANG_ADMIN_INITIAL_PASSWORD=$generatedAdminPassword"
    $changed = $true
}

if ($changed) {
    Set-Content -Path $envPath -Value $envContent -Encoding UTF8
    Write-Host "Replaced insecure placeholder values in .env." -ForegroundColor Green
} else {
    Write-Host "Existing secure .env values were preserved." -ForegroundColor DarkGray
}

if ($generatedAdminPassword) {
    Write-Host "Initial admin username: admin" -ForegroundColor Yellow
    Write-Host "Initial admin password: $generatedAdminPassword" -ForegroundColor Yellow
    Write-Host "Change the admin password after first login." -ForegroundColor Yellow
}

foreach ($relativeDir in @("data\db", "data\artifacts", "data\logs")) {
    $dir = Join-Path $rootDir $relativeDir
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

Write-Host "JingCang initialization completed." -ForegroundColor Green
