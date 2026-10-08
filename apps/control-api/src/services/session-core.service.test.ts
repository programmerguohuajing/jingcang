import assert from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SessionCoreService } from './session-core.service.js';
import { runMigrations } from '../db/migrations.js';
import type { Config } from '../config.js';

const dummyConfig = {
  rootDir: '/tmp',
  sessionDefaultMinutes: 60,
  sessionMaxMinutes: 120
} as unknown as Config;

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

test('createSession 占用独占租约并进入 ALLOCATING', () => {
  const db = freshDb();
  const core = new SessionCoreService(dummyConfig, db);
  const { id, leaseId } = core.createSession({
    userId: 'u1',
    deviceId: 'emulator-5580',
    nodeId: 'windows-local-dev',
    mode: 'phone'
  });
  const row = core.getSession(id);
  assert.strictEqual(row.status, 'ALLOCATING');
  assert.strictEqual(row.lease_id, leaseId);

  const lease = db.prepare('SELECT * FROM device_leases WHERE lease_id = ?').get(leaseId) as any;
  assert.ok(lease && lease.released_at === null);
});

test('同一设备并发会话被独占租约拒绝（DEVICE_BUSY）', () => {
  const db = freshDb();
  const core = new SessionCoreService(dummyConfig, db);
  core.createSession({ userId: 'u1', deviceId: 'emulator-5580', nodeId: 'windows-local-dev', mode: 'phone' });
  assert.throws(
    () =>
      core.createSession({ userId: 'u2', deviceId: 'emulator-5580', nodeId: 'windows-local-dev', mode: 'browser' }),
    (e: any) => e.code === 'DEVICE_BUSY'
  );
});

test('状态机 ALLOCATING → BOOTING → READY → TERMINATED 并释放租约', () => {
  const db = freshDb();
  const core = new SessionCoreService(dummyConfig, db);
  const { id } = core.createSession({
    userId: 'u1',
    deviceId: 'emulator-5580',
    nodeId: 'windows-local-dev',
    mode: 'phone'
  });
  core.markBooting(id);
  assert.strictEqual(core.getSession(id).status, 'BOOTING');
  core.markReady(id);
  assert.strictEqual(core.getSession(id).status, 'READY');
  assert.strictEqual(core.isLeaseActive(id, 'windows-local-dev', 'emulator-5580', 'u1'), true);
  assert.strictEqual(core.isLeaseActive(id, 'windows-local-dev', 'emulator-5580', 'u2'), false);
  assert.strictEqual(core.isLeaseActive(id, 'other-node', 'emulator-5580', 'u1'), false);

  core.terminate(id);
  assert.strictEqual(core.getSession(id).status, 'TERMINATED');
  assert.strictEqual(core.isLeaseActive(id, 'windows-local-dev', 'emulator-5580', 'u1'), false);
  const lease = db.prepare('SELECT released_at FROM device_leases WHERE session_id = ?').get(id) as any;
  assert.ok(lease.released_at);
});

test('非法状态转移被拒绝', () => {
  const db = freshDb();
  const core = new SessionCoreService(dummyConfig, db);
  const { id } = core.createSession({
    userId: 'u1',
    deviceId: 'emulator-5580',
    nodeId: 'windows-local-dev',
    mode: 'phone'
  });
  assert.throws(() => core.markReady(id), (e: any) => e.code === 'INVALID_STATE_TRANSITION');
});

test('expireIdleSessions 回收空闲 READY 会话并释放租约', () => {
  const db = freshDb();
  const core = new SessionCoreService(dummyConfig, db);
  const { id } = core.createSession({
    userId: 'u1',
    deviceId: 'emulator-5580',
    nodeId: 'windows-local-dev',
    mode: 'phone'
  });
  core.markBooting(id);
  core.markReady(id);
  // 回拨 updated_at 使其"空闲"
  db.prepare("UPDATE mobile_sessions SET updated_at = ? WHERE id = ?").run(
    new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    id
  );
  const expired = core.expireIdleSessions(2 * 60 * 60 * 1000);
  assert.strictEqual(expired, 1);
  assert.strictEqual(core.getSession(id).status, 'EXPIRED');
});

test('recoverLostLeases 回收失联节点的活动会话', () => {
  const db = freshDb();
  const core = new SessionCoreService(dummyConfig, db);
  const { id } = core.createSession({
    userId: 'u1',
    deviceId: 'emulator-5580',
    nodeId: 'node-A',
    mode: 'phone'
  });
  core.markBooting(id);
  core.markReady(id);
  const recovered = core.recoverLostLeases(new Set(['node-A']));
  assert.strictEqual(recovered, 1);
  assert.strictEqual(core.getSession(id).status, 'LOST');
});
