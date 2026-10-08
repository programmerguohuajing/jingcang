import assert from 'node:assert';
import { test } from 'node:test';
import { EmulatorProvider } from './android.js';
import type { AndroidProvider, DeviceInventory } from './android.js';
import type { DeviceAction } from '@jingcang/device-contracts';
import { DeviceActionSchema } from '@jingcang/device-contracts';

/** 实现 AndroidProvider 接口的桩，验证契约完整性（所有方法可调用）。 */
class FakeProvider implements AndroidProvider {
  platform = 'android' as const;
  async listDevices(): Promise<DeviceInventory[]> {
    return [];
  }
  async getCapabilities() {
    return {};
  }
  async listSystemImages() {
    return { images: [] };
  }
  async listProfiles() {
    return [];
  }
  async createProfile(_apiLevel: number) {
    return { id: 'p' };
  }
  async deleteProfile(_id: string) {}
  async startProfile(_id: string) {}
  async stopProfile(_id: string) {}
  async provision(_deviceId: string, _mode: 'phone' | 'browser') {}
  async installApp(_deviceId: string, _base64: string) {
    return { packageName: 'x' };
  }
  async capture(_deviceId: string) {
    return Buffer.from('png');
  }
  async execute(_deviceId: string, _action: DeviceAction) {
    return { ok: true };
  }
  async runAutomation(_deviceId: string) {
    return {};
  }
  async startVideoStream(_deviceId: string) {
    return null;
  }
  async health() {
    return { nodeId: 'n', platform: 'android' as const, startedAt: new Date().toISOString(), uptimeSeconds: 1, managedEmulatorCount: 0 };
  }
}

test('AndroidProvider 契约方法齐全且可调用', async () => {
  const p = new FakeProvider();
  assert.strictEqual(p.platform, 'android');
  await p.listDevices();
  await p.getCapabilities();
  await p.listSystemImages();
  await p.listProfiles();
  await p.createProfile(34);
  await p.deleteProfile('x');
  await p.startProfile('x');
  await p.stopProfile('x');
  await p.provision('d', 'phone');
  await p.installApp('d', 'AAA');
  await p.capture('d');
  await p.execute('d', DeviceActionSchema.parse({ type: 'home' }));
  await p.runAutomation('d');
  assert.strictEqual(await p.startVideoStream('d'), null);
  const h = await p.health();
  assert.strictEqual(h.nodeId, 'n');
});

test('EmulatorProvider.getCapabilities 返回默认能力（无需 SDK）', async () => {
  const p = new EmulatorProvider('node-1');
  const caps = await p.getCapabilities();
  assert.strictEqual(caps.touch, true);
  assert.strictEqual(caps.rotate, true);
  assert.strictEqual(caps.maxConcurrentSessions, 1);
});

test('EmulatorProvider.listSystemImages 在无 SDK 时返回空（不抛）', async () => {
  const p = new EmulatorProvider('node-1', { sdkRoot: '/nonexistent-sdk' });
  const r = await p.listSystemImages();
  assert.deepStrictEqual(r.images, []);
});

test('EmulatorProvider.listDevices 在缺 ADB 环境安全降级（返回数组或带 code 的错误）', async () => {
  const p = new EmulatorProvider('node-1');
  const r = await p.listDevices().catch((e) => e);
  if (Array.isArray(r)) {
    assert.ok(Array.isArray(r));
  } else {
    assert.strictEqual(typeof (r as any).code, 'string');
  }
});

test('EmulatorProvider.startVideoStream 在无 scrcpy 时回退为 null', async () => {
  const p = new EmulatorProvider('node-1');
  assert.strictEqual(await p.startVideoStream('emulator-5580'), null);
});
