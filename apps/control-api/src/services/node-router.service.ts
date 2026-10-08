import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';

/**
 * Node Router（跨节点真实设备控制与调度）
 *
 * 将"设备会话归属的 node_id"解析为"控制面可达的 Agent 端点 + 调用凭证"，
 * 使截图 / 控制 / 视频 / App / 自动化等设备操作不再固定转发到本机
 * windows-local-dev，而是按会话归属节点动态路由。
 *
 * 端点存储：
 * - windows-local-dev（本机/开发节点）：沿用环境变量
 *   JINGCANG_MOBILE_AGENT_URL + JINGCANG_MOBILE_AGENT_TOKEN，不依赖数据库。
 * - 远程节点：管理员登记（enroll）或 Agent 心跳上报 agentUrl；
 *   控制面→Agent 的调用凭证以 AES-256-GCM 加密后落库，密钥派生自
 *   服务端 viewerSecret，不落明文、不出现在任何列表/审计响应中。
 */

export interface RoutedNode {
  nodeId: string;
  agentUrl: string;
  /** 控制面调用该节点 Agent 的 Bearer 凭证（仅在服务端内存使用，不对外返回）。 */
  agentToken: string;
  online: boolean;
  revoked: boolean;
  platform: string;
  lastSeenAt: string;
  startedAt: string;
}

export interface RoutableNodeSummary {
  nodeId: string;
  platform: string;
  online: boolean;
  revoked: boolean;
  routable: boolean;
  agentUrl: string | null;
  lastSeenAt: string;
}

const LOCAL_NODE = 'windows-local-dev';
const HTTP_URL_RE = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export class NodeRouterService {
  static readonly LOCAL_NODE = LOCAL_NODE;
  /** 心跳失联判定阈值（与既有节点目录一致）。 */
  readonly staleAfterMs: number;

  constructor(
    private config: Config,
    private db: DatabaseSync = getDb(config),
    staleAfterMs = 45000
  ) {
    this.staleAfterMs = staleAfterMs;
  }

  // -------------------------------------------------------------------------
  // 凭证加解密（AES-256-GCM，密钥派生自 viewerSecret）
  // -------------------------------------------------------------------------

  private key(): Buffer {
    return crypto.createHash('sha256').update(this.config.viewerSecret).digest();
  }

  /** 加密控制面→Agent 凭证，格式 v1:<iv>:<tag>:<cipher>。 */
  encryptSecret(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  /** 解密 encryptSecret 生成的密文；格式非法或解密失败返回 null。 */
  decryptSecret(stored: string): string | null {
    try {
      const parts = stored.split(':');
      if (parts.length !== 4 || parts[0] !== 'v1') return null;
      const [, ivHex, tagHex, cipherHex] = parts;
      if (!/^[a-f0-9]{24}$/.test(ivHex) || !/^[a-f0-9]{32}$/.test(tagHex) || !/^[a-f0-9]+$/.test(cipherHex)) return null;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      const plain = Buffer.concat([decipher.update(Buffer.from(cipherHex, 'hex')), decipher.final()]);
      return plain.toString('utf8');
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // 节点端点解析
  // -------------------------------------------------------------------------

  /**
   * 解析节点控制面端点。返回 null 表示该节点不可路由
   * （未登记端点 / 未配置环境变量 / 表记录缺失）。
   */
  resolve(nodeId: string): { agentUrl: string; agentToken: string } | null {
    if (!nodeId || !/^[A-Za-z0-9._-]{1,80}$/.test(nodeId)) return null;
    if (nodeId === LOCAL_NODE) {
      const url = process.env.JINGCANG_MOBILE_AGENT_URL?.trim();
      const token = process.env.JINGCANG_MOBILE_AGENT_TOKEN?.trim();
      if (!url || !token) return null;
      return { agentUrl: url.replace(/\/$/, ''), agentToken: token };
    }
    const row = this.db
      .prepare('SELECT agent_url, agent_token_enc FROM mobile_agent_nodes WHERE node_id = ?')
      .get(nodeId) as { agent_url: string | null; agent_token_enc: string | null } | undefined;
    if (!row?.agent_url) return null;
    const token = row.agent_token_enc ? this.decryptSecret(row.agent_token_enc) : null;
    if (!token) return null;
    return { agentUrl: row.agent_url.replace(/\/$/, ''), agentToken: token };
  }

  /** 节点是否已被登记端点（可用于会话调度）。 */
  hasNode(nodeId: string): boolean {
    return this.resolve(nodeId) !== null;
  }

  /** 登记/更新节点端点（enroll、heartbeat 共用）。encToken 为空时不覆盖已有密文。 */
  upsertEndpoint(nodeId: string, agentUrl: string, encToken?: string): void {
    this.db
      .prepare(`INSERT INTO mobile_agent_nodes
        (node_id, platform, started_at, last_seen_at, uptime_seconds, managed_count, agent_url, agent_token_enc)
        VALUES (?, 'windows', ?, ?, 0, 0, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET agent_url = excluded.agent_url,
          agent_token_enc = COALESCE(excluded.agent_token_enc, mobile_agent_nodes.agent_token_enc)`)
      .run(
        nodeId,
        new Date().toISOString(),
        new Date().toISOString(),
        agentUrl,
        encToken ?? null
      );
    // 同步桥接 device_nodes（DeviceRegistry 侧只读目录）
    this.db
      .prepare(`INSERT INTO device_nodes
        (node_id, platform, started_at, last_seen_at, uptime_seconds, managed_count, status, agent_url, agent_token_enc, enrolled_at)
        VALUES (?, 'windows', ?, ?, 0, 0, 'ONLINE', ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET agent_url = excluded.agent_url,
          agent_token_enc = COALESCE(excluded.agent_token_enc, device_nodes.agent_token_enc)`)
      .run(nodeId, new Date().toISOString(), new Date().toISOString(), agentUrl, encToken ?? null, new Date().toISOString());
  }

  // -------------------------------------------------------------------------
  // 存活判定（失联节点恢复确认的数据源）
  // -------------------------------------------------------------------------

  /** 心跳是否新鲜（非撤销且 last_seen_at 在阈值内）。 */
  isOnline(nodeId: string): boolean {
    const row = this.db
      .prepare(`SELECT n.last_seen_at, c.revoked_at FROM mobile_agent_nodes n
        LEFT JOIN mobile_node_credentials c ON c.node_id = n.node_id
        WHERE n.node_id = ?`)
      .get(nodeId) as { last_seen_at: string; revoked_at: string | null } | undefined;
    if (!row || row.revoked_at) return false;
    return Date.now() - Date.parse(row.last_seen_at) < this.staleAfterMs;
  }

  /**
   * 判定为失联的节点集合：心跳超时或凭证已被撤销。
   * 注意：这只是候选集合，真正"确认"失联需对端点做健康探测（见 probe）。
   */
  offlineNodeIds(): Set<string> {
    const now = Date.now();
    const rows = this.db
      .prepare(`SELECT n.node_id, n.last_seen_at, c.revoked_at FROM mobile_agent_nodes n
        LEFT JOIN mobile_node_credentials c ON c.node_id = n.node_id`)
      .all() as Array<{ node_id: string; last_seen_at: string; revoked_at: string | null }>;
    const offline = new Set<string>();
    for (const r of rows) {
      if (r.revoked_at || now - Date.parse(r.last_seen_at) >= this.staleAfterMs) {
        offline.add(r.node_id);
      }
    }
    return offline;
  }

  /**
   * 在线且已登记端点的节点清单（用于跨节点设备聚合与调度）。
   */
  routableNodeIds(): string[] {
    const rows = this.db
      .prepare(`SELECT n.node_id FROM mobile_agent_nodes n
        LEFT JOIN mobile_node_credentials c ON c.node_id = n.node_id
        WHERE n.agent_url IS NOT NULL AND n.agent_url != '' AND c.revoked_at IS NULL`)
      .all() as Array<{ node_id: string }>;
    return rows
      .filter((r) => this.isOnline(r.node_id))
      .map((r) => r.node_id);
  }

  /** 节点摘要（供 /api/v1/mobile/nodes 展示路由能力，不泄露凭证）。 */
  listRoutableSummaries(): RoutableNodeSummary[] {
    const now = Date.now();
    const rows = this.db
      .prepare(`SELECT n.node_id, n.platform, n.last_seen_at, n.agent_url, c.revoked_at FROM mobile_agent_nodes n
        LEFT JOIN mobile_node_credentials c ON c.node_id = n.node_id
        ORDER BY n.last_seen_at DESC`)
      .all() as Array<{
      node_id: string;
      platform: string;
      last_seen_at: string;
      agent_url: string | null;
      revoked_at: string | null;
    }>;
    return rows.map((r) => {
      const online = !r.revoked_at && now - Date.parse(r.last_seen_at) < this.staleAfterMs;
      return {
        nodeId: r.node_id,
        platform: r.platform,
        online,
        revoked: !!r.revoked_at,
        routable: online && !!r.agent_url,
        agentUrl: r.agent_url,
        lastSeenAt: r.last_seen_at
      };
    });
  }

  /**
   * 对候选失联节点做一次真实健康探测（GET /health，Bearer 鉴权）。
   * 探测成功说明节点实际可达，不应判定为失联；只有探测失败才确认失联。
   */
  async probe(nodeId: string, timeoutMs = 3000): Promise<boolean> {
    const endpoint = this.resolve(nodeId);
    if (!endpoint) return false;
    try {
      const response = await fetch(new URL('/health', endpoint.agentUrl + '/'), {
        headers: { Authorization: 'Bearer ' + endpoint.agentToken },
        signal: AbortSignal.timeout(timeoutMs)
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}