$ErrorActionPreference='Stop'
$env:APPIUM_HOME='D:\codex\jingcang-mobile-appium-home'
$env:ANDROID_HOME=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$env:JAVA_HOME='C:\Program Files\Android\Android Studio\jbr'
$env:PATH="$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
$appium='D:\codex\jingcang-mobile-toolchain\node_modules\.bin\appium.cmd'
if(-not (Test-Path $appium)){throw 'Run setup-mobile-appium.ps1 first'}
& $appium --address 127.0.0.1 --port 14723 --log-level info
