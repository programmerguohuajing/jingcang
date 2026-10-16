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
# 模拟器 H.264 软编码降负载（默认 720x1280/2Mbps；真机不受影响）。按需取消注释覆盖：
# $env:JINGCANG_H264_SIZE = '720x1280'
# $env:JINGCANG_H264_BITRATE = '2000000'
node (Join-Path $PSScriptRoot 'android-poc-agent.mjs')
