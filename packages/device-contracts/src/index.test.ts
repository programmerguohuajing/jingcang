import assert from 'node:assert';
import { test } from 'node:test';
import {
  CreateDeviceSessionRequestSchema,
  DeviceProfileSchema,
  DeviceNodeSchema,
  NodeHeartbeatSchema,
  ViewerTokenClaimsSchema,
  EnrollNodeRequestSchema,
  DEVICE_SESSION_STATUSES,
  SESSION_MODES
} from './index.js';

test('CreateDeviceSessionRequestSchema 默认模式与校验', () => {
  const ok = CreateDeviceSessionRequestSchema.safeParse({
    deviceId: 'emulator-5580',
    mode: 'phone'
  });
  assert.strictEqual(ok.success, true);
  if (ok.success) {
    assert.strictEqual(ok.data.durationMinutes, 60);
  }

  const badMode = CreateDeviceSessionRequestSchema.safeParse({
    deviceId: 'emulator-5580',
    mode: 'desktop'
  });
  assert.strictEqual(badMode.success, false);

  const badDevice = CreateDeviceSessionRequestSchema.safeParse({
    deviceId: '../escape',
    mode: 'phone'
  });
  assert.strictEqual(badDevice.success, false);
});

test('移动浏览器会话要求合法 http/https 起始 URL', () => {
  const ok = CreateDeviceSessionRequestSchema.safeParse({
    deviceId: 'emulator-5580',
    mode: 'browser',
    startUrl: 'https://example.com'
  });
  assert.strictEqual(ok.success, true);

  const bad = CreateDeviceSessionRequestSchema.safeParse({
    deviceId: 'emulator-5580',
    mode: 'browser',
    startUrl: 'file:///etc/passwd'
  });
  assert.strictEqual(bad.success, false);
});

test('DeviceProfileSchema 默认能力与字段', () => {
  const parsed = DeviceProfileSchema.safeParse({
    id: 'JingCang_Test_API34_x86_64',
    platform: 'android',
    kind: 'android-emulator',
    displayName: 'Pixel 7 API 34',
    osVersion: '14',
    apiLevel: 34,
    managed: true
  });
  assert.strictEqual(parsed.success, true);
  if (parsed.success) {
    assert.strictEqual(parsed.data.capabilities.touch, true);
    assert.strictEqual(parsed.data.capabilities.maxConcurrentSessions, 1);
  }
});

test('DeviceNodeSchema 拒绝非法平台', () => {
  assert.strictEqual(
    DeviceNodeSchema.safeParse({
      nodeId: 'node-1',
      platform: 'freebsd',
      startedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      uptimeSeconds: 0,
      managedCount: 0
    }).success,
    false
  );
});

test('NodeHeartbeatSchema 设备清单去重与边界', () => {
  const ok = NodeHeartbeatSchema.safeParse({
    platform: 'windows',
    uptimeSeconds: 10,
    managedEmulatorCount: 1,
    devices: [{ id: 'emulator-5580', kind: 'android-emulator', state: 'device', booted: true }]
  });
  assert.strictEqual(ok.success, true);

  const tooMany = NodeHeartbeatSchema.safeParse({
    platform: 'windows',
    uptimeSeconds: 10,
    managedEmulatorCount: 1,
    devices: Array.from({ length: 101 }, (_, i) => ({
      id: 'd' + i,
      kind: 'android-emulator',
      state: 'device',
      booted: true
    }))
  });
  assert.strictEqual(tooMany.success, false);

  const badKind = NodeHeartbeatSchema.safeParse({
    platform: 'windows',
    uptimeSeconds: 10,
    managedEmulatorCount: 1,
    devices: [{ id: 'x', kind: 'iphone', state: 'device', booted: true }]
  });
  assert.strictEqual(badKind.success, false);
});

test('EnrollNodeRequestSchema 拒绝保留 ID', () => {
  assert.strictEqual(
    EnrollNodeRequestSchema.safeParse({ nodeId: 'windows-local-dev' }).success,
    false
  );
  assert.strictEqual(
    EnrollNodeRequestSchema.safeParse({ nodeId: 'node-2' }).success,
    true
  );
});

test('ViewerTokenClaimsSchema 必须包含四元组绑定', () => {
  const ok = ViewerTokenClaimsSchema.safeParse({
    sub: 'u1',
    sid: 's1',
    did: 'd1',
    lid: 'l1',
    node: 'n1',
    mode: 'phone',
    iat: 1,
    exp: 2
  });
  assert.strictEqual(ok.success, true);

  const missing = ViewerTokenClaimsSchema.safeParse({
    sub: 'u1',
    sid: 's1',
    iat: 1,
    exp: 2
  });
  assert.strictEqual(missing.success, false);
});

test('SESSION_MODES 与 DEVICE_SESSION_STATUSES 完整性', () => {
  assert.deepStrictEqual([...SESSION_MODES].sort(), ['browser', 'phone']);
  for (const s of ['QUEUED', 'ALLOCATING', 'BOOTING', 'READY', 'TERMINATING', 'TERMINATED', 'FAILED', 'EXPIRED', 'LOST']) {
    assert.ok(DEVICE_SESSION_STATUSES.includes(s as any));
  }
});
