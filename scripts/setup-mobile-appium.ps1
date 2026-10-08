$ErrorActionPreference='Stop'
$toolRoot='D:\codex\jingcang-mobile-toolchain'
$appiumHome='D:\codex\jingcang-mobile-appium-home'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:APPIUM_HOME=$appiumHome
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
if(-not (Test-Path "$env:JAVA_HOME\bin\java.exe")){throw 'Android Studio JBR/JDK not found'}
if(-not (Test-Path "$env:ANDROID_HOME\platform-tools\adb.exe")){throw 'Android platform tools not found'}
npm install --prefix $toolRoot --no-audit --no-fund appium@3.8.0
if($LASTEXITCODE -ne 0){throw 'Appium installation failed'}
$appium=Join-Path $toolRoot 'node_modules\.bin\appium.cmd'
$installed=& $appium driver list --installed 2>&1 | Out-String
if($installed -notmatch 'uiautomator2'){ & $appium driver install --source npm appium-uiautomator2-driver@8.7.0; if($LASTEXITCODE -ne 0){throw 'UiAutomator2 install failed'} }
$driverFolder=Join-Path $toolRoot 'chromedriver-101'
$driver=Join-Path $driverFolder 'chromedriver.exe'
if(-not (Test-Path $driver)){
 New-Item -ItemType Directory -Force $driverFolder|Out-Null
 $zip=Join-Path $driverFolder 'chromedriver.zip'
 Invoke-WebRequest 'https://chromedriver.storage.googleapis.com/101.0.4951.41/chromedriver_win32.zip' -OutFile $zip -TimeoutSec 120
 Expand-Archive $zip -DestinationPath $driverFolder -Force
 Remove-Item $zip -Force
}
& $driver --version
& $appium driver doctor uiautomator2
if($LASTEXITCODE -ne 0){throw 'UiAutomator2 doctor failed'}
Write-Output 'APPIUM_TOOLCHAIN_READY=PASS'
