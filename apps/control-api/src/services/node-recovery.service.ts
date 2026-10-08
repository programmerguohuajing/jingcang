import { DatabaseSync } from 'node:sqlite';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { SessionCoreService } from './session-core.service.js';
import { NodeRouterService } from './node-router.service.js';

/**
 * Node Recovery（失联节点恢复确认与安全释放）
 *
 * 周期性执行：
 * 1. 依据心跳新鲜度/凭证撤销得到"候选失联节点"；
 * 2. 对每个候选节点做主动健康探测（GET /health）确认是否真实不可达，
 *    避免网络抖动或短暂超时误杀仍可用的节点与设备；
 * 3. 确认失联后，将节点标记 OFFLINE，并把该节点上所有活动会话
 *    （READY / BOOTING / ALLOCATING）置为 LOST 并释放设备租约，
 *    防止设备被"幽灵租约"永久占用而无法重新调度。
 *
 * 安全边界：
 * - 仅标记本地状态与释放本地租约，不对失联/不可信节点执行任何 Agent 操作；
 * - 凭证被撤销的节点视为失联，其设备不可被再次分配。
 */

export interface NodeRecoveryResult {
  candidates: string[];
  confirmedLost: string[];
  recoveredLeases: number;
  probes: Array<{ nodeId: string; reachable: boolean }>;
}

export class NodeRecoveryService {
  private timer: NodeJS.Timeout | null = null;
  /** 心跳失联判定阈值（与节点目录一致）。 */
  readonly staleAfterMs: number;

  constructor(
    private config: Config,
    private sessionCore: SessionCoreService,
    private router: NodeRouterService,
    private intervalMs = 20000,
    private db: DatabaseSync = getDb(config)
  ) {
    this.staleAfterMs = router.staleAfterMs;
  }

  public start(): void {
    if (this.timer) return;
    void this.sweep().catch((err) => console.error('[NodeRecovery] Initial sweep error:', err));
    this.timer = setInterval(() => {
      this.sweep().catch((err) => console.error('[NodeRecovery] Periodic sweep error:', err));
    }, this.intervalMs);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * 执行一轮失联确认与安全释放。
   * probes 由外部传入（便于测试注入探测结果）；不传则对候选节点逐个真实探测。
   */
  public async sweep(probes?: Map<string, boolean>): Promise<NodeRecoveryResult> {
    const db = this.db;
    const candidates = [...this.router.offlineNodeIds()].sort();
    const probeResults: Array<{ nodeId: string; reachable: boolean }> = [];
    const confirmed: string[] = [];
    for (const nodeId of candidates) {
      // 撤销/心跳超时仅证明"上报停止"，此处主动探测确认
      const reachable = probes ? (probes.get(nodeId) ?? false) : await this.router.probe(nodeId);
      probeResults.push({ nodeId, reachable });
      if (!reachable) confirmed.push(nodeId);
    }
    const recoveredLeases = confirmed.length
      ? this.sessionCore.recoverLostLeases(new Set(confirmed))
      : 0;
    if (confirmed.length) {
      // 不刷新 last_seen_at（保持失联判定），仅在 DeviceRegistry 侧标记 OFFLINE。
      // 节点心跳恢复后 upsertNode 会重新置为 ONLINE。
      for (const nodeId of confirmed) {
        db.prepare("UPDATE device_nodes SET status = 'OFFLINE' WHERE node_id = ?").run(nodeId);
      }
    }
    return {
      candidates,
      confirmedLost: confirmed,
      recoveredLeases,
      probes: probeResults
    };
  }
}