$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $project 'deploy\.env.mobile-agent'
$record = Get-Content -Raw $envPath
if ($record -notmatch '(?m)^JINGCANG_MOBILE_AGENT_TOKEN=([a-f0-9]{64})') { throw 'Missing valid agent token' }
$env:JINGCANG_MOBILE_AGENT_TOKEN = $Matches[1]
$env:JINGCANG_ANDROID_AGENT_HOST = '0.0.0.0'
$env:JINGCANG_ANDROID_AGENT_PORT = '19879'
# 控制面（Docker 容器）可达该 Agent 的地址；跨主机部署请改为节点的内网/公网 HTTPS 地址
if (-not $env:JINGCANG_ANDROID_AGENT_PUBLIC_URL) {
  $env:JINGCANG_ANDROID_AGENT_PUBLIC_URL = 'http://host.docker.internal:19879'
}
node (Join-Path $PSScriptRoot 'android-poc-agent.mjs')
