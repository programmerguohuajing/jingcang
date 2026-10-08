import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../services/auth.service.js';
import { getDb } from '../db/index.js';
import crypto from 'node:crypto';
import { PassThrough } from 'node:stream';
import { SessionCoreService } from '../services/session-core.service.js';
import { ViewerTokenService } from '../services/viewer-token.service.js';
import { NodeRouterService } from '../services/node-router.service.js';

/**
 * 移动设备会话路由（跨节点真实设备控制与调度 + 失联恢复 + Android 真机池）
 *
 * 会话生命周期与独占租约统一由 SessionCoreService 管理；流媒体/截图/控制通道
 * 受 Viewer Token（绑定 user/session/device/lease）保护。
 *
 * 跨节点调度：所有设备操作不再固定转发到本机 windows-local-dev，而是通过
 * NodeRouterService 按会话归属 node_id 解析"节点端点 + 调用凭证"动态路由。
 * 节点心跳/凭证撤销/健康探测由 NodeRecoveryService 周期性确认并安全释放。
 */
export function registerMobileDeviceRoutes(
  server: FastifyInstance,
  auth: AuthService,
  sessionCore: SessionCoreService,
  viewerToken: ViewerTokenService,
  router: NodeRouterService
) {
  const LOCAL_NODE = NodeRouterService.LOCAL_NODE;
  const db = getDb();

  function userFor(req: any) {
    const token = req.cookies.jc_token || req.headers.authorization?.replace('Bearer ', '');
    return auth.getUserFromToken(token || '');
  }

  /**
   * 按节点路由到对应 Agent（跨节点调度核心）。
   * 节点端点由 NodeRouterService 解析；windows-local-dev 沿用环境变量，
   * 远程节点使用登记/上报的端点与解密后的调用凭证。
   */
  async function agent(nodeId: string, path: string, options: RequestInit = {}) {
    const endpoint = router.resolve(nodeId);
    if (!endpoint) throw Object.assign(new Error('节点不可路由'), { code: 'NODE_NOT_ROUTABLE' });
    const timeout = path.endsWith('/automation') ? 180000 : path.endsWith('/install') ? 120000 : 15000;
    const result = await fetch(new URL(path, endpoint.agentUrl + '/'), {
      ...options,
      headers: { ...options.headers, Authorization: 'Bearer ' + endpoint.agentToken },
      signal: AbortSignal.timeout(timeout)
    });
    return result;
  }

  /** 本机节点快捷方式（capabilities / profiles / system-images / health 仍面向本机 Agent）。 */
  async function localAgent(path: string, options: RequestInit = {}) {
    return agent(LOCAL_NODE, path, options);
  }

  /** 节点端点是否合法：http 仅限回环/开发主机，其余必须 https。 */
  function validAgentUrl(raw: unknown): raw is string {
    if (typeof raw !== 'string' || raw.length > 500) return false;
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return false;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', 'host.docker.internal'].includes(parsed.hostname)) {
      return false;
    }
    return true;
  }

  function validAgentToken(raw: unknown): raw is string {
    return typeof raw === 'string' && /^[a-f0-9]{64}$/.test(raw);
  }

  // ---- 节点注册 / 心跳 / 吊销（含端点登记与设备级断线回收）----
  server.post('/api/v1/mobile/nodes/enroll', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });
    const body = req.body as { nodeId?: string; agentUrl?: string; agentToken?: string } | undefined;
    const nodeId = body?.nodeId;
    if (!nodeId || !/^[A-Za-z0-9._-]{1,80}$/.test(nodeId) || nodeId === LOCAL_NODE)
      return reply.code(400).send({ success: false, error: { code: 'INVALID_NODE_ID' } });
    if (db.prepare('SELECT node_id FROM mobile_node_credentials WHERE node_id = ?').get(nodeId))
      return reply.code(409).send({ success: false, error: { code: 'NODE_ALREADY_ENROLLED' } });
    // 跨节点调度：登记控制面可达端点与调用凭证（可选，Agent 也可通过心跳上报 agentUrl）
    if (body?.agentUrl !== undefined && body?.agentUrl !== '' && !validAgentUrl(body.agentUrl))
      return reply.code(400).send({ success: false, error: { code: 'INVALID_AGENT_URL' } });
    if (body?.agentToken !== undefined && body?.agentToken !== '' && !validAgentToken(body.agentToken))
      return reply.code(400).send({ success: false, error: { code: 'INVALID_AGENT_TOKEN' } });
    const credential = crypto.randomBytes(32).toString('hex');
    const digest = crypto.createHash('sha256').update(credential).digest('hex');
    db.prepare('INSERT INTO mobile_node_credentials(node_id,token_hash,created_at) VALUES(?,?,?)').run(
      nodeId,
      digest,
      new Date().toISOString()
    );
    if (body?.agentUrl) {
      router.upsertEndpoint(
        nodeId,
        body.agentUrl,
        body.agentToken ? router.encryptSecret(body.agentToken) : undefined
      );
    }
    return reply.code(201).send({ success: true, data: { nodeId, credential, routable: !!body?.agentUrl } });
  });

  server.post('/api/v1/mobile/nodes/:id/heartbeat', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id))
      return reply.code(400).send({ success: false, error: { code: 'INVALID_NODE_ID' } });
    const bearer = req.headers.authorization;
    if (!bearer || !/^Bearer [a-f0-9]{64}$/.test(bearer))
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    const tokenHash = crypto.createHash('sha256').update(bearer.slice(7)).digest('hex');
    const record = db
      .prepare('SELECT token_hash,revoked_at FROM mobile_node_credentials WHERE node_id=?')
      .get(id) as { token_hash: string; revoked_at: string | null } | undefined;
    if (!record || record.revoked_at || !crypto.timingSafeEqual(Buffer.from(record.token_hash, 'hex'), Buffer.from(tokenHash, 'hex')))
      return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    const body = req.body as {
      platform?: string;
      uptimeSeconds?: number;
      managedEmulatorCount?: number;
      startedAt?: string;
      agentUrl?: string;
      devices?: Array<{ id: string; kind: string; state: string; booted?: boolean }>;
    } | undefined;
    const platform = body?.platform;
    if (
      !platform ||
      !/^[a-z0-9._-]{1,32}$/i.test(platform) ||
      !Number.isSafeInteger(body?.uptimeSeconds) ||
      (body!.uptimeSeconds as number) < 0 ||
      !Number.isSafeInteger(body?.managedEmulatorCount) ||
      (body!.managedEmulatorCount as number) < 0
    )
      return reply.code(400).send({ success: false, error: { code: 'INVALID_HEARTBEAT' } });
    if (body?.agentUrl !== undefined && body?.agentUrl !== '' && !validAgentUrl(body.agentUrl))
      return reply.code(400).send({ success: false, error: { code: 'INVALID_AGENT_URL' } });
    if (
      body?.devices !== undefined &&
      (!Array.isArray(body.devices) ||
        body.devices.length > 100 ||
        body.devices.some(
          (x) =>
            !x ||
            typeof x.id !== 'string' ||
            !/^[a-zA-Z0-9._:-]{1,80}$/.test(x.id) ||
            !['android-emulator', 'android-real'].includes(x.kind) ||
            !['device', 'offline', 'unauthorized'].includes(x.state) ||
            typeof x.booted !== 'boolean'
        ))
    )
      return reply.code(400).send({ success: false, error: { code: 'INVALID_DEVICE_INVENTORY' } });
    if (body?.devices && new Set(body.devices.map((x) => x.id)).size !== body.devices.length)
      return reply.code(400).send({ success: false, error: { code: 'DUPLICATE_DEVICE_ID' } });
    const now = new Date().toISOString();
    const startedAt =
      typeof body?.startedAt === 'string' && !Number.isNaN(Date.parse(body.startedAt))
        ? new Date(body.startedAt).toISOString()
        : now;
    db.prepare(`INSERT INTO mobile_agent_nodes(node_id,platform,started_at,last_seen_at,uptime_seconds,managed_count)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(node_id) DO UPDATE SET platform=excluded.platform,started_at=excluded.started_at,
        last_seen_at=excluded.last_seen_at,uptime_seconds=excluded.uptime_seconds,managed_count=excluded.managed_count`)
      .run(id, platform, startedAt, now, body!.uptimeSeconds!, body!.managedEmulatorCount!);
    // 心跳上报控制面可达端点 → 节点可被跨节点调度
    if (body?.agentUrl) router.upsertEndpoint(id, body.agentUrl);
    if (body?.devices) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM mobile_node_devices WHERE node_id=?').run(id);
        const insert = db.prepare('INSERT INTO mobile_node_devices(node_id,device_id,kind,state,booted,last_seen_at) VALUES(?,?,?,?,?,?)');
        for (const device of body.devices) insert.run(id, device.id, device.kind, device.state, device.booted ? 1 : 0, now);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      // Android 真机/模拟器断线检测：节点在线但设备从 ADB 清单消失或失效
      // → 安全释放该设备上的活动会话与租约，避免真机拔出后设备被"幽灵占用"。
      const reported = new Set(
        body.devices.filter((d) => d.state === 'device' && d.booted).map((d) => d.id)
      );
      const active = db
        .prepare("SELECT id, device_id FROM mobile_sessions WHERE node_id=? AND status='READY'")
        .all(id) as Array<{ id: string; device_id: string }>;
      for (const s of active) {
        if (!reported.has(s.device_id)) {
          sessionCore.recoverDeviceLease(id, s.device_id, '设备断线（ADB 清单消失或失效），会话已安全释放');
        }
      }
    }
    return { success: true, data: { nodeId: id, lastSeenAt: now } };
  });

  server.post('/api/v1/mobile/nodes/:id/revoke', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });
    const { id } = req.params as { id: string };
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id)) return reply.code(400).send({ success: false, error: { code: 'INVALID_NODE_ID' } });
    const result = db
      .prepare('UPDATE mobile_node_credentials SET revoked_at=? WHERE node_id=? AND revoked_at IS NULL')
      .run(new Date().toISOString(), id);
    return { success: true, data: { revoked: result.changes > 0 } };
  });

  server.get('/api/v1/mobile/agent-health', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    try {
      const response = await localAgent('/health');
      if (!response.ok) throw new Error('AGENT_UNHEALTHY');
      const data = (await response.json()) as {
        nodeId?: string;
        platform?: string;
        startedAt?: string;
        uptimeSeconds?: number;
        managedEmulatorCount?: number;
      };
      const now = new Date().toISOString();
      if (typeof data.nodeId === 'string' && /^[A-Za-z0-9._-]{1,80}$/.test(data.nodeId)) {
        db.prepare(`INSERT INTO mobile_agent_nodes(node_id,platform,started_at,last_seen_at,uptime_seconds,managed_count)
          VALUES(?,?,?,?,?,?) ON CONFLICT(node_id) DO UPDATE SET platform=excluded.platform,started_at=excluded.started_at,
          last_seen_at=excluded.last_seen_at,uptime_seconds=excluded.uptime_seconds,managed_count=excluded.managed_count`)
          .run(
            data.nodeId,
            String(data.platform || 'unknown').slice(0, 32),
            String(data.startedAt || now),
            now,
            Math.max(0, Math.floor(data.uptimeSeconds || 0)),
            Math.max(0, Math.floor(data.managedEmulatorCount || 0))
          );
      }
      return { success: true, data: { ...data, reachable: true, checkedAt: now } };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.get('/api/v1/mobile/nodes', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    const now = Date.now();
    const rows = db
      .prepare(`SELECT n.node_id,n.platform,n.started_at,n.last_seen_at,n.uptime_seconds,n.managed_count,n.agent_url,c.revoked_at
        FROM mobile_agent_nodes n LEFT JOIN mobile_node_credentials c ON c.node_id=n.node_id
        ORDER BY n.last_seen_at DESC`)
      .all() as Array<{
        node_id: string;
        platform: string;
        started_at: string;
        last_seen_at: string;
        uptime_seconds: number;
        managed_count: number;
        agent_url: string | null;
        revoked_at: string | null;
      }>;
    return {
      success: true,
      data: {
        nodes: rows.map(({ revoked_at, agent_url, ...row }) => {
          const online = !revoked_at && now - Date.parse(row.last_seen_at) < 45000;
          return {
            ...row,
            online,
            revoked: !!revoked_at,
            routable: online && !!agent_url && !revoked_at
          };
        }),
        staleAfterMs: 45000
      }
    };
  });

  server.get('/api/v1/mobile/node-devices', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    const now = Date.now();
    const rows = db
      .prepare(`SELECT d.node_id,d.device_id,d.kind,d.state,d.booted,d.last_seen_at,n.last_seen_at AS node_seen_at,
        n.agent_url, c.revoked_at
        FROM mobile_node_devices d JOIN mobile_agent_nodes n ON n.node_id=d.node_id
        LEFT JOIN mobile_node_credentials c ON c.node_id=d.node_id ORDER BY d.node_id,d.device_id`)
      .all() as Array<{
        node_id: string;
        device_id: string;
        kind: string;
        state: string;
        booted: number;
        last_seen_at: string;
        node_seen_at: string;
        agent_url: string | null;
        revoked_at: string | null;
      }>;
    const busy = new Set(
      (
        db.prepare("SELECT node_id || ':' || device_id AS key FROM device_leases WHERE released_at IS NULL").all() as Array<{
          key: string;
        }>
      ).map((s) => s.key)
    );
    return {
      success: true,
      data: {
        devices: rows.map((d) => {
          const online = !d.revoked_at && now - Date.parse(d.node_seen_at) < 45000;
          const routable = online && !!d.agent_url && !d.revoked_at;
          return {
            nodeId: d.node_id,
            id: d.device_id,
            kind: d.kind,
            state: d.state,
            booted: !!d.booted,
            online,
            routable,
            // Android 真机/模拟器已纳入可调度设备池：节点在线、设备可用、无占用租约即可分配
            available: routable && d.state === 'device' && !!d.booted && !busy.has(d.node_id + ':' + d.device_id),
            leased: busy.has(d.node_id + ':' + d.device_id)
          };
        })
      }
    };
  });

  // ---- 多节点设备池（含 Android 真机）----
  server.get('/api/v1/mobile/devices', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    sessionCore.expireIdleSessions();
    const busy = new Set(
      (
        db.prepare("SELECT node_id || ':' || device_id AS key FROM mobile_sessions WHERE status='READY'").all() as Array<{
          key: string;
        }>
      ).map((s) => s.key)
    );
    // 优先列出已登记端点的在线节点；无任何节点时回退到本机（向后兼容）
    const nodeIds = router.routableNodeIds();
    if (!nodeIds.length && router.hasNode(LOCAL_NODE)) nodeIds.push(LOCAL_NODE);
    if (!nodeIds.length) {
      return { success: true, data: { status: 'offline', devices: [] } };
    }
    const devices: any[] = [];
    let anyReachable = false;
    for (const nodeId of nodeIds) {
      try {
        const result = await agent(nodeId, '/devices');
        if (!result.ok) continue;
        anyReachable = true;
        const payload = (await result.json()) as {
          devices: Array<{ id: string; kind: string; state: string; booted?: boolean; model?: string; osVersion?: string }>;
        };
        for (const d of payload.devices) {
          devices.push({
            ...d,
            nodeId,
            available: d.state === 'device' && d.booted === true && !busy.has(nodeId + ':' + d.id),
            leased: busy.has(nodeId + ':' + d.id)
          });
        }
      } catch {
        // 单节点不可达不影响其它节点聚合
      }
    }
    return {
      success: true,
      data: { status: anyReachable ? 'online' : 'offline', devices }
    };
  });

  server.get('/api/v1/mobile/capabilities', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    try {
      const response = await localAgent('/capabilities');
      if (!response.ok) throw Error('CAPABILITIES_UNAVAILABLE');
      return { success: true, data: await response.json() };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.get('/api/v1/mobile/system-images', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    try {
      const response = await localAgent('/system-images');
      if (!response.ok) throw Error('IMAGES_UNAVAILABLE');
      return { success: true, data: await response.json() };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.get('/api/v1/mobile/profiles', async (req, reply) => {
    if (!userFor(req)) return reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED' } });
    try {
      const response = await localAgent('/profiles');
      if (!response.ok) throw Error('PROFILES_UNAVAILABLE');
      return { success: true, data: await response.json() };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.post('/api/v1/mobile/profiles/create', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });
    const body = req.body as { apiLevel?: number };
    if (!body || ![24, 27, 34].includes(body.apiLevel ?? -1)) return reply.code(400).send({ success: false, error: { code: 'UNSUPPORTED_IMAGE' } });
    try {
      const response = await localAgent('/profiles/create', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiLevel: body.apiLevel }) });
      const result = await response.json();
      return reply.code(response.status).send(response.ok ? { success: true, data: result } : { success: false, error: result });
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.post('/api/v1/mobile/profiles/:id/delete', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });
    const { id } = req.params as { id: string };
    if (!/^JingCang_Test_API(?:24|27)_x86$|^JingCang_Test_API34_x86_64$/.test(id))
      return reply.code(400).send({ success: false, error: { code: 'INVALID_MANAGED_AVD' } });
    try {
      const response = await localAgent('/profiles/' + id + '/delete', { method: 'POST' });
      const result = await response.json();
      return reply.code(response.status).send(response.ok ? { success: true, data: result } : { success: false, error: result });
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.post('/api/v1/mobile/profiles/:id/:operation', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false });
    if (user.role !== 'admin') return reply.code(403).send({ success: false, error: { code: 'ADMIN_ONLY' } });
    const { id, operation } = req.params as { id: string; operation: string };
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(id) || !['start', 'stop'].includes(operation))
      return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST' } });
    if (operation === 'start' || operation === 'stop') {
      sessionCore.expireIdleSessions();
      const inUse = db.prepare("SELECT id FROM mobile_sessions WHERE device_id='emulator-5580' AND status='READY' LIMIT 1").get();
      if (inUse) return reply.code(409).send({ success: false, error: { code: 'DEVICE_BUSY' } });
    }
    try {
      const response = await localAgent('/profiles/' + encodeURIComponent(id) + '/' + operation, { method: 'POST' });
      const result = await response.json();
      return reply.code(response.status).send(response.ok ? { success: true, data: result } : { success: false, error: result });
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  // ---- 会话生命周期（统一 Session Core + Lease，跨节点调度）----
  server.get('/api/v1/mobile/sessions', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false });
    const rows = sessionCore.listSessions(user.id, user.role === 'admin');
    return { success: true, data: rows };
  });

  server.post('/api/v1/mobile/sessions', async (req, reply) => {
    const user = userFor(req);
    if (!user) return reply.code(401).send({ success: false });
    const data = req.body as { deviceId?: string; nodeId?: string; mode?: string; startUrl?: string };
    if (!data || !/^[\w.:-]{1,80}$/.test(data.deviceId || '') || !['phone', 'browser'].includes(data.mode || ''))
      return reply.code(400).send({ success: false, error: { code: 'INVALID_REQUEST' } });
    // 跨节点调度：允许指定任意已登记端点且离线的节点（默认 windows-local-dev）
    const nodeId = typeof data.nodeId === 'string' && data.nodeId !== '' ? data.nodeId : LOCAL_NODE;
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(nodeId) || !router.hasNode(nodeId))
      return reply.code(409).send({ success: false, error: { code: 'NODE_NOT_ROUTABLE' } });
    // 本机节点仅需端点配置即可调度；远程节点要求心跳在线（避免调度到失联节点）
    const reachable = nodeId === LOCAL_NODE || router.isOnline(nodeId);
    if (!reachable)
      return reply.code(409).send({ success: false, error: { code: 'NODE_OFFLINE' } });
    try {
      const response = await agent(nodeId, '/devices');
      if (!response.ok) throw Error('AGENT_OFFLINE');
      const info = (await response.json()) as { devices: Array<{ id: string; state: string; booted?: boolean }> };
      if (!info.devices.some((d) => d.id === data.deviceId && d.state === 'device' && d.booted))
        return reply.code(409).send({ success: false, error: { code: 'DEVICE_UNAVAILABLE' } });

      const { id, leaseId } = sessionCore.createSession({
        userId: user.id,
        deviceId: data.deviceId!,
        nodeId,
        mode: data.mode as 'phone' | 'browser',
        startUrl: data.startUrl,
        durationMinutes: 60
      });

      if (data.mode === 'browser') {
        try {
          const url = new URL(data.startUrl || 'https://example.com');
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw Error('INVALID_URL');
          const started = await agent(nodeId, '/devices/' + encodeURIComponent(data.deviceId!) + '/action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'navigate', url: url.href })
          });
          if (!started.ok) throw Error('CHROME_LAUNCH_FAILED');
        } catch (e) {
          sessionCore.fail(id, 'CHROME_LAUNCH_FAILED', String((e as Error).message));
          throw e;
        }
      }
      // 状态机：ALLOCATING → BOOTING → READY
      sessionCore.markBooting(id);
      sessionCore.markReady(id);

      const viewerTokenStr = viewerToken.issue({
        sub: user.id,
        sid: id,
        did: data.deviceId!,
        lid: leaseId,
        node: nodeId,
        mode: data.mode as 'phone' | 'browser'
      });
      db.prepare('UPDATE mobile_sessions SET viewer_token_hash = ? WHERE id = ?').run(
        viewerToken.digest(viewerTokenStr),
        id
      );

      return reply.code(201).send({
        success: true,
        data: {
          id,
          deviceId: data.deviceId,
          nodeId,
          mode: data.mode,
          status: 'READY',
          leaseId,
          viewerToken: viewerTokenStr
        }
      });
    } catch (e: any) {
      return reply.code(409).send({ success: false, error: { code: 'DEVICE_BUSY_OR_OFFLINE', message: String(e.message) } });
    }
  });

  async function owner(req: any, reply: any) {
    const user = userFor(req);
    if (!user) {
      reply.code(401).send({ success: false });
      return null;
    }
    const { id } = req.params as { id: string };
    const row = db.prepare('SELECT * FROM mobile_sessions WHERE id=?').get(id) as any;
    if (!row) {
      reply.code(404).send({ success: false });
      return null;
    }
    if (row.user_id !== user.id && user.role !== 'admin') {
      reply.code(403).send({ success: false });
      return null;
    }
    // 跨节点动态路由：会话归属节点必须可被 NodeRouter 解析（端点+凭证），
    // 否则拒绝设备操作，避免误转发到其他节点或不可信主机。
    if (!router.hasNode(row.node_id)) {
      reply.code(409).send({ success: false, error: { code: 'NODE_NOT_ROUTABLE' } });
      return null;
    }
    // 可选 Viewer Token 校验（CORE-004）：绑定四元组
    const vt = (req.query as any)?.vt as string | undefined;
    if (vt) {
      const claims = viewerToken.verify(vt);
      if (!claims || claims.sid !== id || claims.did !== row.device_id || claims.lid !== row.lease_id) {
        reply.code(401).send({ success: false, error: { code: 'INVALID_VIEWER_TOKEN' } });
        return null;
      }
    }
    return row;
  }

  server.post('/api/v1/mobile/sessions/:id/heartbeat', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    if (!sessionCore.isLeaseActive(row.id, row.node_id, row.device_id, row.user_id))
      return reply.code(409).send({ success: false, error: { code: 'SESSION_NOT_READY' } });
    sessionCore.touch(row.id);
    return { success: true, data: { id: row.id, status: 'READY', heartbeatIntervalMs: 30000 } };
  });

  server.delete('/api/v1/mobile/sessions/:id', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    sessionCore.terminate(row.id);
    return { success: true };
  });

  server.get('/api/v1/mobile/sessions/:id/stream', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    if (row.status !== 'READY') return reply.code(409).send({ success: false, error: { code: 'SESSION_NOT_READY' } });
    const boundary = 'jingcang-frame';
    const output = new PassThrough({ highWaterMark: 1024 * 1024 });
    let closed = false;
    const stop = () => {
      closed = true;
      output.end();
    };
    reply.raw.on('close', stop);
    reply.header('Content-Type', 'multipart/x-mixed-replace; boundary=' + boundary);
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('X-Accel-Buffering', 'no');
    reply.header('Connection', 'keep-alive');
    reply.send(output);
    void (async () => {
      const deadline = Date.now() + 100000;
      while (!closed && Date.now() < deadline) {
        if (!sessionCore.isLeaseActive(row.id, row.node_id, row.device_id, row.user_id)) break;
        try {
          const shot = await agent(row.node_id, '/devices/' + encodeURIComponent(row.device_id) + '/screenshot');
          if (!shot.ok) break;
          const buffer = Buffer.from(await shot.arrayBuffer());
          if (buffer.length < 8 || buffer.length > 12 * 1024 * 1024) break;
          if (closed || !sessionCore.isLeaseActive(row.id, row.node_id, row.device_id, row.user_id)) break;
          const chunk = Buffer.concat([
            Buffer.from('--' + boundary + '\r\nContent-Type: image/png\r\nContent-Length: ' + buffer.length + '\r\n\r\n'),
            buffer,
            Buffer.from('\r\n')
          ]);
          if (!output.write(chunk)) await new Promise<void>((resolve) => output.once('drain', resolve));
          sessionCore.touch(row.id);
        } catch {
          break;
        }
        if (!closed) await new Promise((resolve) => setTimeout(resolve, 550));
      }
      if (!closed) output.end();
    })();
    return reply;
  });

  server.get('/api/v1/mobile/sessions/:id/h264', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    if (row.status !== 'READY') return reply.code(409).send({ success: false, error: { code: 'SESSION_NOT_READY' } });
    const endpoint = router.resolve(row.node_id);
    if (!endpoint) return reply.code(409).send({ success: false, error: { code: 'NODE_NOT_ROUTABLE' } });
    const controller = new AbortController();
    let upstream: Response;
    try {
      upstream = await fetch(new URL('/devices/' + encodeURIComponent(row.device_id) + '/h264', endpoint.agentUrl + '/'), {
        headers: { Authorization: 'Bearer ' + endpoint.agentToken },
        signal: controller.signal
      });
      if (!upstream.ok || !upstream.body) {
        controller.abort();
        return reply.code(503).send({ success: false, error: { code: 'H264_UNAVAILABLE' } });
      }
    } catch {
      controller.abort();
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { 'Content-Type': 'video/h264', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    raw.on('close', () => controller.abort());
    const leaseMonitor = setInterval(() => {
      if (!sessionCore.isLeaseActive(row.id, row.node_id, row.device_id, row.user_id)) controller.abort();
    }, 1000);
    const reader = upstream.body.getReader();
    try {
      while (!raw.destroyed && sessionCore.isLeaseActive(row.id, row.node_id, row.device_id, row.user_id)) {
        const item = await reader.read();
        if (item.done || !sessionCore.isLeaseActive(row.id, row.node_id, row.device_id, row.user_id)) break;
        if (!raw.write(Buffer.from(item.value))) await new Promise<void>((resolve) => raw.once('drain', resolve));
      }
    } catch {
      /* Client disconnected, revoked lease or Agent stopped. */
    } finally {
      clearInterval(leaseMonitor);
      controller.abort();
      void reader.cancel().catch(() => {});
      if (!raw.destroyed) raw.end();
    }
  });

  server.get('/api/v1/mobile/sessions/:id/screenshot', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    if (row.status !== 'READY') return reply.code(409).send({ success: false });
    try {
      const response = await agent(row.node_id, '/devices/' + encodeURIComponent(row.device_id) + '/screenshot');
      if (!response.ok) throw Error('SCREENSHOT_FAILED');
      sessionCore.touch(row.id);
      reply.header('Cache-Control', 'no-store').type('image/png');
      return reply.send(Buffer.from(await response.arrayBuffer()));
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.get('/api/v1/mobile/sessions/:id/apps', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    if (row.status !== 'READY') return reply.code(409).send({ success: false });
    try {
      const response = await agent(row.node_id, '/devices/' + encodeURIComponent(row.device_id) + '/apps');
      if (!response.ok) throw Error('APP_LIST_FAILED');
      sessionCore.touch(row.id);
      return { success: true, data: await response.json() };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.post(
    '/api/v1/mobile/sessions/:id/install',
    { bodyLimit: 12 * 1024 * 1024 },
    async (req, reply) => {
      const row = await owner(req, reply);
      if (!row) return;
      if (row.status !== 'READY') return reply.code(409).send({ success: false });
      const payload = req.body as { base64?: unknown };
      if (typeof payload?.base64 !== 'string' || payload.base64.length > 11 * 1024 * 1024 || payload.base64.length < 100)
        return reply.code(400).send({ success: false, error: { code: 'INVALID_APK' } });
      try {
        const response = await agent(row.node_id, '/devices/' + encodeURIComponent(row.device_id) + '/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: payload.base64 })
        });
        if (!response.ok) return reply.code(response.status).send({ success: false, error: { code: 'INSTALL_FAILED' } });
        sessionCore.touch(row.id);
        return { success: true, data: await response.json() };
      } catch {
        return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
      }
    }
  );

  server.post('/api/v1/mobile/sessions/:id/automation', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    if (row.status !== 'READY') return reply.code(409).send({ success: false, error: { code: 'SESSION_NOT_READY' } });
    if (row.mode !== 'browser') return reply.code(400).send({ success: false, error: { code: 'BROWSER_MODE_REQUIRED' } });
    try {
      const response = await agent(row.node_id, '/devices/' + encodeURIComponent(row.device_id) + '/automation', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) return reply.code(response.status).send({ success: false, error: { code: 'AUTOMATION_FAILED', message: String(result.message || '').slice(0, 350) } });
      sessionCore.touch(row.id);
      return { success: true, data: result };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });

  server.post('/api/v1/mobile/sessions/:id/actions', async (req, reply) => {
    const row = await owner(req, reply);
    if (!row) return;
    if (row.status !== 'READY') return reply.code(409).send({ success: false });
    try {
      const result = await agent(row.node_id, '/devices/' + encodeURIComponent(row.device_id) + '/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      if (!result.ok) return reply.code(result.status).send({ success: false, error: { code: 'ACTION_REJECTED' } });
      sessionCore.touch(row.id);
      return { success: true };
    } catch {
      return reply.code(503).send({ success: false, error: { code: 'AGENT_OFFLINE' } });
    }
  });
}