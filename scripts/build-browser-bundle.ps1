Param(
    [string]$ImageRepository = "jingcang/browser-bundle",
    [string]$Tag = "",
    [switch]$KeepTar
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
$bundleDir = Join-Path $rootDir "deploy\browser-bundle"
$imagesFile = Join-Path $bundleDir "images.txt"
$tarPath = Join-Path $bundleDir "browsers.tar"

Set-Location $rootDir

if (-not $Tag) {
    $Tag = (& node -p "require('./package.json').version").Trim()
}

$images = Get-Content $imagesFile | Where-Object { $_ -and -not $_.Trim().StartsWith("#") }
if (-not $images -or $images.Count -eq 0) {
    throw "No browser images configured in $imagesFile"
}

Write-Host "Validating bundled browser images..." -ForegroundColor Cyan
foreach ($image in $images) {
    & docker image inspect $image *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Required browser image is not available locally: $image"
    }
}

try {
    if (Test-Path $tarPath) { Remove-Item $tarPath -Force }
    Write-Host "Exporting browser images with shared layers preserved..." -ForegroundColor Cyan
    & docker save -o $tarPath @images
    if ($LASTEXITCODE -ne 0) { throw "docker save failed." }

    $tarSizeGb = [Math]::Round(((Get-Item $tarPath).Length / 1GB), 2)
    Write-Host "Browser archive size: $tarSizeGb GB" -ForegroundColor DarkGray

    $bundleImage = $ImageRepository + ":" + $Tag
    Write-Host "Building browser bundle image: $bundleImage" -ForegroundColor Cyan
    & docker build -f (Join-Path $bundleDir "Dockerfile") -t $bundleImage $bundleDir
    if ($LASTEXITCODE -ne 0) { throw "Browser bundle image build failed." }

    $size = & docker image inspect $bundleImage --format "{{.Size}}"
    $sizeGb = [Math]::Round(([double]$size / 1GB), 2)
    Write-Host "Browser bundle built successfully." -ForegroundColor Green
    Write-Host "Image: $bundleImage" -ForegroundColor Green
    Write-Host "Size: $sizeGb GB" -ForegroundColor DarkGray
} finally {
    if (-not $KeepTar -and (Test-Path $tarPath)) {
        Remove-Item $tarPath -Force
    }
}