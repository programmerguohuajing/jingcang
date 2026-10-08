$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$line=Get-Content (Join-Path $root '.env') | Where-Object {$_ -match '^JINGCANG_ADMIN_INITIAL_PASSWORD='} | Select-Object -First 1
if(-not $line){throw 'Development administrator password not configured'}
$password=($line -split '=',2)[1].Trim()
$base='http://127.0.0.1:28088'
$web=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login=Invoke-RestMethod ($base+'/api/v1/auth/login') -WebSession $web -Method Post -ContentType 'application/json' -Body (@{username='admin';password=$password}|ConvertTo-Json)
if(-not $login.success){throw 'Test environment login failed'}
$serial=if($env:JINGCANG_TEST_SERIAL){$env:JINGCANG_TEST_SERIAL}else{'emulator-5580'}
$found=Invoke-RestMethod ($base+'/api/v1/mobile/devices') -WebSession $web
if(-not @($found.data.devices | Where-Object {$_.id -eq $serial -and $_.booted}).Count){throw 'Dedicated emulator is not ready'}
$leases=Invoke-RestMethod ($base+'/api/v1/mobile/sessions') -WebSession $web
$active=@($leases.data | Where-Object {$_.device_id -eq $serial -and $_.status -eq 'READY'})
if($active.Count -gt 0){Write-Output ('EXISTING_ACTIVE_LEASES='+$active.Count);$active | Select-Object id,device_id,status,created_at | Format-Table;exit 2}
$created=Invoke-RestMethod ($base+'/api/v1/mobile/sessions') -WebSession $web -Method Post -ContentType 'application/json' -Body (@{deviceId=$serial;mode='browser';startUrl='https://example.com'}|ConvertTo-Json)
$id=$created.data.id
if(-not $id){throw 'No device lease allocated'}
Write-Output ('MOBILE_WEB_SESSION='+$id)
try{
 $result=Invoke-RestMethod ($base+'/api/v1/mobile/sessions/'+$id+'/automation') -WebSession $web -Method Post -ContentType 'application/json' -Body '{}'
 if(-not $result.success -or $result.data.title -notmatch 'Example'){throw 'WebDriver automation did not confirm expected page title'}
 Write-Output ('MOBILE_AUTOMATION=PASS TITLE='+$result.data.title)
}finally{
 $release=Invoke-RestMethod ($base+'/api/v1/mobile/sessions/'+$id) -WebSession $web -Method Delete
 Write-Output ('MOBILE_SESSION_RELEASE='+$release.success)
}
