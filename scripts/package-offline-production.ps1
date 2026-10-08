param(
 [string]$OutputDirectory = 'dist/jingcang-offline',
 [string]$EnvironmentFile = 'deploy/.env.production.example',
 [switch]$IncludeBrowserArchives
)
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$envFile=(Resolve-Path $EnvironmentFile).Path
$target=Join-Path $root $OutputDirectory
if(Test-Path $target){throw "Output already exists: $target (delete or choose a new destination explicitly)"}
New-Item -ItemType Directory -Path $target -Force | Out-Null
try {
 foreach($sub in @('nginx','selenium','browser-images','images')){New-Item -ItemType Directory -Path (Join-Path $target $sub) -Force | Out-Null}
 Copy-Item 'deploy/compose.production.yaml' (Join-Path $target 'compose.production.yaml')
 Copy-Item 'deploy/nginx/nginx.conf' (Join-Path $target 'nginx/nginx.conf')
 Copy-Item 'deploy/selenium/docker.production.toml' (Join-Path $target 'selenium/docker.production.toml')
 Copy-Item 'deploy/selenium/browser-catalog.production.yaml' (Join-Path $target 'selenium/browser-catalog.production.yaml')
 Copy-Item 'deploy/.env.production.example' (Join-Path $target '.env.production.example')
 Copy-Item 'scripts/install-offline-production.ps1' (Join-Path $target 'install-offline-production.ps1')
 if($IncludeBrowserArchives){
  Get-ChildItem 'deploy/browser-images' -File -ErrorAction SilentlyContinue | Copy-Item -Destination (Join-Path $target 'browser-images')
 }
 $images=@(& docker compose --env-file $envFile -f deploy/compose.production.yaml config --images)
 if($LASTEXITCODE -ne 0 -or !$images){throw 'Cannot resolve production Compose images'}
 $images=@($images | Where-Object {$_} | Sort-Object -Unique)
 foreach($image in $images){
  & docker image inspect $image *> $null
  if($LASTEXITCODE -ne 0){throw "Required image not present locally: $image. Import/build it before packaging."}
 }
 $archive=Join-Path $target 'images/production-images.tar'
 & docker image save -o $archive @images
 if($LASTEXITCODE -ne 0){throw 'docker image save failed'}
 $platform=(& docker info --format '{{.OSType}}/{{.Architecture}}').Trim()
 if($LASTEXITCODE -ne 0){throw 'Cannot detect Docker image platform'}
 [IO.File]::WriteAllText((Join-Path $target 'PLATFORM.txt'),$platform+"`n",[Text.UTF8Encoding]::new($false))
 $files=Get-ChildItem $target -File -Recurse | Where-Object {$_.Name -ne 'SHA256SUMS.txt'}
 $entries=foreach($file in $files){
  $rel=$file.FullName.Substring($target.Length+1).Replace('\','/')
  $hash=(Get-FileHash -Algorithm SHA256 $file.FullName).Hash.ToLowerInvariant()
  "$hash  $rel"
 }
 [IO.File]::WriteAllLines((Join-Path $target 'SHA256SUMS.txt'),[string[]]@($entries | Sort-Object),[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllLines((Join-Path $target 'IMAGE_LIST.txt'),[string[]]$images,[Text.UTF8Encoding]::new($false))
 # IMAGE_LIST is generated after manifest, so explicitly append its checksum.
 $manifest=Join-Path $target 'SHA256SUMS.txt'
 $hash=(Get-FileHash -Algorithm SHA256 (Join-Path $target 'IMAGE_LIST.txt')).Hash.ToLowerInvariant()
 Add-Content -Path $manifest -Value "$hash  IMAGE_LIST.txt"
 Write-Output "OFFLINE_BUNDLE_CREATED=$target"
 Write-Output "IMAGE_COUNT=$($images.Count)"
} catch {
 Write-Error $_
 throw
}
