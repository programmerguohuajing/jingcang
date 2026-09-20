$ErrorActionPreference = "Stop"

$rootDir = Split-Path -Parent $PSScriptRoot
$backupDir = Join-Path $rootDir "backups"
if (-not (Test-Path $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$zipPath = Join-Path $backupDir "jingcang-backup-$timestamp.zip"
$tempFolder = Join-Path $env:TEMP "jingcang-backup-$timestamp"
New-Item -ItemType Directory -Path $tempFolder -Force | Out-Null

$containerName = "jingcang-control-api-1"
$dbCopied = $false
$wasRunning = $false
$dockerAvailable = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)

Write-Host "Creating JingCang backup..." -ForegroundColor Cyan

try {
    if ($dockerAvailable) {
        & docker inspect $containerName *> $null
        if ($LASTEXITCODE -eq 0) {
            $wasRunning = ((& docker inspect -f "{{.State.Running}}" $containerName).Trim() -eq "true")
            if ($wasRunning) {
                Write-Host "Stopping Control API briefly for a consistent SQLite backup..." -ForegroundColor Yellow
                & docker stop $containerName | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    throw "Failed to stop Control API container."
                }
            }

            & docker cp "${containerName}:/app/data/db/jingcang.sqlite" (Join-Path $tempFolder "jingcang.sqlite")
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to copy SQLite database from Docker volume."
            }
            $dbCopied = $true
        }
    }

    if (-not $dbCopied) {
        $hostDb = Join-Path $rootDir "data\db\jingcang.sqlite"
        if (Test-Path $hostDb) {
            Copy-Item $hostDb (Join-Path $tempFolder "jingcang.sqlite") -Force
            $dbCopied = $true
        }
    }

    if (-not $dbCopied) {
        throw "No JingCang SQLite database was found."
    }

    $catalogPath = Join-Path $rootDir "deploy\selenium\browser-catalog.yaml"
    if (Test-Path $catalogPath) {
        Copy-Item $catalogPath (Join-Path $tempFolder "browser-catalog.yaml") -Force
    }

    Compress-Archive -Path (Join-Path $tempFolder "*") -DestinationPath $zipPath -Force
    Write-Host "Backup created: $zipPath" -ForegroundColor Green
} finally {
    if ($wasRunning -and $dockerAvailable) {
        & docker start $containerName | Out-Null
    }
    if (Test-Path $tempFolder) {
        Remove-Item $tempFolder -Recurse -Force
    }
}
