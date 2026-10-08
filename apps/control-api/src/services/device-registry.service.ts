import { DatabaseSync } from 'node:sqlite';
import { getDb } from '../db/index.js';
import { Config } from '../config.js';
import type { DeviceProfile, DeviceInstance, DeviceNode } from '@jingcang/device-contracts';

/**
 * Device Registry（AND-010）
 *
 * 只读视图：将节点上报的设备实例、已安装可用的 profile 聚合为"可调度目录"。
 * 只暴露 verified / 可用的镜像版本与手机 profile，不暴露任何调试端口或凭据。
 */
export class DeviceRegistryService {
  constructor(
    private config: Config,
    private db: DatabaseSync = getDb(config),
    private staleAfterMs: number = 45000
  ) {}

  /** 已安装、可用的镜像/系统版本 profile。 */
  listProfiles(): DeviceProfile[] {
    const rows = this.db
      .prepare('SELECT * FROM device_profiles ORDER BY platform, os_version DESC')
      .all() as any[];
    return rows.map((r) => ({
      id: r.id,
      platform: r.platform,
      kind: r.kind,
      displayName: r.display_name,
      osVersion: r.os_version,
      apiLevel: r.api_level ?? undefined,
      model: r.model ?? undefined,
      imageName: r.image_name ?? undefined,
      arch: r.arch ?? undefined,
      abi: r.abi ?? undefined,
      screen: r.screen_json ? JSON.parse(r.screen_json) : undefined,
      capabilities: r.capabilities_json ? JSON.parse(r.capabilities_json) : undefined,
      managed: !!r.managed
    }));
  }

  /** 在线/离线节点清单。 */
  listNodes(): Array<DeviceNode & { online: boolean; revoked: boolean }> {
    const now = Date.now();
    const rows = this.db
      .prepare(`SELECT n.node_id, n.platform, n.started_at, n.last_seen_at, n.uptime_seconds,
        n.managed_count, n.status, n.version, c.revoked_at
        FROM device_nodes n LEFT JOIN device_node_credentials c ON c.node_id = n.node_id
        ORDER BY n.last_seen_at DESC`)
      .all() as any[];
    return rows.map((r) => ({
      nodeId: r.node_id,
      platform: r.platform,
      startedAt: r.started_at,
      lastSeenAt: r.last_seen_at,
      uptimeSeconds: r.uptime_seconds,
      managedCount: r.managed_count,
      status: r.status,
      version: r.version ?? undefined,
      online: !r.revoked_at && now - Date.parse(r.last_seen_at) < this.staleAfterMs,
      revoked: !!r.revoked_at
    }));
  }

  /** 设备实例 + 实时可用性（是否被活动租约占用）。 */
  listDevices(includeOffline = false): Array<DeviceInstance & { online: boolean; available: boolean; leased: boolean }> {
    const now = Date.now();
    const rows = this.db
      .prepare(`SELECT d.node_id, d.device_id, d.platform, d.kind, d.state, d.booted, d.last_seen_at,
        d.profile_id, d.capabilities_json, n.last_seen_at AS node_seen_at, c.revoked_at
        FROM device_instances d JOIN device_nodes n ON n.node_id = d.node_id
        LEFT JOIN device_node_credentials c ON c.node_id = d.node_id
        ORDER BY d.node_id, d.device_id`)
      .all() as any[];
    const busy = new Set(
      (
        this.db
          .prepare("SELECT node_id || ':' || device_id AS key FROM device_leases WHERE released_at IS NULL")
          .all() as Array<{ key: string }>
      ).map((s) => s.key)
    );
    return rows
      .filter((r) => includeOffline || (!r.revoked_at && now - Date.parse(r.node_seen_at) < this.staleAfterMs))
      .map((r) => {
        const key = `${r.node_id}:${r.device_id}`;
        return {
          nodeId: r.node_id,
          deviceId: r.device_id,
          platform: r.platform,
          kind: r.kind,
          state: r.state,
          booted: !!r.booted,
          lastSeenAt: r.last_seen_at,
          profileId: r.profile_id ?? undefined,
          capabilities: r.capabilities_json ? JSON.parse(r.capabilities_json) : undefined,
          online: !r.revoked_at && now - Date.parse(r.node_seen_at) < this.staleAfterMs,
          available: r.state === 'device' && !!r.booted && !busy.has(key),
          leased: busy.has(key)
        };
      });
  }

  /** 节点上报设备清单（由 heartbeat 调用）。 */
  upsertNode(node: {
    nodeId: string;
    platform: string;
    startedAt: string;
    lastSeenAt: string;
    uptimeSeconds: number;
    managedCount: number;
    version?: string;
  }): void {
    this.db
      .prepare(`INSERT INTO device_nodes
        (node_id, platform, started_at, last_seen_at, uptime_seconds, managed_count, status, version, enrolled_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ONLINE', ?, COALESCE((SELECT enrolled_at FROM device_nodes WHERE node_id = ?), ?))
        ON CONFLICT(node_id) DO UPDATE SET
          platform = excluded.platform, last_seen_at = excluded.last_seen_at,
          uptime_seconds = excluded.uptime_seconds, managed_count = excluded.managed_count,
          status = 'ONLINE', version = excluded.version`)
      .run(
        node.nodeId,
        node.platform,
        node.startedAt,
        node.lastSeenAt,
        node.uptimeSeconds,
        node.managedCount,
        node.version ?? null,
        node.nodeId,
        node.startedAt
      );
  }

  upsertDevices(
    nodeId: string,
    devices: Array<{ deviceId: string; platform: string; kind: string; state: string; booted: boolean; profileId?: string }>
  ): void {
    const tx = this.db.prepare('BEGIN IMMEDIATE');
    tx.run();
    try {
      this.db.prepare('DELETE FROM device_instances WHERE node_id = ?').run(nodeId);
      const insert = this.db.prepare(`INSERT INTO device_instances
        (node_id, device_id, platform, kind, state, booted, last_seen_at, profile_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      const now = new Date().toISOString();
      for (const d of devices) {
        insert.run(nodeId, d.deviceId, d.platform, d.kind, d.state, d.booted ? 1 : 0, now, d.profileId ?? null);
      }
      this.db.prepare('COMMIT').run();
    } catch (err) {
      this.db.prepare('ROLLBACK').run();
      throw err;
    }
  }

  /** 登记一个已安装可用的 profile（仅展示 verified 镜像）。 */
  registerProfile(profile: DeviceProfile): void {
    this.db
      .prepare(`INSERT INTO device_profiles
        (id, platform, kind, display_name, os_version, api_level, model, image_name, arch, abi, screen_json, capabilities_json, managed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name, os_version = excluded.os_version,
          api_level = excluded.api_level, model = excluded.model, image_name = excluded.image_name,
          arch = excluded.arch, abi = excluded.abi, screen_json = excluded.screen_json,
          capabilities_json = excluded.capabilities_json, managed = excluded.managed`)
      .run(
        profile.id,
        profile.platform,
        profile.kind,
        profile.displayName,
        profile.osVersion,
        profile.apiLevel ?? null,
        profile.model ?? null,
        profile.imageName ?? null,
        profile.arch ?? null,
        profile.abi ?? null,
        profile.screen ? JSON.stringify(profile.screen) : null,
        JSON.stringify(profile.capabilities ?? {}),
        profile.managed ? 1 : 0,
        new Date().toISOString()
      );
  }
}
