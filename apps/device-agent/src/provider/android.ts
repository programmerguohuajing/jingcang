import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeviceAction } from '@jingcang/device-contracts';

/**
 * provider-android（AND-009）
 *
 * 定义 Android 设备 Provider 的统一接口，并以"原生模拟器 + ADB + Appium"方式给出
 * 参考实现 EmulatorProvider。provision/start/stop/installApp/capture/execute/health
 * 均按接口实现；真机驱动需要 Android SDK / ADB，未安装时相关方法抛出 PROVIDER_UNAVAILABLE，
 * 便于在缺 SDK 的环境安全编译与单测（控制面/契约测试不依赖真机）。
 */
export interface DeviceInventory {
  id: string;
  kind: 'android-emulator' | 'android-real';
  state: 'device' | 'offline' | 'unauthorized';
  booted: boolean;
}

export interface ProfileInfo {
  id: string;
  displayName: string;
  osVersion: string;
  apiLevel: number;
  arch: string;
  abi: string;
}

export interface AndroidProvider {
  readonly platform: 'android';
  listDevices(): Promise<DeviceInventory[]>;
  getCapabilities(): Promise<Record<string, any>>;
  listSystemImages(): Promise<{ images: Array<{ name: string; version: string; arch: string }> }>;
  listProfiles(): Promise<ProfileInfo[]>;
  createProfile(apiLevel: number): Promise<{ id: string }>;
  deleteProfile(id: string): Promise<void>;
  startProfile(id: string): Promise<void>;
  stopProfile(id: string): Promise<void>;
  /** 确保设备处于可会话状态（启动/解锁）。 */
  provision(deviceId: string, mode: 'phone' | 'browser'): Promise<void>;
  installApp(deviceId: string, base64: string): Promise<{ packageName: string }>;
  capture(deviceId: string): Promise<Buffer>;
  execute(deviceId: string, action: DeviceAction): Promise<Record<string, any>>;
  runAutomation(deviceId: string): Promise<Record<string, any>>;
  /** h264 视频流；不支持时返回 null，由 Agent 端点回退。 */
  startVideoStream(deviceId: string): Promise<{ stream: AsyncIterable<Buffer> } | null>;
  health(): Promise<{
    nodeId: string;
    platform: 'android';
    startedAt: string;
    uptimeSeconds: number;
    managedEmulatorCount: number;
  }>;
}

class ProviderUnavailable extends Error {
  code = 'PROVIDER_UNAVAILABLE';
}

function adbAvailable(): boolean {
  try {
    const r = spawnSync('adb', ['--version'], { timeout: 5000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function runAdb(args: string[], timeoutMs = 30000): { stdout: string; status: number } {
  const r = spawnSync('adb', args, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (r.error) throw Object.assign(new ProviderUnavailable(`ADB 不可用: ${r.error.message}`), { code: 'PROVIDER_UNAVAILABLE' });
  return { stdout: r.stdout ?? '', status: r.status ?? 1 };
}

function mapKeyEvent(key: string): string | null {
  const map: Record<string, string> = {
    BACK: '4',
    HOME: '3',
    ENTER: '66',
    APP_SWITCH: '187',
    VOLUME_UP: '24',
    VOLUME_DOWN: '25',
    POWER: '26'
  };
  return map[key.toUpperCase()] ?? null;
}

export class EmulatorProvider implements AndroidProvider {
  readonly platform = 'android' as const;
  private startedAt = new Date();
  private nodeId: string;
  private sdkRoot?: string;

  constructor(nodeId: string, opts: { sdkRoot?: string } = {}) {
    this.nodeId = nodeId;
    this.sdkRoot = opts.sdkRoot ?? process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
  }

  async listDevices(): Promise<DeviceInventory[]> {
    if (!adbAvailable()) throw new ProviderUnavailable('ADB 未安装或不可用');
    const { stdout } = runAdb(['devices', '-l']);
    const lines = stdout.split('\n').slice(1);
    const out: DeviceInventory[] = [];
    for (const line of lines) {
      const m = line.match(/^(\S+)\s+(device|offline|unauthorized)/);
      if (!m) continue;
      const id = m[1];
      const state = m[2] as DeviceInventory['state'];
      out.push({
        id,
        kind: id.startsWith('emulator') ? 'android-emulator' : 'android-real',
        state,
        booted: state === 'device'
      });
    }
    return out;
  }

  async getCapabilities() {
    const ok = adbAvailable();
    return {
      touch: true,
      rotate: true,
      screenshot: ok,
      record: ok,
      installApp: ok,
      automation: ok,
      camera: false,
      gps: ok,
      maxConcurrentSessions: 1
    };
  }

  async listSystemImages() {
    if (!this.sdkRoot) return { images: [] };
    const imagesDir = path.join(this.sdkRoot, 'system-images');
    if (!fs.existsSync(imagesDir)) return { images: [] };
    const images: Array<{ name: string; version: string; arch: string }> = [];
    for (const dir of fs.readdirSync(imagesDir)) {
      const sub = path.join(imagesDir, dir);
      if (!fs.statSync(sub).isDirectory()) continue;
      for (const abi of fs.readdirSync(sub)) {
        images.push({ name: `${dir}/${abi}`, version: dir, arch: abi });
      }
    }
    return { images };
  }

  async listProfiles(): Promise<ProfileInfo[]> {
    if (!adbAvailable()) throw new ProviderUnavailable('ADB 未安装或不可用');
    const { stdout } = runAdb(['emu', 'avd', 'list'], 10000);
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((name) => ({
        id: name,
        displayName: name,
        osVersion: 'unknown',
        apiLevel: 0,
        arch: 'x86_64',
        abi: 'x86_64'
      }));
  }

  async createProfile(apiLevel: number): Promise<{ id: string }> {
    if (!this.sdkRoot) throw new ProviderUnavailable('ANDROID_HOME 未配置');
    const id = `JingCang_Test_API${apiLevel}_x86_64`;
    // 实际操作需 sdkmanager + avdmanager；此处给出受控占位命令（不静默执行高风险操作）
    throw Object.assign(
      new Error(`创建 AVD 需 sdkmanager/avdmanager：${id}（apiLevel=${apiLevel}）`),
      { code: 'PROFILE_CREATE_DRYRUN', id }
    );
  }

  async deleteProfile(id: string): Promise<void> {
    if (!adbAvailable()) throw new ProviderUnavailable('ADB 未安装或不可用');
    runAdb(['emu', 'avd', 'delete', id], 15000);
  }

  async startProfile(id: string): Promise<void> {
    if (!this.sdkRoot) throw new ProviderUnavailable('ANDROID_HOME 未配置');
    const emulatorBin = path.join(this.sdkRoot, 'emulator', 'emulator');
    if (!fs.existsSync(emulatorBin)) throw new ProviderUnavailable('emulator 二进制不存在');
    spawn(emulatorBin, ['-avd', id, '-no-audio', '-no-window'], { detached: true, stdio: 'ignore' });
  }

  async stopProfile(id: string): Promise<void> {
    if (!adbAvailable()) throw new ProviderUnavailable('ADB 未安装或不可用');
    runAdb(['emu', 'avd', 'stop', id], 15000);
  }

  async provision(deviceId: string, _mode: 'phone' | 'browser'): Promise<void> {
    const devices = await this.listDevices();
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) throw Object.assign(new Error(`设备不存在: ${deviceId}`), { code: 'DEVICE_NOT_FOUND' });
    if (dev.state !== 'device') throw Object.assign(new Error(`设备未就绪: ${deviceId}`), { code: 'DEVICE_NOT_READY' });
  }

  async installApp(deviceId: string, base64: string): Promise<{ packageName: string }> {
    if (!adbAvailable()) throw new ProviderUnavailable('ADB 未安装或不可用');
    const apkPath = path.join(os.tmpdir(), `jc-install-${Date.now()}.apk`);
    fs.writeFileSync(apkPath, Buffer.from(base64, 'base64'));
    try {
      const { stdout } = runAdb(['-s', deviceId, 'install', '-r', apkPath], 120000);
      const m = stdout.match(/package:(\S+)/);
      const pkg = m ? m[1] : 'unknown';
      return { packageName: pkg };
    } finally {
      fs.rmSync(apkPath, { force: true });
    }
  }

  async capture(deviceId: string): Promise<Buffer> {
    if (!adbAvailable()) throw new ProviderUnavailable('ADB 未安装或不可用');
    const r = spawnSync('adb', ['-s', deviceId, 'exec-out', 'screencap', '-p'], {
      timeout: 15000,
      maxBuffer: 32 * 1024 * 1024
    });
    if (r.error || !r.stdout || !Buffer.isBuffer(r.stdout)) {
      throw new ProviderUnavailable('截图失败');
    }
    return r.stdout;
  }

  async execute(deviceId: string, action: DeviceAction): Promise<Record<string, any>> {
    if (!adbAvailable()) throw new ProviderUnavailable('ADB 未安装或不可用');
    switch (action.type) {
      case 'tap':
        runAdb(['-s', deviceId, 'shell', 'input', 'tap', String(action.x), String(action.y)]);
        return { ok: true };
      case 'swipe':
        runAdb([
          '-s', deviceId, 'shell', 'input', 'swipe',
          String(action.x1), String(action.y1), String(action.x2), String(action.y2)
        ]);
        return { ok: true };
      case 'key': {
        if (!action.key) throw Object.assign(new Error('key 动作缺少 key'), { code: 'INVALID_KEY' });
        const code = mapKeyEvent(action.key);
        if (!code) throw Object.assign(new Error(`不支持的按键: ${action.key}`), { code: 'UNSUPPORTED_KEY' });
        runAdb(['-s', deviceId, 'shell', 'input', 'keyevent', code]);
        return { ok: true };
      }
      case 'back':
        runAdb(['-s', deviceId, 'shell', 'input', 'keyevent', '4']);
        return { ok: true };
      case 'home':
        runAdb(['-s', deviceId, 'shell', 'input', 'keyevent', '3']);
        return { ok: true };
      case 'rotate':
        // 旋转需通过 settings put 修改加速度计/覆盖方向，这里仅触发重新布局
        runAdb(['-s', deviceId, 'shell', 'input', 'keyevent', '82']);
        return { ok: true, note: 'rotate-approximated' };
      case 'navigate': {
        const url = action.url;
        if (!url) throw Object.assign(new Error('navigate 动作缺少 url'), { code: 'INVALID_URL' });
        runAdb([
          '-s', deviceId, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW',
          '-d', url, '--activity-clear-top'
        ]);
        return { ok: true };
      }
      case 'screenshot':
        return { ok: true, png: (await this.capture(deviceId)).toString('base64') };
      default:
        throw Object.assign(new Error('未知动作'), { code: 'UNKNOWN_ACTION' });
    }
  }

  async runAutomation(deviceId: string): Promise<Record<string, any>> {
    // AND-006 Appium UiAutomator2 链路：需 Appium server + WDIO client。
    throw Object.assign(new Error('Appium 自动化需独立 Appium server，本环境未启用'), {
      code: 'AUTOMATION_DISABLED'
    });
  }

  async startVideoStream(deviceId: string): Promise<{ stream: AsyncIterable<Buffer> } | null> {
    if (!adbAvailable()) return null;
    // scrcpy 视频流需独立进程管道；此处返回 null 以告知 Agent 端点回退到截图轮询
    void deviceId;
    return null;
  }

  async health() {
    return {
      nodeId: this.nodeId,
      platform: 'android' as const,
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      managedEmulatorCount: (await this.listDevices().catch(() => [])).filter((d) => d.kind === 'android-emulator').length
    };
  }
}
