import { createAgentServer } from './server.js';
import { AgentController, type ControlApiTransport } from './controller.js';
import { EmulatorProvider } from './provider/android.js';

/**
 * Device Agent 入口（AND-008 / AND-009）
 *
 * 启动原生（Windows）Android 设备 Agent：注册 → 心跳 → 设备发现 → 暴露操作端点。
 * 配置：
 *   JINGCANG_NODE_ID        节点 ID（必填）
 *   JINGCANG_CONTROL_API_URL 控制面地址（用于注册/心跳）
 *   JINGCANG_AGENT_TOKEN    可选：若已下发，则跳过 enroll 直接使用
 *   JINGCANG_AGENT_PORT     本机监听端口（默认 7580）
 *   JINGCANG_HEARTBEAT_MS    心跳间隔（默认 30000）
 *   ANDROID_HOME             Android SDK 路径（EmulatorProvider 使用）
 */
async function main() {
  const nodeId = process.env.JINGCANG_NODE_ID;
  if (!nodeId) {
    console.error('[device-agent] 必须设置 JINGCANG_NODE_ID');
    process.exit(1);
  }
  const controlApiUrl = process.env.JINGCANG_CONTROL_API_URL?.replace(/\/$/, '');
  const agentToken = process.env.JINGCANG_AGENT_TOKEN;
  const port = Number(process.env.JINGCANG_AGENT_PORT || 7580);
  const heartbeatMs = Number(process.env.JINGCANG_HEARTBEAT_MS || 30000);

  const provider = new EmulatorProvider(nodeId, { sdkRoot: process.env.ANDROID_HOME });

  // 控制面传输实现（真实 fetch）
  const transport: ControlApiTransport = {
    async enroll(nid) {
      if (!controlApiUrl) throw new Error('未配置 JINGCANG_CONTROL_API_URL');
      const res = await fetch(`${controlApiUrl}/api/v1/device-nodes/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.JINGCANG_ADMIN_TOKEN || ''}` },
        body: JSON.stringify({ nodeId: nid })
      });
      if (!res.ok) throw new Error(`注册失败 HTTP ${res.status}`);
      const data = (await res.json()) as { success: boolean; data?: { credential: string } };
      if (!data.success || !data.data?.credential) throw new Error('注册响应无效');
      return { credential: data.data.credential };
    },
    async heartbeat(nid, token, payload) {
      if (!controlApiUrl) return { status: 503 };
      const res = await fetch(`${controlApiUrl}/api/v1/device-nodes/${nid}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000)
      });
      return { status: res.status };
    }
  };

  const controller = new AgentController({
    nodeId,
    transport,
    provider,
    intervalMs: heartbeatMs,
    token: agentToken
  });

  const server = createAgentServer(provider, { token: agentToken });
  await server.listen({ port, host: '127.0.0.1' });
  console.log(`[device-agent] 已监听 http://127.0.0.1:${port}（节点 ${nodeId}）`);

  // 立即执行一次注册/心跳，再进入周期循环
  void controller.tick();
  controller.start();

  process.on('SIGINT', () => {
    console.log('[device-agent] 正在退出…');
    process.exit(0);
  });
  process.on('SIGTERM', () => process.exit(0));
}

main().catch((err) => {
  console.error('[device-agent] 启动失败:', err);
  process.exit(1);
});
