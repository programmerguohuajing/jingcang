Param(
    [string]$ImageRepository = "jingcang/control-api",
    [string]$BrowserBundleRepository = "jingcang/browser-bundle",
    [string]$Tag = "",
    [switch]$TagLatest,
    [switch]$SkipBrowserBundle
)

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent $PSScriptRoot
Set-Location $rootDir

if (-not $Tag) {
    $Tag = (& node -p "require('./package.json').version").Trim()
    if (-not $Tag) {
        throw "Unable to resolve package version from package.json."
    }
}

$vcsRef = "unknown"
try {
    $vcsRef = (& git rev-parse --short HEAD).Trim()
} catch {
    $vcsRef = "unknown"
}

$buildDate = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$image = $ImageRepository + ":" + $Tag

Write-Host "Building production image: $image" -ForegroundColor Cyan

& docker build `
    --file "apps/control-api/Dockerfile.production" `
    --tag $image `
    --build-arg "VERSION=$Tag" `
    --build-arg "VCS_REF=$vcsRef" `
    --build-arg "BUILD_DATE=$buildDate" `
    .

if ($LASTEXITCODE -ne 0) {
    throw "Production image build failed."
}

if ($TagLatest) {
    & docker tag $image ($ImageRepository + ":latest")
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create latest tag."
    }
}

$inspect = & docker image inspect $image --format "{{.Id}}|{{.Size}}"
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect built image."
}

$parts = $inspect.Trim().Split("|")
$sizeMb = [Math]::Round(([double]$parts[1] / 1MB), 2)

Write-Host "Production image built successfully." -ForegroundColor Green
Write-Host "Image: $image" -ForegroundColor Green
Write-Host "Image ID: $($parts[0])" -ForegroundColor DarkGray
Write-Host "Size: $sizeMb MB" -ForegroundColor DarkGray
Write-Host "Revision: $vcsRef" -ForegroundColor DarkGray

if (-not $SkipBrowserBundle) {
    Write-Host "Building bundled browser image..." -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "build-browser-bundle.ps1") -ImageRepository $BrowserBundleRepository -Tag $Tag
    if ($LASTEXITCODE -ne 0) {
        throw "Browser bundle image build failed."
    }

    if ($TagLatest) {
        & docker tag ($BrowserBundleRepository + ":" + $Tag) ($BrowserBundleRepository + ":latest")
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to create browser bundle latest tag."
        }
    }
}