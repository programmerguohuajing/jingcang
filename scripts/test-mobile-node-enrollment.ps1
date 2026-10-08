$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$entry=Get-Content (Join-Path $root '.env') | Where-Object {$_ -match '^JINGCANG_ADMIN_INITIAL_PASSWORD='} | Select-Object -First 1
if(-not $entry){throw 'Missing isolated environment login credentials'}
$password=($entry -split '=',2)[1].Trim()
$base='http://127.0.0.1:28088'
$session=New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login=Invoke-RestMethod ($base+'/api/v1/auth/login') -Method Post -WebSession $session -ContentType 'application/json' -Body (@{username='admin';password=$password}|ConvertTo-Json)
if(-not $login.success){throw 'Admin login failed'}
$nodeId='test-node-'+[Guid]::NewGuid().ToString('N').Substring(0,12)
$provisioned=Invoke-RestMethod ($base+'/api/v1/mobile/nodes/enroll') -Method Post -WebSession $session -ContentType 'application/json' -Body (@{nodeId=$nodeId}|ConvertTo-Json)
if(-not $provisioned.success -or $provisioned.data.credential.Length -ne 64){throw 'Invalid node credential'}
$credential=$provisioned.data.credential
Write-Output 'NODE_CREDENTIAL_ENROLL=PASS'
$body=@{platform='windows';uptimeSeconds=15;managedEmulatorCount=0;startedAt=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json
try{
 $ok=Invoke-RestMethod ($base+'/api/v1/mobile/nodes/'+$nodeId+'/heartbeat') -Method Post -Headers @{Authorization='Bearer '+$credential} -ContentType 'application/json' -Body $body
 if(-not $ok.success){throw 'Node heartbeat was rejected'}
 Write-Output 'NODE_AUTHENTICATED_HEARTBEAT=PASS'
 $nodes=Invoke-RestMethod ($base+'/api/v1/mobile/nodes') -WebSession $session
 if(-not @($nodes.data.nodes | Where-Object {$_.node_id -eq $nodeId -and $_.online}).Count){throw 'Node was not listed as online'}
 Write-Output 'NODE_REGISTRY_OBSERVATION=PASS'
 try {
  Invoke-RestMethod ($base+'/api/v1/mobile/nodes/'+$nodeId+'/heartbeat') -Method Post -Headers @{Authorization='Bearer '+('0'*64)} -ContentType 'application/json' -Body $body | Out-Null
  throw 'Forged credential was accepted'
 }catch{
  if($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401){Write-Output 'INVALID_NODE_CREDENTIAL_REJECTED=PASS'}else{throw}
 }
}finally{
 $revoked=Invoke-RestMethod ($base+'/api/v1/mobile/nodes/'+$nodeId+'/revoke') -Method Post -WebSession $session -ContentType 'application/json' -Body '{}'
 if(-not $revoked.data.revoked){throw 'Node credential revocation failed'}
 Write-Output 'NODE_CREDENTIAL_REVOKED=PASS'
}
try {
 Invoke-RestMethod ($base+'/api/v1/mobile/nodes/'+$nodeId+'/heartbeat') -Method Post -Headers @{Authorization='Bearer '+$credential} -ContentType 'application/json' -Body $body | Out-Null
 throw 'Revoked credential was accepted'
}catch{
 if($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401){Write-Output 'REVOKED_NODE_CREDENTIAL_REJECTED=PASS'}else{throw}
}
