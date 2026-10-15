#!/usr/bin/env bash
# 在 macOS 节点上启动 iOS Simulator Device Agent（JingCang 设备云）。
#
# 前置（Mac 上执行一次）：
#   1. 安装 Xcode Command Line Tools：xcode-select --install
#   2. 确保有可用的 iOS Runtime：xcrun simctl list runtimes
#      没有时去 Xcode → Settings → Platforms 下载，或 xcrun simctl runtime add <dmg>
#   3. 创建模拟器（名字以 JingCang- 开头才会被 Agent 管理启停）：
#        xcrun simctl create "JingCang-iPhone-15" \
#          com.apple.CoreSimulator.SimDeviceType.iPhone-15 \
#          com.apple.CoreSimulator.SimRuntime.iOS-17-5
#      （deviceType/runtime identifier 用 xcrun simctl list devicetypes/runtimes --json 查询）
#   4. 触控需要 idb（可选，不装则只能看画面/截图/Safari 导航）：
#        brew install idb-companion && pip3 install fb-idb
#   5. 管理员在控制面登记节点（示例，需 admin 登录 Cookie）：
#        AGENT_TOKEN=$(openssl rand -hex 32)   # 控制面调用本 Agent 的令牌，记下来
#        curl -b cookies.txt -X POST http://127.0.0.1:28088/api/v1/mobile/nodes/enroll \
#          -H 'Content-Type: application/json' \
#          -d "{\"nodeId\":\"mac-ios-1\",\"agentUrl\":\"http://host.docker.internal:7580\",\"agentToken\":\"$AGENT_TOKEN\"}"
#      返回的 credential 记为 NODE_CREDENTIAL。agentUrl 是控制面视角下本机的可达地址：
#      控制面与 Agent 同一台 Mac 用 http://127.0.0.1:7580；控制面在 Docker 里用
#      http://host.docker.internal:7580（此时本脚本默认监听 0.0.0.0）；跨主机用 HTTPS 地址。
#
# 公网访问（Mac 在内网、控制面在云上时）：
#   控制面只接受 https 的公网 agentUrl（http 仅限回环，见 validAgentUrl），推荐 Cloudflare Tunnel，
#   免费且自带 TLS，无需公网 IP 和端口转发：
#     brew install cloudflared
#     cloudflared tunnel --url http://127.0.0.1:7580
#   把输出的 https://xxx.trycloudflare.com 记下来（生产建议换成自己的域名做固定隧道），
#   enroll 时 agentUrl 就填它。此时 Agent 监听保持 127.0.0.1 即可（JINGCANG_AGENT_HOST 不用改），
#   公网只暴露 cloudflared 的出站隧道，没有入站端口。
#   注意：最终用户走的始终是控制面的会话接口（截图/操作由控制面代理），公网暴露面
#   只有 Agent 这一个端口，且受 64 位 Bearer 令牌保护；令牌泄露时管理员可调
#   POST /api/v1/mobile/nodes/:id/revoke 立即吊销。
#
# 启动（Mac 上）：
#   JINGCANG_NODE_ID=mac-ios-1 \
#   JINGCANG_CONTROL_API_URL=http://127.0.0.1:28088 \
#   JINGCANG_NODE_CREDENTIAL=<enroll 返回的 credential> \
#   JINGCANG_AGENT_TOKEN=<第 5 步的 AGENT_TOKEN> \
#   bash scripts/run-ios-agent.sh
#
# 启动后：xcrun simctl boot <udid> 开机，然后在控制台「移动设备池 → 节点 → iOS 模拟器」
# 建完整云手机/浏览器会话即可远程查看与操作。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

if [[ "$(uname)" != "Darwin" ]]; then
  echo "[run-ios-agent] 仅支持 macOS（iOS Simulator 只能运行在 Mac 上）" >&2
  exit 1
fi
if ! command -v xcrun >/dev/null 2>&1; then
  echo "[run-ios-agent] 未找到 xcrun，请先安装 Xcode Command Line Tools：xcode-select --install" >&2
  exit 1
fi
if ! command -v idb >/dev/null 2>&1; then
  echo "[run-ios-agent] 未检测到 idb：触控（点击/滑动）不可用，仅支持画面查看、截图与 Safari 导航。"
  echo "[run-ios-agent] 需要触控请执行：brew install idb-companion && pip3 install fb-idb"
fi

for v in JINGCANG_NODE_ID JINGCANG_CONTROL_API_URL JINGCANG_NODE_CREDENTIAL JINGCANG_AGENT_TOKEN; do
  if [[ -z "${!v:-}" ]]; then
    echo "[run-ios-agent] 缺少环境变量 $v（见本脚本头部注释）" >&2
    exit 1
  fi
done

export JINGCANG_DEVICE_PLATFORM=ios
export JINGCANG_AGENT_HOST="${JINGCANG_AGENT_HOST:-0.0.0.0}"
export JINGCANG_AGENT_PORT="${JINGCANG_AGENT_PORT:-7580}"

if [[ ! -f "apps/device-agent/dist/index.js" ]]; then
  echo "[run-ios-agent] 首次运行，安装依赖并构建 device-agent…"
  pnpm install
  pnpm --filter @jingcang/device-agent build
fi

echo "[run-ios-agent] 启动 iOS Agent：节点 ${JINGCANG_NODE_ID}，监听 ${JINGCANG_AGENT_HOST}:${JINGCANG_AGENT_PORT}"
exec node apps/device-agent/dist/index.js
