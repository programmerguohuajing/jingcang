import assert from 'node:assert';
import { test } from 'node:test';
import { AgentController, type ControlApiTransport } from './controller.js';
import type { AndroidProvider, DeviceInventory } from './provider/android.js';
import type { NodeHeartbeat } from '@jingcang/device-contracts';

const fakeProvider: AndroidProvider = {
  platform: 'android',
  async listDevices(): Promise<DeviceInventory[]> {
    return [{ id: 'emulator-5580', kind: 'android-emulator', state: 'device', booted: true }];
  },
  async getCapabilities() {
    return { touch: true, rotate: true, screenshot: true, record: false, installApp: false, automation: false, camera: false, gps: false, maxConcurrentSessions: 1 };
  },
  async listSystemImages() {
    return { images: [] };
  },
  async listProfiles() {
    return [];
  },
  async createProfile() {
    return { id: 'x' };
  },
  async deleteProfile() {},
  async startProfile() {},
  async stopProfile() {},
  async provision() {},
  async installApp() {
    return { packageName: 'com.test' };
  },
  async capture() {
    return Buffer.from([]);
  },
  async execute() {
    return { ok: true };
  },
  async runAutomation() {
    return {};
  },
  async startVideoStream() {
    return null;
  },
  async health() {
    return { nodeId: 'node-1', platform: 'android', startedAt: new Date().toISOString(), uptimeSeconds: 5, managedEmulatorCount: 1 };
  }
};

function makeTransport(opts: { enrollReturns?: string[]; heartbeatStatus?: number[] } = {}) {
  const validCred = (s: string) => (s + 'a'.repeat(64)).slice(0, 64);
  const enrollQueue = (opts.enrollReturns ?? ['c1', 'c2']).map(validCred);
  let enrollIdx = 0;
  const heartbeatStatuses = opts.heartbeatStatus ?? [200];
  let hbIdx = 0;
  const calls: Array<{ nodeId: string; token: string; status: number }> = [];
  const transport: ControlApiTransport = {
    async enroll(nodeId) {
      return { credential: enrollQueue[enrollIdx++] ?? 'cN' };
    },
    async heartbeat(nodeId, token, _payload: NodeHeartbeat) {
      const status = heartbeatStatuses[hbIdx++] ?? 200;
      calls.push({ nodeId, token, status });
      return { status };
    }
  };
  return { transport, calls: () => calls };
}

test('首次 tick 完成注册 + 心跳并上报设备清单', async () => {
  const { transport, calls } = makeTransport();
  const ctrl = new AgentController({ nodeId: 'node-1', transport, provider: fakeProvider });
  const r = await ctrl.tick();
  assert.strictEqual(r, 'ok');
  const c = calls();
  assert.strictEqual(c.length, 1);
  assert.match(c[0].token, /^[a-f0-9]{64}$/);
  assert.strictEqual(c[0].status, 200);
  assert.strictEqual(c[0].nodeId, 'node-1');
});

test('心跳 401 触发凭据失效并在下一轮重新注册', async () => {
  const { transport, calls } = makeTransport({ heartbeatStatus: [401, 200] });
  const ctrl = new AgentController({ nodeId: 'node-1', transport, provider: fakeProvider });
  const r1 = await ctrl.tick();
  assert.strictEqual(r1, 'retrying');
  assert.strictEqual(ctrl.currentToken, undefined); // 凭据已清空
  const r2 = await ctrl.tick();
  assert.strictEqual(r2, 'ok');
  const c = calls();
  assert.strictEqual(c.length, 2);
  assert.match(c[0].token, /^[a-f0-9]{64}$/);
  assert.match(c[1].token, /^[a-f0-9]{64}$/); // 重新注册
});

test('网络异常采用退避且不中断', async () => {
  const failing: ControlApiTransport = {
    async enroll() {
      return { credential: 'c1' };
    },
    async heartbeat() {
      throw new Error('network down');
    }
  };
  const ctrl = new AgentController({ nodeId: 'node-1', transport: failing, provider: fakeProvider, baseBackoffMs: 1000, maxBackoffMs: 8000 });
  const r = await ctrl.tick();
  assert.strictEqual(r, 'retrying');
  assert.strictEqual(ctrl.currentBackoffMs, 2000); // 指数退避
  await ctrl.tick();
  assert.strictEqual(ctrl.currentBackoffMs, 4000);
});

test('外部注入 token 时跳过注册', async () => {
  const { transport, calls } = makeTransport();
  const ctrl = new AgentController({ nodeId: 'node-1', transport, provider: fakeProvider, token: 'preset-token' });
  await ctrl.tick();
  const c = calls();
  assert.strictEqual(c[0].token, 'preset-token');
});
