import assert from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { DeviceRegistryService } from './device-registry.service.js';
import { runMigrations } from '../db/migrations.js';
import type { Config } from '../config.js';
import { DeviceProfileSchema } from '@jingcang/device-contracts';

const cfg = { rootDir: '/tmp' } as unknown as Config;

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

test('registerProfile + listProfiles 只展示已登记可用镜像', () => {
  const db = freshDb();
  const reg = new DeviceRegistryService(cfg, db);
  const profile = DeviceProfileSchema.parse({
    id: 'JingCang_Test_API34_x86_64',
    platform: 'android',
    kind: 'android-emulator',
    displayName: 'Pixel 7 API 34',
    osVersion: '14',
    apiLevel: 34,
    managed: true
  });
  reg.registerProfile(profile);
  const profiles = reg.listProfiles();
  assert.strictEqual(profiles.length, 1);
  assert.strictEqual(profiles[0].id, 'JingCang_Test_API34_x86_64');
  assert.strictEqual(profiles[0].apiLevel, 34);
});

test('upsertNode + upsertDevices + listDevices 反映可用性与租约', () => {
  const db = freshDb();
  const reg = new DeviceRegistryService(cfg, db);
  reg.upsertNode({
    nodeId: 'node-1',
    platform: 'windows',
    startedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    uptimeSeconds: 10,
    managedCount: 1
  });
  reg.upsertDevices('node-1', [
    { deviceId: 'emulator-5580', platform: 'android', kind: 'android-emulator', state: 'device', booted: true }
  ]);
  let devices = reg.listDevices();
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].available, true);
  assert.strictEqual(devices[0].leased, false);

  // 占用租约后该设备不可用
  db.prepare(`INSERT INTO device_leases(lease_id,node_id,device_id,session_id,user_id,mode,acquired_at,expires_at,released_at)
    VALUES('lease-x','node-1','emulator-5580','s-x','u1','phone',?,?,'NULL')`)
    .run(new Date().toISOString(), new Date().toISOString());
  // released_at 必须为空字符串而非 'NULL' 文本
  db.prepare("UPDATE device_leases SET released_at = NULL WHERE lease_id='lease-x'").run();
  devices = reg.listDevices();
  assert.strictEqual(devices[0].available, false);
  assert.strictEqual(devices[0].leased, true);

  const nodes = reg.listNodes();
  assert.strictEqual(nodes.length, 1);
  assert.strictEqual(nodes[0].nodeId, 'node-1');
});
