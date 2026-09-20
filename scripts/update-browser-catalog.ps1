$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$catalogPath = Join-Path $rootDir "deploy\selenium\browser-catalog.yaml"

Write-Host "Checking browser catalog: $catalogPath" -ForegroundColor Cyan

if (-not (Test-Path $catalogPath)) {
    Write-Host "[FAIL] browser-catalog.yaml does not exist." -ForegroundColor Red
    exit 1
}

$content = Get-Content $catalogPath -Raw
if ($content -notmatch "(?m)^browsers:\s*$") {
    Write-Host "[FAIL] Missing top-level browsers: node." -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Basic browser-catalog.yaml structure is present." -ForegroundColor Green
Write-Host "Full schema validation runs when Control API loads the catalog." -ForegroundColor DarkGray
exit 0
