import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { getDb } from '../db/index.js';
import { DeviceRegistryService } from '../services/device-registry.service.js';
import { DeviceProfileSchema, NodeHeartbeatSchema, NodeCredentialSchema } from '@jingcang/device-contracts';

/**
 * 统一设备目录 / 节点注册 API（AND-010）
 *
 * 提供计划要求的：GET /api/v1/devices、GET /api/v1/device-profiles、
 * POST /api/v1/device-nodes/register、POST /api/v1/device-nodes/heartbeat。
 * 注册/心跳同时桥接写入 legacy mobile_node_* 表，保证既有移动端路由在过渡期仍可工作。
 */
export function registerDeviceRoutes(
  server: FastifyInstance,
  auth: { getUserFromToken: (token: string) => any | null },
  registry: DeviceRegistryService
) {
  const db = getDb();

  const nodeIdRe = /^[A-Za-z0-9._-]{1,80}$/;

  function userFor(req: any) {
    const token = req.cookies.jc_token || req.headers.authorization?.replace('Bearer ', '');
    return auth.getUserFromToken(token || '');
  }

  // 仅展示已安装、可用的 profile
  server.get('/api/v1/device-profiles', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    try {
      return { success: true, data: { profiles: registry.listProfiles(), staleAfterMs: 45000 } };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
    }
  });

  server.get('/api/v1/devices', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    try {
      return { success: true, data: { devices: registry.listDevices(), staleAfterMs: 45000 } };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
    }
  });

  server.get('/api/v1/device-nodes', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    try {
      return { success: true, data: { nodes: registry.listNodes(), staleAfterMs: 45000 } };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'REGISTRY_UNAVAILABLE' } });
    }
  });

  // 节点注册（admin only），一次性返回凭据（明文仅此一次，库内存 SHA-256）
  server.post('/api/v1/device-nodes/register', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });

    const parsed = NodeCredentialSchema; // 仅用于类型提示
    void parsed;
    const body = req.body as { nodeId?: string };
    const nodeId = body?.nodeId;
    if (!nodeId || !nodeIdRe.test(nodeId) || nodeId === 'windows-local-dev') {
      return reply.code(400).send({ success: false, error: { code: 'INVALID_NODE_ID' } });
    }
    if (db.prepare('SELECT node_id FROM device_node_credentials WHERE node_id = ?').get(nodeId)) {
      return reply.code(409).send({ success: false, error: { code: 'NODE_ALREADY_ENROLLED' } });
    }
    const credential = crypto.randomBytes(32).toString('hex');
    const digest = crypto.createHash('sha256').update(credential).digest('hex');
    const now = new Date().toISOString();
    db.prepare('INSERT INTO device_node_credentials(node_id, token_hash, created_at) VALUES (?, ?, ?)')
      .run(nodeId, digest, now);
    // 桥接 legacy 表
    db.prepare('INSERT OR IGNORE INTO mobile_node_credentials(node_id, token_hash, created_at) VALUES (?, ?, ?)')
      .run(nodeId, digest, now);
    return reply.code(201).send({ success: true, data: { nodeId, credential } });
  });

  server.post('/api/v1/device-nodes/:id/heartbeat', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!nodeIdRe.test(id)) return reply.code(400).send({ success: false, error: { code: 'INVALID_NODE_ID' } });
    const bearer = req.headers.authorization;
    if (!bearer || !/^Bearer [a-f0-9]{64}$/.test(bearer)) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    }
    const tokenHash = crypto.createHash('sha256').update(bearer.slice(7)).digest('hex');
    const record = db
      .prepare('SELECT token_hash, revoked_at FROM device_node_credentials WHERE node_id = ?')
      .get(id) as { token_hash: string; revoked_at: string | null } | undefined;
    if (!record || record.revoked_at || !crypto.timingSafeEqual(Buffer.from(record.token_hash, 'hex'), Buffer.from(tokenHash, 'hex'))) {
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    }

    const body = req.body as any;
    const parsed = NodeHeartbeatSchema.safeParse(body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_HEARTBEAT' } });
    const hb = parsed.data;
    const now = new Date().toISOString();
    const startedAt = hb.startedAt ?? now;

    registry.upsertNode({
      nodeId: id,
      platform: hb.platform,
      startedAt,
      lastSeenAt: now,
      uptimeSeconds: hb.uptimeSeconds,
      managedCount: hb.managedEmulatorCount,
      version: process.env.JINGCANG_AGENT_VERSION
    });
    if (hb.devices.length) {
      registry.upsertDevices(
        id,
        hb.devices.map((d) => ({
          deviceId: d.id,
          platform: d.kind.startsWith('android') ? 'android' : 'ios',
          kind: d.kind,
          state: d.state,
          booted: d.booted,
        }))
      );
    }

    // 桥接 legacy mobile_* 表，保证既有 /api/v1/mobile/* 路由继续可用
    db.prepare(`INSERT INTO mobile_agent_nodes(node_id, platform, started_at, last_seen_at, uptime_seconds, managed_count)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET platform=excluded.platform, started_at=excluded.started_at,
        last_seen_at=excluded.last_seen_at, uptime_seconds=excluded.uptime_seconds, managed_count=excluded.managed_count`)
      .run(id, hb.platform, startedAt, now, hb.uptimeSeconds, hb.managedEmulatorCount);
    if (hb.devices.length) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM mobile_node_devices WHERE node_id = ?').run(id);
        const insert = db.prepare('INSERT INTO mobile_node_devices(node_id, device_id, kind, state, booted, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)');
        for (const d of hb.devices) insert.run(id, d.id, d.kind, d.state, d.booted ? 1 : 0, now);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }

    return { success: true, data: { nodeId: id, lastSeenAt: now } };
  });

  server.post('/api/v1/device-nodes/:id/revoke', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });
    const { id } = req.params as { id: string };
    if (!nodeIdRe.test(id)) return reply.code(400).send({ success: false, error: { code: 'INVALID_NODE_ID' } });
    const result = db
      .prepare('UPDATE device_node_credentials SET revoked_at = ? WHERE node_id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), id);
    db.prepare('UPDATE mobile_node_credentials SET revoked_at = ? WHERE node_id = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), id);
    db.prepare("UPDATE device_nodes SET status = 'REVOKED' WHERE node_id = ?").run(id);
    return { success: true, data: { revoked: result.changes > 0 } };
  });

  // 由 Agent 上报的已安装镜像登记到目录（admin 或经节点凭据）
  server.post('/api/v1/device-profiles', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });
    const parsed = DeviceProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { code: 'INVALID_PROFILE', message: parsed.error.message } });
    }
    registry.registerProfile(parsed.data);
    return reply.code(201).send({ success: true, data: { id: parsed.data.id } });
  });
}
