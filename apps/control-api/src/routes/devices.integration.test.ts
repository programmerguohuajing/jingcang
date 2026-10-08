import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { getDb } from '../db/index.js';
import { Config } from '../config.js';
import { DeviceRegistryService } from '../services/device-registry.service.js';
import { registerDeviceRoutes } from './devices.js';

/**
 * 控制面设备目录集成测试（AND-010 / CORE-009 集成测试门禁）
 *
 * 以最小 Fastify 实例挂载真实设备目录路由 + 真实 SQLite（临时文件）+ 鉴权桩，
 * 通过 HTTP inject 跑通「登记 profile → 注册节点取凭据 → 心跳上报 → 目录可见
 * → 撤销节点」全链路，无需任何真机/模拟器/ADB。可在 CI 无硬件环境执行。
 */

function makeConfig(): Config {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-it-'));
  const dbPath = path.join(tmp, 'it.sqlite');
  return {
    rootDir: tmp,
    port: 0,
    bindHost: '127.0.0.1',
    baseUrl: 'http://localhost:8088',
    publicHostname: 'jingcang.localhost',
    timezone: 'Asia/Shanghai',
    sessionDefaultMinutes: 60,
    sessionMaxMinutes: 120,
    sessionIdleMinutes: 30,
    sessionMaxConcurrency: 4,
    sessionQueueLimit: 10,
    artifactRetentionDays: 7,
    artifactMaxTotalGb: 50,
    gridUrl: 'http://127.0.0.1:4444',
    viewerTokenTtlSeconds: 120,
    lanAccessEnabled: false,
    trustProxy: false,
    sessionSecret: 'integration-session-secret-min-32-chars-xxxx',
    viewerSecret: 'integration-viewer-secret-min-32-chars-xxxx',
    adminInitialPassword: 'integration-admin-password-12',
    dbPath,
    artifactsDir: path.join(tmp, 'artifacts'),
    logsDir: path.join(tmp, 'logs'),
    catalogYamlPath: path.join(tmp, 'browser-catalog.yaml')
  };
}

const config = makeConfig();
// 先初始化 DB（含迁移）再注册路由：路由内部复用 getDb 单例。
getDb(config);

const auth = {
  getUserFromToken(token: string) {
    if (token === 'admin-token') return { username: 'admin', role: 'admin' };
    if (token) return { username: 'tester', role: 'tester' };
    return null;
  }
};

const app = Fastify();
await app.register(fastifyCookie);
registerDeviceRoutes(app, auth, new DeviceRegistryService(config));
await app.ready();

after(async () => {
  await app.close();
});

test('集成：登记 profile → 注册节点 → 心跳上报 → 目录可见 → 撤销', async () => {
  // 1. 登记已安装可用 profile（admin）
  const profile = {
    id: 'avd-pixel7-api34',
    platform: 'android',
    kind: 'android-emulator',
    displayName: 'Pixel 7 API 34',
    osVersion: '14',
    apiLevel: 34,
    capabilities: { touch: true, rotate: true, screenshot: true, installApp: true, automation: true }
  };
  const regProfile = await app.inject({
    method: 'POST',
    url: '/api/v1/device-profiles',
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
    payload: profile
  });
  assert.strictEqual(regProfile.statusCode, 201);

  // 2. 目录可见登记的 profile
  const profiles = await app.inject({
    method: 'GET',
    url: '/api/v1/device-profiles',
    headers: { authorization: 'Bearer admin-token' }
  });
  assert.strictEqual(profiles.statusCode, 200);
  const profBody = profiles.json() as any;
  assert.ok(profBody.data.profiles.some((p: any) => p.id === 'avd-pixel7-api34'));

  // 3. 注册节点（admin）一次性获得 64-hex 凭据
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/device-nodes/register',
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
    payload: { nodeId: 'win-agent-01' }
  });
  assert.strictEqual(reg.statusCode, 201);
  const credential = (reg.json() as any).data.credential;
  assert.match(credential, /^[a-f0-9]{64}$/);

  // 4. 心跳上报（携带 Bearer 64-hex 凭据 + 设备清单）
  const hb = await app.inject({
    method: 'POST',
    url: '/api/v1/device-nodes/win-agent-01/heartbeat',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    payload: {
      platform: 'windows',
      uptimeSeconds: 120,
      managedEmulatorCount: 1,
      startedAt: new Date().toISOString(),
      devices: [{ id: 'emulator-5554', kind: 'android-emulator', state: 'device', booted: true }]
    }
  });
  assert.strictEqual(hb.statusCode, 200);

  // 5. 设备目录可见上报的设备（含 availability/leased 计算）
  const devices = await app.inject({
    method: 'GET',
    url: '/api/v1/devices',
    headers: { authorization: 'Bearer admin-token' }
  });
  assert.strictEqual(devices.statusCode, 200);
  const devBody = devices.json() as any;
  const dev = devBody.data.devices.find((d: any) => d.deviceId === 'emulator-5554');
  assert.ok(dev, '心跳上报的设备应出现在设备目录');
  assert.strictEqual(dev.online, true);
  assert.strictEqual(dev.booted, true);

  // 6. 节点列表可见且在线
  const nodes = await app.inject({
    method: 'GET',
    url: '/api/v1/device-nodes',
    headers: { authorization: 'Bearer admin-token' }
  });
  assert.strictEqual(nodes.statusCode, 200);
  const nodeArr = (nodes.json() as any).data.nodes;
  assert.ok(nodeArr.some((n: any) => n.nodeId === 'win-agent-01' && n.online));

  // 7. 撤销节点（admin）
  const revoke = await app.inject({
    method: 'POST',
    url: '/api/v1/device-nodes/win-agent-01/revoke',
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
    payload: {}
  });
  assert.strictEqual(revoke.statusCode, 200);
  assert.strictEqual((revoke.json() as any).data.revoked, true);

  // 8. 撤销后节点标记 revoked（凭证失效）
  const nodes2 = await app.inject({
    method: 'GET',
    url: '/api/v1/device-nodes',
    headers: { authorization: 'Bearer admin-token' }
  });
  const revoked = ((nodes2.json() as any).data.nodes as any[]).find((n: any) => n.nodeId === 'win-agent-01');
  assert.ok(revoked && revoked.revoked);

  // 9. 撤销后旧凭据心跳应 401
  const hbAfter = await app.inject({
    method: 'POST',
    url: '/api/v1/device-nodes/win-agent-01/heartbeat',
    headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
    payload: { platform: 'windows', uptimeSeconds: 200, managedEmulatorCount: 1, devices: [] }
  });
  assert.strictEqual(hbAfter.statusCode, 401);
});

test('集成：未授权访问被拒绝（401/403）', async () => {
  const noAuth = await app.inject({ method: 'GET', url: '/api/v1/device-profiles' });
  assert.strictEqual(noAuth.statusCode, 401);

  const nonAdmin = await app.inject({
    method: 'POST',
    url: '/api/v1/device-profiles',
    headers: { authorization: 'Bearer some-tester-token', 'content-type': 'application/json' },
    payload: { id: 'x', platform: 'android', kind: 'android-emulator', displayName: 'x', osVersion: '14' }
  });
  assert.strictEqual(nonAdmin.statusCode, 403);

  // 非法 nodeId 注册
  const badId = await app.inject({
    method: 'POST',
    url: '/api/v1/device-nodes/register',
    headers: { authorization: 'Bearer admin-token', 'content-type': 'application/json' },
    payload: { nodeId: '../evil' }
  });
  assert.strictEqual(badId.statusCode, 400);
});
