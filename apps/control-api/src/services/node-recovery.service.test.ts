import assert from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SessionCoreService } from './session-core.service.js';
import { NodeRouterService } from './node-router.service.js';
import { NodeRecoveryService } from './node-recovery.service.js';
import { runMigrations } from '../db/migrations.js';
import type { Config } from '../config.js';

const cfg = {
  rootDir: '/tmp',
  viewerSecret: 'test-viewer-secret-key-32chars-xxxx',
  sessionDefaultMinutes: 60,
  sessionMaxMinutes: 120
} as unknown as Config;

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

function markStale(db: DatabaseSync, nodeId: string, agoMs = 120000): void {
  db.prepare('UPDATE mobile_agent_nodes SET last_seen_at = ? WHERE node_id = ?').run(
    new Date(Date.now() - agoMs).toISOString(),
    nodeId
  );
}

test('失联确认后回收活动租约并标记 OFFLINE（安全释放）', async () => {
  const db = freshDb();
  const core = new SessionCoreService(cfg, db);
  const router = new NodeRouterService(cfg, db, 45000);
  const recovery = new NodeRecoveryService(cfg, core, router, 20000, db);

  // 节点 node-A 已登记端点、心跳超时（候选失联）
  router.upsertEndpoint('node-A', 'http://127.0.0.1:19921', router.encryptSecret('a'.repeat(64)));
  markStale(db, 'node-A');

  // node-A 上有一个 READY 会话占用租约
  const { id } = core.createSession({ userId: 'u1', deviceId: 'emulator-5580', nodeId: 'node-A', mode: 'phone' });
  core.markBooting(id);
  core.markReady(id);
  assert.strictEqual(core.getSession(id).status, 'READY');

  // 主动探测确认不可达（注入探测结果，模拟真实失败）
  const result = await recovery.sweep(new Map([['node-A', false]]));
  assert.deepStrictEqual(result.candidates, ['node-A']);
  assert.deepStrictEqual(result.confirmedLost, ['node-A']);
  assert.strictEqual(result.recoveredLeases, 1);
  assert.strictEqual(core.getSession(id).status, 'LOST');
  // 租约已释放
  const lease = db.prepare('SELECT released_at FROM device_leases WHERE session_id = ?').get(id) as any;
  assert.ok(lease.released_at);
  // DeviceRegistry 侧标记 OFFLINE
  const node = db.prepare('SELECT status FROM device_nodes WHERE node_id = ?').get('node-A') as any;
  assert.strictEqual(node.status, 'OFFLINE');
});

test('探测可达的候选节点不会被误杀（恢复确认保护）', async () => {
  const db = freshDb();
  const core = new SessionCoreService(cfg, db);
  const router = new NodeRouterService(cfg, db, 45000);
  const recovery = new NodeRecoveryService(cfg, core, router, 20000, db);

  router.upsertEndpoint('node-B', 'http://127.0.0.1:19922', router.encryptSecret('b'.repeat(64)));
  markStale(db, 'node-B');
  const { id } = core.createSession({ userId: 'u1', deviceId: 'emulator-5581', nodeId: 'node-B', mode: 'browser' });
  core.markBooting(id);
  core.markReady(id);

  // 探测可达（网络抖动但 Agent 实际在线）→ 不释放
  const result = await recovery.sweep(new Map([['node-B', true]]));
  assert.deepStrictEqual(result.confirmedLost, []);
  assert.strictEqual(result.recoveredLeases, 0);
  assert.strictEqual(core.getSession(id).status, 'READY');
  const node = db.prepare('SELECT status FROM device_nodes WHERE node_id = ?').get('node-B') as any;
  assert.ok(node && node.status !== 'OFFLINE');
});

test('凭证撤销的节点视为失联并被安全释放', async () => {
  const db = freshDb();
  const core = new SessionCoreService(cfg, db);
  const router = new NodeRouterService(cfg, db, 45000);
  const recovery = new NodeRecoveryService(cfg, core, router, 20000, db);

  router.upsertEndpoint('node-C', 'http://127.0.0.1:19923', router.encryptSecret('c'.repeat(64)));
  db.prepare('INSERT INTO mobile_node_credentials(node_id, token_hash, created_at, revoked_at) VALUES(?,?,?,?)').run(
    'node-C',
    '0'.repeat(64),
    new Date().toISOString(),
    new Date().toISOString()
  );
  const { id } = core.createSession({ userId: 'u1', deviceId: 'R58M1234567', nodeId: 'node-C', mode: 'phone' });
  core.markBooting(id);
  core.markReady(id);

  const result = await recovery.sweep(new Map([['node-C', false]]));
  assert.deepStrictEqual(result.confirmedLost, ['node-C']);
  assert.strictEqual(core.getSession(id).status, 'LOST');
});

test('设备级断线回收：节点在线但真机从清单消失', () => {
  const db = freshDb();
  const core = new SessionCoreService(cfg, db);
  const { id } = core.createSession({ userId: 'u1', deviceId: 'R58M1234567', nodeId: 'windows-local-dev', mode: 'phone' });
  core.markBooting(id);
  core.markReady(id);
  assert.strictEqual(core.hasActiveSessionOnDevice('windows-local-dev', 'R58M1234567'), true);
  const recovered = core.recoverDeviceLease('windows-local-dev', 'R58M1234567', 'USB 真机断开');
  assert.strictEqual(recovered, true);
  assert.strictEqual(core.getSession(id).status, 'LOST');
  assert.strictEqual(core.hasActiveSessionOnDevice('windows-local-dev', 'R58M1234567'), false);
  const row = core.getSession(id);
  assert.strictEqual(row.failure_code, 'DEVICE_OFFLINE');
});

test('无活动会话的设备回收返回 false 且不产生异常', () => {
  const db = freshDb();
  const core = new SessionCoreService(cfg, db);
  assert.strictEqual(core.recoverDeviceLease('windows-local-dev', 'ghost-device'), false);
});