$ErrorActionPreference = 'Stop'
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$manager = Join-Path $sdk 'cmdline-tools\latest\bin\sdkmanager.bat'
if (-not (Test-Path $manager)) { throw 'SDK command-line tools missing. Install official signed tools before continuing.' }
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = $sdk
$env:ANDROID_SDK_ROOT = $sdk
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$package='system-images;android-34;google_apis;x86_64'
$installed=Join-Path $sdk 'system-images\android-34\google_apis\x86_64\system.img'
if (Test-Path $installed) { Write-Output 'ANDROID_14_IMAGE_INSTALLED=ALREADY_PRESENT'; exit 0 }
Write-Output ('ANDROID_14_PACKAGE='+$package)
Write-Output 'ANDROID_14_DOWNLOAD_START=YES'
& $manager "--sdk_root=$sdk" '--install' $package
if($LASTEXITCODE -ne 0){throw ('SDK_INSTALL_FAILED='+$LASTEXITCODE)}
if(-not (Test-Path $installed)){throw 'SDK manager exited without Android 14 system.img'}
Write-Output 'ANDROID_14_IMAGE_INSTALLED=PASS'
