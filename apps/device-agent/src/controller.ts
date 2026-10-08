import type { AndroidProvider, DeviceInventory } from './provider/android.js';
import type { NodeHeartbeat } from '@jingcang/device-contracts';

/**
 * 节点 ↔ 控制面 传输抽象（便于单测注入假实现）。
 */
export interface ControlApiTransport {
  enroll(nodeId: string): Promise<{ credential: string }>;
  heartbeat(nodeId: string, token: string, payload: NodeHeartbeat): Promise<{ status: number }>;
}

/**
 * AgentController（AND-008）：节点注册、认证、心跳、设备发现、重连。
 *
 * - 启动时若无凭据则向控制面 enroll 换取一次性 credential（明文仅此一次）。
 * - 周期心跳上报设备清单；收到 401 即视为凭据失效，清空并下一轮重新 enroll。
 * - 网络异常采用指数退避重连，不中断进程。
 */
export class AgentController {
  private token?: string;
  private backoffMs: number;
  private consecutiveFailures = 0;

  constructor(
    private deps: {
      nodeId: string;
      transport: ControlApiTransport;
      provider: AndroidProvider;
      intervalMs?: number;
      baseBackoffMs?: number;
      maxBackoffMs?: number;
      token?: string;
    }
  ) {
    this.token = deps.token; // 允许从外部注入（配置下发场景）
    this.backoffMs = deps.baseBackoffMs ?? 1000;
  }

  get nodeId(): string {
    return this.deps.nodeId;
  }

  private async buildHeartbeat(): Promise<NodeHeartbeat> {
    const [health, devices] = await Promise.all([this.deps.provider.health(), this.deps.provider.listDevices()]);
    return {
      platform: 'windows',
      uptimeSeconds: health.uptimeSeconds,
      managedEmulatorCount: health.managedEmulatorCount,
      startedAt: health.startedAt,
      devices: devices.map((d: DeviceInventory) => ({
        id: d.id,
        kind: d.kind,
        state: d.state,
        booted: d.booted
      }))
    };
  }

  /** 确保持有有效凭据（无则注册）。 */
  async ensureEnrolled(): Promise<void> {
    if (this.token) return;
    const { credential } = await this.deps.transport.enroll(this.deps.nodeId);
    if (!/^[a-f0-9]{64}$/.test(credential)) throw new Error('注册返回的凭据格式非法');
    this.token = credential;
  }

  /** 单次心跳；异常会抛出，由调用方处理重连/退避。 */
  async heartbeatOnce(): Promise<number> {
    await this.ensureEnrolled();
    const payload = await this.buildHeartbeat();
    const res = await this.deps.transport.heartbeat(this.deps.nodeId, this.token!, payload);
    if (res.status === 401) {
      // 凭据失效 → 清空，下一轮重新注册
      this.token = undefined;
      throw Object.assign(new Error('凭据被拒绝'), { code: 'TOKEN_REJECTED' });
    }
    this.consecutiveFailures = 0;
    this.backoffMs = this.deps.baseBackoffMs ?? 1000;
    return res.status;
  }

  /** 含退避的单步调度，供 setInterval 或测试驱动。 */
  async tick(): Promise<'ok' | 'retrying'> {
    try {
      await this.heartbeatOnce();
      return 'ok';
    } catch (err: any) {
      this.consecutiveFailures++;
      if (err?.code === 'TOKEN_REJECTED') {
        // 下一轮将重新注册
        return 'retrying';
      }
      const cap = this.deps.maxBackoffMs ?? 30000;
      this.backoffMs = Math.min(cap, this.backoffMs * 2);
      return 'retrying';
    }
  }

  get currentBackoffMs(): number {
    return this.backoffMs;
  }

  get currentToken(): string | undefined {
    return this.token;
  }

  /** 启动周期心跳；返回停止函数。 */
  start(): () => void {
    const interval = this.deps.intervalMs ?? 30000;
    const timer = setInterval(() => {
      void this.tick();
    }, interval);
    return () => clearInterval(timer);
  }
}
