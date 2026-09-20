Param(
    [Parameter(Mandatory = $true)]
    [string]$ZipPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ZipPath)) {
    throw "Backup file does not exist: $ZipPath"
}

$rootDir = Split-Path -Parent $PSScriptRoot
$dbDir = Join-Path $rootDir "data\db"
if (-not (Test-Path $dbDir)) {
    New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
}

$tempFolder = Join-Path $env:TEMP ("jingcang-restore-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
Expand-Archive -Path $ZipPath -DestinationPath $tempFolder -Force

$restoredDb = Join-Path $tempFolder "jingcang.sqlite"
if (-not (Test-Path $restoredDb)) {
    Remove-Item $tempFolder -Recurse -Force
    throw "Backup does not contain jingcang.sqlite."
}

$containerName = "jingcang-control-api-1"
$volumeName = "jingcang_db"
$helperName = "jingcang-db-restore-$PID"
$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
$restoredDocker = $false
$wasRunning = $false

Write-Host "Restoring JingCang backup..." -ForegroundColor Cyan

try {
    if ($dockerAvailable) {
        & docker volume inspect $volumeName *> $null
        $hasVolume = $LASTEXITCODE -eq 0
        & docker image inspect "jingcang-control-api:latest" *> $null
        $hasImage = $LASTEXITCODE -eq 0
        & docker inspect $containerName *> $null
        $hasMainContainer = $LASTEXITCODE -eq 0

        if ($hasVolume -and $hasImage) {
            if ($hasMainContainer) {
                $wasRunning = ((& docker inspect -f "{{.State.Running}}" $containerName).Trim() -eq "true")
                if ($wasRunning) {
                    & docker stop $containerName | Out-Null
                    if ($LASTEXITCODE -ne 0) {
                        throw "Failed to stop Control API container."
                    }
                }
            }

            & docker run -d --name $helperName -v "${volumeName}:/db" "jingcang-control-api:latest" sh -lc "sleep 300" | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to create restore helper container."
            }

            & docker cp $restoredDb "${helperName}:/tmp/jingcang.sqlite"
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to copy database into restore helper."
            }

            & docker exec $helperName sh -lc "rm -f /db/jingcang.sqlite /db/jingcang.sqlite-wal /db/jingcang.sqlite-shm && cp /tmp/jingcang.sqlite /db/jingcang.sqlite"
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to restore Docker database volume."
            }

            $restoredDocker = $true
        }
    }

    Copy-Item $restoredDb (Join-Path $dbDir "jingcang.sqlite") -Force
    Remove-Item (Join-Path $dbDir "jingcang.sqlite-wal") -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $dbDir "jingcang.sqlite-shm") -Force -ErrorAction SilentlyContinue

    $restoredCatalog = Join-Path $tempFolder "browser-catalog.yaml"
    if (Test-Path $restoredCatalog) {
        Copy-Item $restoredCatalog (Join-Path $rootDir "deploy\selenium\browser-catalog.yaml") -Force
    }

    if ($restoredDocker) {
        Write-Host "Docker volume and host database copy restored." -ForegroundColor Green
    } else {
        Write-Host "Host database restored; Docker volume was not available." -ForegroundColor Green
    }
} finally {
    if ($dockerAvailable) {
        & docker rm -f $helperName *> $null
        if ($wasRunning) {
            & docker start $containerName | Out-Null
        }
    }
    if (Test-Path $tempFolder) {
        Remove-Item $tempFolder -Recurse -Force
    }
}
