$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$line=Get-Content (Join-Path $root '.env') | Where-Object {$_ -match '^JINGCANG_ADMIN_INITIAL_PASSWORD='} | Select-Object -First 1
if(-not $line){throw 'Dev login password not configured'}
$password=($line -split '=',2)[1].Trim()
$base='http://127.0.0.1:28088'
$web=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login=Invoke-RestMethod ($base+'/api/v1/auth/login') -Method Post -WebSession $web -ContentType 'application/json' -Body (@{username='admin';password=$password}|ConvertTo-Json)
if(-not $login.success){throw 'Login failed'}
$apiLevel=if($env:JINGCANG_TEST_API_LEVEL){[int]$env:JINGCANG_TEST_API_LEVEL}else{27}
if($apiLevel -notin @(24,27)){throw 'Unsupported test API level'}
$profileName='JingCang_Test_API'+$apiLevel+'_x86'
if($env:JINGCANG_TEST_COLD_BOOT -eq '1'){
 $leases=Invoke-RestMethod ($base+'/api/v1/mobile/sessions') -WebSession $web
 if(@($leases.data | Where-Object {$_.device_id -eq 'emulator-5580' -and $_.status -eq 'READY'}).Count -gt 0){
  Write-Output 'AVD_COLD_BOOT_SKIPPED_DEVICE_BUSY=PASS'
  $env:JINGCANG_TEST_COLD_BOOT='0'
 }
}
try{
 Invoke-RestMethod ($base+'/api/v1/mobile/profiles/create') -WebSession $web -Method Post -ContentType 'application/json' -Body '{"apiLevel":34}' | Out-Null
 throw 'Unsupported Android 14 create accepted'
}catch{
 if($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 400){Write-Output 'UNSUPPORTED_API_REJECTION=PASS'}else{throw}
}
try{
 Invoke-RestMethod ($base+'/api/v1/mobile/profiles/Pixel_2/delete') -WebSession $web -Method Post -ContentType 'application/json' -Body '{}' | Out-Null
 throw 'Unexpected nonmanaged AVD delete success'
}catch{
 if($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 400){Write-Output 'ORIGINAL_AVD_DELETE_REJECTION=PASS'}else{throw}
}
$before=Invoke-RestMethod ($base+'/api/v1/mobile/profiles') -WebSession $web
if(@($before.data.profiles|Where-Object {$_.id -eq $profileName}).Count){
 if($env:JINGCANG_RECOVER_AVD_TEST -eq '1') {
  $recovered=Invoke-RestMethod ($base+'/api/v1/mobile/profiles/'+$profileName+'/delete') -Method Post -WebSession $web -ContentType 'application/json' -Body '{}'
  if(-not $recovered.success){throw 'Failed to recover previous test AVD'}
  Write-Output 'RECOVER_PREVIOUS_TEST_AVD=PASS'
 }else{throw 'Refusing to overwrite preexisting test AVD'}
}
$created=$false
try{
 $response=Invoke-RestMethod ($base+'/api/v1/mobile/profiles/create') -WebSession $web -Method Post -ContentType 'application/json' -Body (@{apiLevel=$apiLevel}|ConvertTo-Json)
 if(-not $response.success -or $response.data.id -ne $profileName){throw 'Create returned unexpected result'}
 $created=$true
 Write-Output 'MANAGED_AVD_CREATE=PASS'
 $profile=Invoke-RestMethod ($base+'/api/v1/mobile/profiles') -WebSession $web
 if(@($profile.data.profiles|Where-Object {$_.id -eq $profileName}).Count -ne 1){throw 'Created AVD not discovered'}
 Write-Output 'MANAGED_AVD_DISCOVERY=PASS'
 if($env:JINGCANG_TEST_COLD_BOOT -eq '1'){
  $start=Invoke-RestMethod ($base+'/api/v1/mobile/profiles/'+$profileName+'/start') -WebSession $web -Method Post -ContentType 'application/json' -Body '{}'
  Write-Output ('COLD_BOOT_REQUEST_STATUS='+$start.data.status)
  $ready=$false
  try{
   for($iteration=0;$iteration -lt 24;$iteration++){
    Start-Sleep -Seconds 5
    $state=Invoke-RestMethod ($base+'/api/v1/mobile/profiles') -WebSession $web
    $entry=$state.data.profiles|Where-Object {$_.id -eq $profileName}
    $status=$entry.lifecycle.status
    if($status -eq 'ready'){$ready=$true;break}
    if($status -eq 'failed' -or $status -eq 'timeout'){break}
   }
   Write-Output ('MANAGED_AVD_BOOT_READY='+$ready)
  }finally{
   try{$stop=Invoke-RestMethod ($base+'/api/v1/mobile/profiles/'+$profileName+'/stop') -WebSession $web -Method Post -ContentType 'application/json' -Body '{}';Write-Output ('MANAGED_AVD_STOP='+$stop.success)}catch{Write-Output ('MANAGED_AVD_STOP_ERROR='+$_.Exception.Message)}
   Start-Sleep -Seconds 8
  }
  if(-not $ready){throw 'Created AVD failed real boot verification'}
 }
}finally{
 if($created){
  $deleted=Invoke-RestMethod ($base+'/api/v1/mobile/profiles/'+$profileName+'/delete') -Method Post -WebSession $web -ContentType 'application/json' -Body '{}'
  if(-not $deleted.success){throw 'Failed to clean up test AVD'}
  Write-Output 'MANAGED_AVD_DELETE=PASS'
 }
}
