$ErrorActionPreference='Stop'
$base='http://127.0.0.1:28088'
$avd='JingCang_Test_API34_x86_64'
$serial='emulator-5584'
$sdk=Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$emulator=Join-Path $sdk 'emulator\emulator.exe'
$adb='D:\Program Files\platform-tools\adb.exe'
$line=Get-Content 'D:\codex\jingcang\.env' | Where-Object {$_ -match '^JINGCANG_ADMIN_INITIAL_PASSWORD='} | Select-Object -First 1
if(-not $line){throw 'Dev admin credentials missing'}
$password=($line -split '=',2)[1].Trim()
$web=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login=Invoke-RestMethod ($base+'/api/v1/auth/login') -Method Post -WebSession $web -ContentType 'application/json' -Body (@{username='admin';password=$password}|ConvertTo-Json)
if(-not $login.success){throw 'Dev login failed'}
$existing=Invoke-RestMethod ($base+'/api/v1/mobile/profiles') -WebSession $web
if(@($existing.data.profiles | Where-Object {$_.id -eq $avd}).Count){throw 'Protected: Android 14 test AVD already exists'}
if(@(& $adb devices | Select-String $serial).Count){throw 'Protected: test port already occupied'}
$created=$false
$process=$null
try{
 $create=Invoke-RestMethod ($base+'/api/v1/mobile/profiles/create') -Method Post -WebSession $web -ContentType 'application/json' -Body '{"apiLevel":34}'
 if(-not $create.success){throw 'AVD provisioning failed'}
 $created=$true
 Write-Output 'ANDROID14_CREATED=PASS'
 $config=Get-Content (Join-Path $env:USERPROFILE ('.android\avd\'+$avd+'.avd\config.ini'))
 if(-not ($config -contains 'abi.type=x86_64') -or -not ($config -contains 'hw.cpu.arch=x86_64')){throw 'Created AVD has wrong CPU architecture'}
 Write-Output 'ANDROID14_ARCH_CONFIG=PASS'
 $logDir='D:\codex\jingcang-mobile-toolchain'
 $process=Start-Process -FilePath $emulator -ArgumentList @('-avd',$avd,'-port','5584','-no-window','-no-audio','-no-snapshot-save','-gpu','swiftshader_indirect') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDir 'android14-boot.out.log') -RedirectStandardError (Join-Path $logDir 'android14-boot.err.log')
 Write-Output 'ANDROID14_COLD_BOOT_STARTED=YES'
 $ready=$false
 for($i=0;$i -lt 48;$i++){
   Start-Sleep -Seconds 5
   try{$output=(& $adb -s $serial shell getprop sys.boot_completed 2>$null | Out-String).Trim()}catch{$output=''}
   if($output -eq '1'){$ready=$true;break}
   if($i -ge 3){
    $active=Get-CimInstance Win32_Process | Where-Object {$_.Name -match '^emulator.exe$|^qemu-system' -and $_.CommandLine -match [regex]::Escape($avd)}
    if(-not $active -and $process.HasExited){throw 'Android 14 emulator process exited before boot'}
   }
 }
 Write-Output ('ANDROID14_BOOT_READY='+$ready)
 if(-not $ready){throw 'Android 14 did not complete boot'}
 $version=(& $adb -s $serial shell getprop ro.build.version.release | Out-String).Trim()
 $api=(& $adb -s $serial shell getprop ro.build.version.sdk | Out-String).Trim()
 Write-Output ('ANDROID14_OS_VERSION='+$version+' API='+$api)
 if($api -ne '34'){throw 'Unexpected system API'}
}finally{
 $running=@(& $adb devices | Select-String $serial)
 if($running.Count){& $adb -s $serial emu kill | Out-Null;Start-Sleep -Seconds 8}
 if($process -and -not $process.HasExited){try{Stop-Process -Id $process.Id -Force -ErrorAction Stop}catch{}}
 if($created){
  try{
   Start-Sleep -Seconds 5
   $done=Invoke-RestMethod ($base+'/api/v1/mobile/profiles/'+$avd+'/delete') -Method Post -WebSession $web -ContentType 'application/json' -Body '{}'
   Write-Output ('ANDROID14_CLEANUP='+$done.success)
  }catch{Write-Output ('ANDROID14_CLEANUP_PENDING='+$_.Exception.Message)}
 }
}
