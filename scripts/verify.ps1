Param(
    [string]$TargetUrl = "http://localhost:8088"
)

$ErrorActionPreference = "Stop"

Write-Host "JingCang verification started: $TargetUrl" -ForegroundColor Cyan

try {
    $live = Invoke-RestMethod -Uri "$TargetUrl/health/live" -Method Get -TimeoutSec 5
    if ($live.status -ne "UP") {
        throw "Liveness status is not UP."
    }
    Write-Host "[OK] Liveness: $($live.status)" -ForegroundColor Green
} catch {
    Write-Host "[FAIL] Liveness check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

try {
    $ready = Invoke-RestMethod -Uri "$TargetUrl/health/ready" -Method Get -TimeoutSec 8
    if ($ready.status -ne "UP") {
        throw "Readiness status is not UP."
    }
    Write-Host "[OK] Readiness: $($ready.status)" -ForegroundColor Green
    if ($ready.components) {
        Write-Host "     DB: $($ready.components.db.status); Grid: $($ready.components.grid.status)" -ForegroundColor DarkGray
    }
} catch {
    Write-Host "[FAIL] Readiness check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

try {
    $catalog = Invoke-RestMethod -Uri "$TargetUrl/api/v1/browsers" -Method Get -TimeoutSec 5
    $items = @($catalog.data)
    if ($items.Count -lt 1) {
        throw "No enabled browser entries were returned."
    }

    Write-Host "[OK] Enabled browser entries: $($items.Count)" -ForegroundColor Green
    foreach ($item in $items) {
        Write-Host "     $($item.id) - $($item.displayName) ($($item.version))" -ForegroundColor DarkGray
    }
} catch {
    Write-Host "[FAIL] Browser catalog check failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host "JingCang verification completed successfully." -ForegroundColor Green
exit 0
