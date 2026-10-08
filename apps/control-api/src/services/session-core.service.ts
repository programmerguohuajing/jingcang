import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import type { DeviceSessionStatus, SessionMode } from '@jingcang/device-contracts';

/**
 * Session Core + Device Lease（AND-011）
 *
 * 统一设备会话状态机与独占租约管理，是"完整云手机"与"移动浏览器"两种模式的共同引擎。
 * 每台设备同一时刻只能由一个 READY 会话占用（通过 device_leases 唯一索引保证）。
 *
 * 状态机：
 *   QUEUED → ALLOCATING → BOOTING → READY → TERMINATING → TERMINATED
 * 异常分支：FAILED / EXPIRED / LOST
 */

export interface CreateSessionInput {
  userId: string;
  username?: string;
  deviceId: string;
  nodeId: string;
  mode: SessionMode;
  startUrl?: string;
  profileId?: string;
  durationMinutes?: number;
}

// 合法状态转移
const TRANSITIONS: Record<DeviceSessionStatus, DeviceSessionStatus[]> = {
  QUEUED: ['ALLOCATING', 'FAILED', 'TERMINATED'],
  ALLOCATING: ['BOOTING', 'FAILED', 'TERMINATED', 'LOST'],
  BOOTING: ['READY', 'FAILED', 'TERMINATING', 'TERMINATED', 'LOST'],
  READY: ['TERMINATING', 'EXPIRED', 'LOST', 'FAILED'],
  TERMINATING: ['TERMINATED', 'FAILED'],
  TERMINATED: [],
  FAILED: [],
  EXPIRED: [],
  LOST: ['TERMINATING', 'TERMINATED']
};

export class SessionCoreService {
  constructor(
    private config: Config,
    private db: DatabaseSync = getDb(config)
  ) {}

  private nextId(): string {
    return 'mob-' + crypto.randomUUID();
  }

  private assertTransition(from: DeviceSessionStatus, to: DeviceSessionStatus): void {
    if (!TRANSITIONS[from].includes(to)) {
      throw Object.assign(new Error(`非法状态转移: ${from} -> ${to}`), {
        code: 'INVALID_STATE_TRANSITION'
      });
    }
  }

  private transition(sessionId: string, to: DeviceSessionStatus, extra?: Record<string, unknown>): void {
    const row = this.db
      .prepare('SELECT status FROM mobile_sessions WHERE id = ?')
      .get(sessionId) as { status: DeviceSessionStatus } | undefined;
    if (!row) throw Object.assign(new Error('会话不存在'), { code: 'SESSION_NOT_FOUND' });
    this.assertTransition(row.status, to);
    const sets = ['status = ?', 'updated_at = ?', ...Object.keys(extra ?? {}).map((k) => `${k} = ?`)];
    const values: Array<string | number | null> = [
      to,
      new Date().toISOString(),
      ...Object.values(extra ?? {}).map((v) => v as string | number | null)
    ];
    this.db
      .prepare(`UPDATE mobile_sessions SET ${sets.join(', ')} WHERE id = ? AND status = ?`)
      .run(...values, sessionId, row.status);
  }

  /** 设备是否已被活动租约占用。 */
  private hasActiveLease(nodeId: string, deviceId: string): boolean {
    const row = this.db
      .prepare('SELECT lease_id FROM device_leases WHERE node_id = ? AND device_id = ? AND released_at IS NULL LIMIT 1')
      .get(nodeId, deviceId);
    return !!row;
  }

  /**
   * 创建设备会话并占用独占租约。
   * 返回会话 id 与 lease id；若设备被占用则抛 DEVICE_BUSY。
   */
  createSession(input: CreateSessionInput): { id: string; leaseId: string } {
    this.expireIdleSessions();
    if (this.hasActiveLease(input.nodeId, input.deviceId)) {
      throw Object.assign(new Error('设备正被其他会话占用'), { code: 'DEVICE_BUSY' });
    }
    const id = this.nextId();
    const leaseId = 'lease-' + crypto.randomUUID();
    const now = new Date();
    const durationMinutes = Math.min(
      Math.max(input.durationMinutes ?? this.config.sessionDefaultMinutes, 5),
      this.config.sessionMaxMinutes
    );
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000).toISOString();

    const tx = this.db.prepare('BEGIN IMMEDIATE');
    tx.run();
    try {
      this.db
        .prepare(`INSERT INTO mobile_sessions
          (id, device_id, user_id, mode, status, node_id, start_url, profile_id, lease_id, created_at, updated_at, expires_at)
          VALUES (?, ?, ?, ?, 'ALLOCATING', ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          id,
          input.deviceId,
          input.userId,
          input.mode,
          input.nodeId,
          input.startUrl ?? null,
          input.profileId ?? null,
          leaseId,
          now.toISOString(),
          now.toISOString(),
          expiresAt
        );
      this.db
        .prepare(`INSERT INTO device_leases
          (lease_id, node_id, device_id, session_id, user_id, mode, acquired_at, expires_at, released_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
        .run(leaseId, input.nodeId, input.deviceId, id, input.userId, input.mode, now.toISOString(), expiresAt);
      this.db.prepare('COMMIT').run();
      return { id, leaseId };
    } catch (err) {
      this.db.prepare('ROLLBACK').run();
      throw err;
    }
  }

  /** 设备启动中（已分配、正在 boot）。 */
  markBooting(sessionId: string): void {
    this.transition(sessionId, 'BOOTING');
  }

  /** 设备就绪，可连接。 */
  markReady(sessionId: string): void {
    this.transition(sessionId, 'READY');
    this.touch(sessionId);
  }

  fail(sessionId: string, code: string, message: string): void {
    this.transition(sessionId, 'FAILED', { failure_code: code, failure_message: message });
    this.releaseLease(sessionId);
  }

  /** 终止并释放租约。 */
  terminate(sessionId: string, finalStatus: 'TERMINATED' | 'EXPIRED' | 'LOST' = 'TERMINATED'): void {
    this.transition(sessionId, 'TERMINATING');
    this.transition(sessionId, finalStatus, { ended_at: new Date().toISOString() });
    this.releaseLease(sessionId);
  }

  /** 心跳续活。 */
  touch(sessionId: string): void {
    const threshold = new Date(Date.now() - 30000).toISOString();
    this.db
      .prepare("UPDATE mobile_sessions SET updated_at = ? WHERE id = ? AND status = 'READY' AND updated_at < ?")
      .run(new Date().toISOString(), sessionId, threshold);
  }

  /** 空闲回收：本地节点 READY 且超过阈值未活动则置 EXPIRED 并释放租约。 */
  expireIdleSessions(idleMs: number = 2 * 60 * 60 * 1000): number {
    const threshold = new Date(Date.now() - idleMs).toISOString();
    const rows = this.db
      .prepare("SELECT id FROM mobile_sessions WHERE status = 'READY' AND updated_at < ?")
      .all(threshold) as Array<{ id: string }>;
    for (const r of rows) {
      this.db
        .prepare("UPDATE mobile_sessions SET status = 'EXPIRED', ended_at = ? WHERE id = ?")
        .run(new Date().toISOString(), r.id);
      this.releaseLease(r.id);
    }
    return rows.length;
  }

  /**
   * 异常回收：对失联节点上的活动租约会话标记 LOST 并释放，避免遗留租约占用设备。
   * offlineNodes 为判定为离线的 nodeId 集合。
   */
  recoverLostLeases(offlineNodes: Set<string>): number {
    const rows = this.db
      .prepare(`SELECT s.id, s.node_id FROM mobile_sessions s
        JOIN device_leases l ON l.session_id = s.id
        WHERE s.status IN ('READY','BOOTING','ALLOCATING') AND l.released_at IS NULL`)
      .all() as Array<{ id: string; node_id: string }>;
    let recovered = 0;
    for (const r of rows) {
      if (offlineNodes.has(r.node_id)) {
        this.db
          .prepare("UPDATE mobile_sessions SET status = 'LOST', ended_at = ? WHERE id = ?")
          .run(new Date().toISOString(), r.id);
        this.releaseLease(r.id);
        recovered++;
      }
    }
    return recovered;
  }

  /** 释放会话对应的活动租约。 */
  private releaseLease(sessionId: string): void {
    this.db
      .prepare("UPDATE device_leases SET released_at = ? WHERE session_id = ? AND released_at IS NULL")
      .run(new Date().toISOString(), sessionId);
  }

  /**
   * 设备级失联回收：节点本身在线，但某台设备（含 Android 真机）从 ADB 清单
   * 消失或变为 offline/unauthorized 时，安全释放其上的活动会话与租约。
   * 返回是否回收了会话。
   */
  recoverDeviceLease(nodeId: string, deviceId: string, failureMessage = '设备失联，会话已安全释放'): boolean {
    const row = this.db
      .prepare(
        "SELECT id FROM mobile_sessions WHERE node_id = ? AND device_id = ? AND status IN ('READY','BOOTING','ALLOCATING') LIMIT 1"
      )
      .get(nodeId, deviceId) as { id: string } | undefined;
    if (!row) return false;
    this.transition(row.id, 'LOST', {
      ended_at: new Date().toISOString(),
      failure_code: 'DEVICE_OFFLINE',
      failure_message: failureMessage
    });
    this.releaseLease(row.id);
    return true;
  }

  /** 设备上是否存在活动会话（状态机未结束且占用租约）。 */
  hasActiveSessionOnDevice(nodeId: string, deviceId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT id FROM mobile_sessions WHERE node_id = ? AND device_id = ? AND status IN ('READY','BOOTING','ALLOCATING') LIMIT 1"
      )
      .get(nodeId, deviceId);
  }

  /** 流媒体/控制通道的租约活性守卫：四元组必须与创建时一致。 */
  isLeaseActive(sessionId: string, nodeId: string, deviceId: string, userId: string): boolean {
    this.expireIdleSessions();
    const row = this.db
      .prepare('SELECT status, node_id, device_id, user_id FROM mobile_sessions WHERE id = ?')
      .get(sessionId) as
      | { status: DeviceSessionStatus; node_id: string; device_id: string; user_id: string }
      | undefined;
    if (!row) return false;
    return (
      row.status === 'READY' &&
      row.node_id === nodeId &&
      row.device_id === deviceId &&
      row.user_id === userId
    );
  }

  getSession(sessionId: string): any {
    return this.db.prepare('SELECT * FROM mobile_sessions WHERE id = ?').get(sessionId);
  }

  listSessions(userId: string, isAdmin: boolean, limit = 100): any[] {
    this.expireIdleSessions();
    if (isAdmin) {
      return this.db
        .prepare('SELECT * FROM mobile_sessions ORDER BY created_at DESC LIMIT ?')
        .all(limit) as any[];
    }
    return this.db
      .prepare('SELECT * FROM mobile_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as any[];
  }
}
