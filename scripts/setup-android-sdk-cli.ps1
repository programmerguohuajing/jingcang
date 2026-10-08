$ErrorActionPreference='Stop'
$sdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$package='commandlinetools-win-15859902_latest.zip'
$sha256='90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
$toolRoot='D:\codex\jingcang-mobile-toolchain'
$archive=Join-Path $toolRoot $package
$manager=Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if(Test-Path $manager){Write-Output 'ANDROID_SDK_CLI=ALREADY_INSTALLED';exit 0}
New-Item -ItemType Directory -Force $toolRoot | Out-Null
if(-not (Test-Path $archive)){
 $url='https://dl.google.com/android/repository/'+$package
 & curl.exe --fail --location --retry 3 --connect-timeout 20 --output $archive $url
 if($LASTEXITCODE -ne 0){throw 'Official command-line tools download failed'}
}
$digest=(Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if($digest -ne $sha256){throw 'SDK tools checksum mismatch: refusing to install'}
$stage=Join-Path $toolRoot 'cmdline-tools-stage'
Expand-Archive $archive -DestinationPath $stage -Force
$destination=Join-Path $sdk 'cmdline-tools\latest'
New-Item -ItemType Directory -Force $destination | Out-Null
Copy-Item (Join-Path $stage 'cmdline-tools\*') $destination -Recurse -Force
if(-not (Test-Path $manager)){throw 'SDK Manager executable missing after extraction'}
Write-Output 'ANDROID_SDK_CLI=INSTALLED'
