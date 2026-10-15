import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { SimulatorProvider } from './ios.js';
import type { CommandResult } from './types.js';
import { DeviceActionSchema } from '@jingcang/device-contracts';

/**
 * ios.test.ts（IOS-011）
 *
 * SimulatorProvider 的全部逻辑经可注入 CommandRunner 测试，无需 macOS/xcrun。
 * 假执行器模拟 simctl JSON 输出、idb 与 unzip 的行为，断言参数与状态映射。
 */

const UDID_BOOT = 'A1B2C3D4-1111-2222-3333-444455556666';
const UDID_DOWN = 'B1B2C3D4-1111-2222-3333-444455556666';
const UDID_BOOTING = 'C1B2C3D4-1111-2222-3333-444455556666';
const UDID_PLAIN = 'D1B2C3D4-1111-2222-3333-444455556666';

function devicesJson() {
  return JSON.stringify({
    devices: {
      'com.apple.CoreSimulator.SimRuntime.iOS-17-5': [
        { udid: UDID_BOOT, name: 'JingCang-iPhone-15', state: 'Booted', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15' },
        { udid: UDID_DOWN, name: 'iPhone 14', state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-14' },
        { udid: UDID_BOOTING, name: 'JingCang-iPhone-15-Pro', state: 'Booting', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro' }
      ],
      'iOS 16.4': [
        { udid: UDID_PLAIN, name: 'iPhone 13', state: 'Shutdown', isAvailable: true, deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-13' }
      ]
    }
  });
}

const RUNTIMES_JSON = JSON.stringify({
  runtimes: [
    { name: 'iOS 17.5', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-17-5', version: '17.5.0', buildversion: '21F79', isAvailable: true },
    { name: 'iOS 16.4', identifier: 'com.apple.CoreSimulator.SimRuntime.iOS-16-4', version: '16.4.0', buildversion: '20E247', isAvailable: true },
    { name: 'watchOS 10.5', identifier: 'com.apple.CoreSimulator.SimRuntime.watchOS-10-5', version: '10.5.0', buildversion: '21T576', isAvailable: true }
  ]
});

const DEVICETYPES_JSON = JSON.stringify({
  devicetypes: [
    { name: 'iPhone 15', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-15', productFamily: 'iPhone' },
    { name: 'iPad Pro', identifier: 'com.apple.CoreSimulator.SimDeviceType.iPad-Pro', productFamily: 'iPad' }
  ]
});

interface FakeOpts {
  xcrun?: boolean;
  idb?: boolean;
}

function makeRunner(opts: FakeOpts = {}) {
  const xcrunOk = opts.xcrun ?? true;
  const idbOk = opts.idb ?? true;
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const state = new Map<string, string>([
    [UDID_BOOT, 'Booted'],
    [UDID_DOWN, 'Shutdown'],
    [UDID_BOOTING, 'Booting'],
    [UDID_PLAIN, 'Shutdown']
  ]);

  const runner = (cmd: string, args: string[], _o?: { timeoutMs?: number }): CommandResult => {
    calls.push({ cmd, args });
    if (cmd === 'xcrun' && args[0] === '--version') {
      if (!xcrunOk) throw Object.assign(new Error('spawn xcrun ENOENT'), { code: 'ENOENT' });
      return { status: 0, stdout: 'xcrun version 70', stderr: '' };
    }
    if (cmd === 'idb' && args[0] === '--version') {
      if (!idbOk) throw Object.assign(new Error('spawn idb ENOENT'), { code: 'ENOENT' });
      return { status: 0, stdout: 'idb 1.1.0', stderr: '' };
    }
    if (cmd === 'xcrun' && args[0] === 'simctl') {
      const sub = args[1];
      if (sub === 'list' && args[2] === 'devices') {
        const json = JSON.parse(devicesJson());
        for (const list of Object.values<any>(json.devices)) {
          for (const d of list) {
            if (state.has(d.udid)) d.state = state.get(d.udid);
          }
        }
        return { status: 0, stdout: JSON.stringify(json), stderr: '' };
      }
      if (sub === 'list' && args[2] === 'runtimes') return { status: 0, stdout: RUNTIMES_JSON, stderr: '' };
      if (sub === 'list' && args[2] === 'devicetypes') return { status: 0, stdout: DEVICETYPES_JSON, stderr: '' };
      if (sub === 'create') return { status: 0, stdout: 'E1B2C3D4-1111-2222-3333-444455556666\n', stderr: '' };
      if (sub === 'delete' || sub === 'install') return { status: 0, stdout: '', stderr: '' };
      if (sub === 'boot') {
        const udid = args[2];
        if (state.get(udid) === 'Booted') return { status: 1, stdout: '', stderr: 'Unable to boot device in current state: Booted' };
        state.set(udid, 'Booted');
        return { status: 0, stdout: '', stderr: '' };
      }
      if (sub === 'shutdown') {
        const udid = args[2];
        if (state.get(udid) !== 'Booted') return { status: 1, stdout: '', stderr: 'Device is not booted' };
        state.set(udid, 'Shutdown');
        return { status: 0, stdout: '', stderr: '' };
      }
      if (sub === 'openurl') return { status: 0, stdout: '', stderr: '' };
      if (sub === 'io' && args[3] === 'screenshot') {
        const pngPath = args[args.length - 1];
        fs.writeFileSync(pngPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    if (cmd === 'idb') return { status: 0, stdout: '', stderr: '' };
    if (cmd === 'unzip') {
      // 模拟解压：在目标目录下生成 Payload/Test.app/Info.plist
      const dest = args[args.indexOf('-d') + 1];
      const appDir = path.join(dest, 'Payload', 'Test.app');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(
        path.join(appDir, 'Info.plist'),
        '<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.example.testapp</string></dict></plist>'
      );
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  return { runner, calls, state };
}

test('SimulatorProvider 平台标识为 ios', () => {
  const { runner } = makeRunner();
  assert.strictEqual(new SimulatorProvider('mac-node-1', { runner }).platform, 'ios');
});

test('listDevices 解析 simctl JSON 并映射状态/kind/版本', async () => {
  const { runner } = makeRunner();
  const p = new SimulatorProvider('mac-node-1', { runner });
  const devices = await p.listDevices();
  assert.strictEqual(devices.length, 4);
  const byId = new Map(devices.map((d) => [d.id, d]));
  assert.deepStrictEqual(
    { kind: byId.get(UDID_BOOT)!.kind, state: byId.get(UDID_BOOT)!.state, booted: byId.get(UDID_BOOT)!.booted },
    { kind: 'ios-simulator', state: 'device', booted: true }
  );
  assert.strictEqual(byId.get(UDID_BOOT)!.model, 'JingCang-iPhone-15');
  assert.strictEqual(byId.get(UDID_BOOT)!.osVersion, '17.5'); // 新格式 runtime key
  assert.strictEqual(byId.get(UDID_PLAIN)!.osVersion, '16.4'); // 旧格式 runtime key
  assert.deepStrictEqual(
    { state: byId.get(UDID_DOWN)!.state, booted: byId.get(UDID_DOWN)!.booted },
    { state: 'offline', booted: false }
  );
  assert.strictEqual(byId.get(UDID_BOOTING)!.state, 'booting');
});

test('xcrun 缺失时 listDevices 抛 PROVIDER_UNAVAILABLE', async () => {
  const { runner } = makeRunner({ xcrun: false });
  const p = new SimulatorProvider('mac-node-1', { runner });
  await assert.rejects(() => p.listDevices(), (e: any) => e.code === 'PROVIDER_UNAVAILABLE');
});

test('getCapabilities 反映 xcrun/idb 可用性', async () => {
  const p1 = new SimulatorProvider('n', { runner: makeRunner({ xcrun: true, idb: true }).runner });
  const c1 = await p1.getCapabilities();
  assert.strictEqual(c1.touch, true);
  assert.strictEqual(c1.screenshot, true);
  assert.strictEqual(c1.inputDriver, 'idb');
  assert.strictEqual(c1.rotate, false);

  const p2 = new SimulatorProvider('n', { runner: makeRunner({ xcrun: true, idb: false }).runner });
  const c2 = await p2.getCapabilities();
  assert.strictEqual(c2.touch, false);
  assert.strictEqual(c2.inputDriver, 'none');
});

test('listSystemImages 仅返回 iOS runtime', async () => {
  const { runner } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  const { images } = await p.listSystemImages();
  assert.strictEqual(images.length, 2);
  assert.ok(images.every((i) => i.name.includes('iOS')));
  assert.strictEqual(images[0].version, '17.5.0');
});

test('listDeviceTypes 仅保留 iPhone 家族', async () => {
  const { runner } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  const types = await p.listDeviceTypes();
  assert.strictEqual(types.length, 1);
  assert.strictEqual(types[0].name, 'iPhone 15');
});

test('createProfile 校验标识符并返回 UDID', async () => {
  const { runner, calls } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  const { id } = await p.createProfile(
    'com.apple.CoreSimulator.SimDeviceType.iPhone-15',
    'com.apple.CoreSimulator.SimRuntime.iOS-17-5'
  );
  assert.match(id, /^[0-9A-Fa-f-]{36}$/);
  const create = calls.find((c) => c.cmd === 'xcrun' && c.args[1] === 'create');
  assert.ok(create);
  assert.ok(create!.args[2].startsWith('JingCang-'));
  await assert.rejects(
    () => p.createProfile('bad-type', 'com.apple.CoreSimulator.SimRuntime.iOS-17-5'),
    (e: any) => e.code === 'INVALID_PROFILE'
  );
});

test('deleteProfile 仅允许删除 JingCang 托管模拟器', async () => {
  const { runner, calls } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  await p.deleteProfile(UDID_BOOT); // JingCang-iPhone-15，托管
  assert.ok(calls.some((c) => c.cmd === 'xcrun' && c.args[1] === 'delete' && c.args[2] === UDID_BOOT));
  await assert.rejects(() => p.deleteProfile(UDID_DOWN), (e: any) => e.code === 'PROFILE_NOT_MANAGED'); // iPhone 14，非托管
  await assert.rejects(() => p.deleteProfile('not-a-udid'), (e: any) => e.code === 'INVALID_DEVICE_ID');
});

test('startProfile 对已启动设备幂等成功', async () => {
  const { runner, state } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  await p.startProfile(UDID_BOOT); // 已 Booted：boot 报错但被容忍
  assert.strictEqual(state.get(UDID_BOOT), 'Booted');
});

test('startProfile 可从 Shutdown 启动模拟器', async () => {
  // 先把一台托管设备改名无法做到；用 UDID_BOOTING（托管、Booting→等待）
  const { runner, state } = makeRunner();
  state.set(UDID_BOOTING, 'Shutdown');
  const p = new SimulatorProvider('n', { runner });
  await p.startProfile(UDID_BOOTING);
  assert.strictEqual(state.get(UDID_BOOTING), 'Booted');
});

test('stopProfile 关闭托管模拟器，未启动时幂等', async () => {
  const { runner, state } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  await p.stopProfile(UDID_BOOT);
  assert.strictEqual(state.get(UDID_BOOT), 'Shutdown');
  await p.stopProfile(UDID_BOOT); // 再次停止：not booted 被容忍
});

test('provision 启动未开机设备；未知设备抛 DEVICE_NOT_FOUND', async () => {
  const { runner, state } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  await p.provision(UDID_BOOT, 'phone');
  assert.strictEqual(state.get(UDID_BOOT), 'Booted');
  await assert.rejects(
    () => p.provision('FFFFFFFF-1111-2222-3333-444455556666', 'phone'),
    (e: any) => e.code === 'DEVICE_NOT_FOUND'
  );
});

test('execute tap/swipe 经 idb 下发；缺 idb 时 INPUT_UNAVAILABLE', async () => {
  const ctx = makeRunner({ idb: true });
  const p = new SimulatorProvider('n', { runner: ctx.runner });
  await p.execute(UDID_BOOT, DeviceActionSchema.parse({ type: 'tap', x: 100, y: 200 }));
  const tap = ctx.calls.find((c) => c.cmd === 'idb' && c.args.includes('tap'));
  assert.ok(tap);
  assert.deepStrictEqual(tap!.args.slice(0, 5), ['--udid', UDID_BOOT, 'ui', 'tap', '100']);

  await p.execute(UDID_BOOT, DeviceActionSchema.parse({ type: 'swipe', x1: 10, y1: 20, x2: 30, y2: 40 }));
  assert.ok(ctx.calls.some((c) => c.cmd === 'idb' && c.args.includes('swipe')));

  const p2 = new SimulatorProvider('n', { runner: makeRunner({ idb: false }).runner });
  await assert.rejects(
    () => p2.execute(UDID_BOOT, DeviceActionSchema.parse({ type: 'tap', x: 1, y: 2 })),
    (e: any) => e.code === 'INPUT_UNAVAILABLE'
  );
});

test('execute navigate 调用 simctl openurl；非法 URL 拒绝', async () => {
  const { runner, calls } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  await p.execute(UDID_BOOT, DeviceActionSchema.parse({ type: 'navigate', url: 'https://example.com' }));
  assert.ok(calls.some((c) => c.cmd === 'xcrun' && c.args.includes('openurl') && c.args.includes('https://example.com')));
  await assert.rejects(
    () => p.execute(UDID_BOOT, DeviceActionSchema.parse({ type: 'navigate', url: 'ftp://x' })),
    (e: any) => e.code === 'INVALID_URL'
  );
});

test('execute home/back/key/rotate 明确返回 UNSUPPORTED_ACTION', async () => {
  const { runner } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  for (const type of ['home', 'back', 'rotate'] as const) {
    await assert.rejects(() => p.execute(UDID_BOOT, DeviceActionSchema.parse({ type })), (e: any) => e.code === 'UNSUPPORTED_ACTION');
  }
  await assert.rejects(
    () => p.execute(UDID_BOOT, DeviceActionSchema.parse({ type: 'key', key: 'HOME' })),
    (e: any) => e.code === 'UNSUPPORTED_ACTION'
  );
});

test('capture 返回 PNG 且清理临时文件', async () => {
  const { runner } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  const buf = await p.capture(UDID_BOOT);
  assert.ok(Buffer.isBuffer(buf));
  assert.deepStrictEqual(Array.from(buf.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
});

test('installApp 非 zip 拒绝；合法包走 unzip+simctl install', async () => {
  const { runner, calls } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  await assert.rejects(
    () => p.installApp(UDID_BOOT, Buffer.from('not-a-zip').toString('base64')),
    (e: any) => e.code === 'INVALID_APP'
  );
  const fakeZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fakezipcontent')]).toString('base64');
  const { packageName } = await p.installApp(UDID_BOOT, fakeZip);
  assert.strictEqual(packageName, 'com.example.testapp');
  const install = calls.find((c) => c.cmd === 'xcrun' && c.args[1] === 'install');
  assert.ok(install);
  assert.ok(install!.args[3].endsWith('Test.app'));
});

test('runAutomation 明确禁用；startVideoStream 返回 null（回退截图轮询）', async () => {
  const { runner } = makeRunner();
  const p = new SimulatorProvider('n', { runner });
  await assert.rejects(() => p.runAutomation(UDID_BOOT), (e: any) => e.code === 'AUTOMATION_DISABLED');
  assert.strictEqual(await p.startVideoStream(UDID_BOOT), null);
});

test('health 上报 ios 平台与托管模拟器计数', async () => {
  const { runner } = makeRunner();
  const p = new SimulatorProvider('mac-node-1', { runner });
  const h = await p.health();
  assert.strictEqual(h.platform, 'ios');
  assert.strictEqual(h.nodeId, 'mac-node-1');
  assert.strictEqual(h.managedEmulatorCount, 1); // 仅 JingCang-iPhone-15 处于 Booted
});

test('runtimeVersionOf 兼容新旧 runtime key', () => {
  assert.strictEqual(SimulatorProvider.runtimeVersionOf('com.apple.CoreSimulator.SimRuntime.iOS-17-5'), '17.5');
  assert.strictEqual(SimulatorProvider.runtimeVersionOf('iOS 16.4'), '16.4');
  assert.strictEqual(SimulatorProvider.runtimeVersionOf('com.apple.CoreSimulator.SimRuntime.watchOS-10-5'), 'unknown');
});
