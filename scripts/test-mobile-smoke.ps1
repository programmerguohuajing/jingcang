$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envLine = Get-Content (Join-Path $root '.env') | Where-Object { $_ -match '^JINGCANG_ADMIN_INITIAL_PASSWORD=' } | Select-Object -First 1
if (-not $envLine) { throw 'Initial admin password not configured' }
$password = ($envLine -split '=',2)[1].Trim()
$base='http://127.0.0.1:28088'
$session=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login=Invoke-RestMethod -Uri ($base+'/api/v1/auth/login') -Method Post -WebSession $session -ContentType 'application/json' -Body (@{username='admin';password=$password}|ConvertTo-Json)
if (-not $login.success) { throw 'Login failed' }
$devices=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/devices') -WebSession $session
Write-Output ('AUTH=OK AGENT_STATUS='+$devices.data.status+' DEVICES='+@($devices.data.devices).Count)
$profiles=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/profiles') -WebSession $session
if(-not $profiles.success){throw 'AVD profile discovery failed'}
Write-Output ('AVD_PROFILES='+@($profiles.data.profiles).Count)
try {
  Invoke-RestMethod -Uri ($base+'/api/v1/mobile/profiles/does_not_exist/start') -Method Post -WebSession $session -ContentType 'application/json' -Body '{}' | Out-Null
  throw 'Missing AVD start unexpectedly succeeded'
} catch {
  if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404){Write-Output 'UNKNOWN_AVD_REJECTION=PASS'}else{throw}
}
try {
  Invoke-RestMethod -Uri ($base+'/api/v1/mobile/profiles/Android_7_0_API24/start') -Method Post -WebSession $session -ContentType 'application/json' -Body '{}' | Out-Null
  throw 'Existing AVD duplicate launch unexpectedly succeeded'
} catch {
  if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409){Write-Output 'DUPLICATE_AVD_REJECTION=PASS'}else{throw}
}
if ($env:JINGCANG_TEST_AVD_BOOT -eq '1') {
  $target=if($env:JINGCANG_TEST_AVD_TARGET){$env:JINGCANG_TEST_AVD_TARGET}else{'Android_5_0_API21'}
  Write-Output ('COLD_BOOT_REQUEST='+$target)
  $launch=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/profiles/'+$target+'/start') -Method Post -WebSession $session -ContentType 'application/json' -Body '{}'
  if (-not $launch.success) {throw 'Start failed'}
  $booted=$false
  try {
    for($i=0;$i -lt 24;$i++) {
      Start-Sleep -Seconds 5
      $state=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/profiles') -WebSession $session
      $managed=$state.data.profiles | Where-Object {$_.id -eq $target}
      if($managed.lifecycle.status -eq 'ready') {$booted=$true;break}
      if($managed.lifecycle.status -eq 'timeout') {break}
    }
    Write-Output ('AVD_COLD_BOOT_READY='+$booted)
  }finally{
    $stopped=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/profiles/'+$target+'/stop') -Method Post -WebSession $session -ContentType 'application/json' -Body '{}'
    Write-Output ('MANAGED_AVD_STOP='+$stopped.success)
  }
  if (-not $booted) {throw 'Android AVD boot did not reach ready'}
  exit 0
}
$available=@($devices.data.devices | Where-Object {$_.state -eq 'device' -and $_.booted})
if ($available.Count -lt 1) { throw 'No booted Android devices' }
$device=$available[0]
$existing=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions') -WebSession $session
if (@($existing.data | Where-Object {$_.device_id -eq $device.id -and $_.status -eq 'READY'}).Count -gt 0){
  Write-Output ('DEVICE_IN_USE_SKIP_SESSION_SMOKE='+$device.id)
  exit 0
}
$created=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions') -Method Post -WebSession $session -ContentType 'application/json' -Body (@{deviceId=$device.id;mode='phone'}|ConvertTo-Json)
if (-not $created.success) {throw 'Create failed'}
$id=$created.data.id
Write-Output ('SESSION_CREATED='+$id)
try {
  $list=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions') -WebSession $session
  if (-not @($list.data | Where-Object {$_.id -eq $id}).Count) {throw 'Session not listed'}
  try {
    Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions') -Method Post -WebSession $session -ContentType 'application/json' -Body (@{deviceId=$device.id;mode='phone'}|ConvertTo-Json) | Out-Null
    throw 'Duplicate device lease was accepted'
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 409) { Write-Output 'EXCLUSIVE_DEVICE_LEASE=PASS' }
    else { throw }
  }
  try {
    Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions/'+$id+'/install') -Method Post -WebSession $session -ContentType 'application/json' -Body '{"base64":"invalid"}' | Out-Null
    throw 'Invalid APK was accepted'
  } catch {
    if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 400) {Write-Output 'INVALID_APK_REJECTION=PASS'}
    else {throw}
  }
  $appList=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions/'+$id+'/apps') -WebSession $session
  if (-not $appList.success -or $null -eq $appList.data.packages) {throw 'App listing failed'}
  Write-Output ('INSTALLED_THIRD_PARTY_APPS='+@($appList.data.packages).Count)
  $shot=Invoke-WebRequest -Uri ($base+'/api/v1/mobile/sessions/'+$id+'/screenshot') -WebSession $session -UseBasicParsing
  $bytes=$shot.Content
  if ($bytes -isnot [byte[]]) {$bytes=[System.Text.Encoding]::Default.GetBytes([string]$shot.Content)}
  if ($shot.Headers['Content-Type'] -notmatch 'image/png') { throw 'Screenshot content type invalid' }
  Write-Output ('SCREENSHOT_CONTENT_TYPE='+$shot.Headers['Content-Type'])
} finally {
  $deleted=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions/'+$id) -Method Delete -WebSession $session
  Write-Output ('SESSION_RELEASE='+$deleted.success)
}
$browser=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions') -Method Post -WebSession $session -ContentType 'application/json' -Body (@{deviceId=$device.id;mode='browser';startUrl='https://example.com'}|ConvertTo-Json)
if (-not $browser.success) { throw 'Browser mode failed' }
Write-Output 'MOBILE_CHROME_LAUNCH=OK'
$released=Invoke-RestMethod -Uri ($base+'/api/v1/mobile/sessions/'+$browser.data.id) -Method Delete -WebSession $session
Write-Output ('BROWSER_SESSION_RELEASE='+$released.success)
