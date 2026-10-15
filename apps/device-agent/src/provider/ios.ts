import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DeviceAction } from '@jingcang/device-contracts';
import {
  CommandRunner,
  DeviceInventory,
  ProviderHealth,
  ProviderUnavailable,
  defaultRunner,
  providerError
} from './types.js';

/**
 * provider-ios（IOS-011）
 *
 * macOS 节点上的 iOS Simulator Provider，基于 `xcrun simctl` 实现：
 * 发现 / 创建 / 启动 / 关闭模拟器、PNG 截图、simctl openurl 导航、
 * .app 安装（zip 包解压后 simctl install）。
 *
 * 触控（tap/swipe）依赖可选的 `idb`（Facebook iOS Development Bridge）；
 * 未安装时相关动作返回 INPUT_UNAVAILABLE，由调用方降级（只看画面）。
 * simctl 本身不提供点击/滑动/按键 API，这是 Apple 工具链的固有限制。
 *
 * 设计约束（与 android.ts 一致）：
 * - xcrun 不可用时抛出 PROVIDER_UNAVAILABLE，便于缺 macOS/Xcode 环境安全编译与单测；
 * - 仅管理名字以 `JingCang-` 开头的模拟器（创建/删除/启停），不触碰用户自有模拟器；
 * - 所有外部命令经可注入的 CommandRunner，便于无 Mac 环境单测。
 */

const MANAGED_PREFIX = 'JingCang-';
const UDID_RE = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export interface IosRuntimeInfo {
  identifier: string;
  name: string;
  version: string;
  build: string;
  isAvailable: boolean;
}

export interface IosDeviceTypeInfo {
  identifier: string;
  name: string;
  productFamily: string;
}

export interface IosProfileInfo {
  id: string; // UDID
  displayName: string;
  osVersion: string;
  runtimeId: string;
  deviceTypeId: string;
  model: string;
  managed: boolean;
}

interface SimctlDevice {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
  deviceTypeIdentifier?: string;
}

export interface IosProvider {
  readonly platform: 'ios';
  listDevices(): Promise<DeviceInventory[]>;
  getCapabilities(): Promise<Record<string, any>>;
  listSystemImages(): Promise<{ images: Array<{ name: string; version: string; arch: string }> }>;
  listDeviceTypes(): Promise<IosDeviceTypeInfo[]>;
  listProfiles(): Promise<IosProfileInfo[]>;
  createProfile(deviceTypeId: string, runtimeId: string, name?: string): Promise<{ id: string }>;
  deleteProfile(udid: string): Promise<void>;
  startProfile(udid: string): Promise<void>;
  stopProfile(udid: string): Promise<void>;
  /** 确保模拟器处于可会话状态（启动等待）。 */
  provision(deviceId: string, mode: 'phone' | 'browser'): Promise<void>;
  installApp(deviceId: string, base64Zip: string): Promise<{ packageName: string }>;
  capture(deviceId: string): Promise<Buffer>;
  execute(deviceId: string, action: DeviceAction): Promise<Record<string, any>>;
  runAutomation(deviceId: string): Promise<Record<string, any>>;
  /** simctl recordVideo 只写文件、无实时管道；返回 null 由 Agent 端点回退截图轮询。 */
  startVideoStream(deviceId: string): Promise<{ stream: AsyncIterable<Buffer> } | null>;
  health(): Promise<ProviderHealth>;
}

export class SimulatorProvider implements IosProvider {
  readonly platform = 'ios' as const;
  private startedAt = new Date();
  private nodeId: string;
  private runner: CommandRunner;

  constructor(nodeId: string, opts: { runner?: CommandRunner } = {}) {
    this.nodeId = nodeId;
    this.runner = opts.runner ?? defaultRunner;
  }

  private xcrunAvailable(): boolean {
    try {
      return this.runner('xcrun', ['--version'], { timeoutMs: 10000 }).status === 0;
    } catch {
      return false;
    }
  }

  private idbAvailable(): boolean {
    try {
      return this.runner('idb', ['--version'], { timeoutMs: 10000 }).status === 0;
    } catch {
      return false;
    }
  }

  private simctl(args: string[], timeoutMs = 60000): string {
    if (!this.xcrunAvailable()) throw new ProviderUnavailable('xcrun 未安装或不可用（需要 macOS + Xcode Command Line Tools）');
    const r = this.runner('xcrun', ['simctl', ...args], { timeoutMs });
    if (r.status !== 0) {
      throw providerError(`simctl ${args[0]} 失败: ${(r.stderr || r.stdout).trim().slice(0, 300)}`, 'SIMCTL_ERROR');
    }
    return r.stdout;
  }

  private parseDevices(): Array<SimctlDevice & { runtimeKey: string }> {
    const out = this.simctl(['list', 'devices', '--json'], 30000);
    let json: any;
    try {
      json = JSON.parse(out);
    } catch {
      throw providerError('simctl list 输出解析失败', 'PROVIDER_ERROR');
    }
    const devices: Array<SimctlDevice & { runtimeKey: string }> = [];
    for (const [runtimeKey, list] of Object.entries<any>(json.devices ?? {})) {
      if (!Array.isArray(list)) continue;
      for (const d of list) {
        if (!d?.udid) continue;
        devices.push({ udid: d.udid, name: d.name ?? d.udid, state: d.state ?? 'Shutdown', isAvailable: d.isAvailable !== false, deviceTypeIdentifier: d.deviceTypeIdentifier, runtimeKey });
      }
    }
    return devices;
  }

  /** runtime key → "17.5" 这类版本号（兼容新/旧两种 key 格式）。 */
  static runtimeVersionOf(runtimeKey: string): string {
    let m = runtimeKey.match(/iOS-(\d+)-(\d+)/i);
    if (m) return `${m[1]}.${m[2]}`;
    m = runtimeKey.match(/iOS\s+(\d+(?:\.\d+)*)/i);
    if (m) return m[1];
    return 'unknown';
  }

  private mapState(state: string): { state: DeviceInventory['state']; booted: boolean } {
    if (state === 'Booted') return { state: 'device', booted: true };
    if (state === 'Booting' || state === 'Creating' || state === 'Shutting Down') return { state: 'booting', booted: false };
    return { state: 'offline', booted: false };
  }

  async listDevices(): Promise<DeviceInventory[]> {
    if (!this.xcrunAvailable()) throw new ProviderUnavailable('xcrun 未安装或不可用（需要 macOS + Xcode Command Line Tools）');
    return this.parseDevices().map((d) => {
      const mapped = this.mapState(d.state);
      return {
        id: d.udid,
        kind: 'ios-simulator' as const,
        state: d.isAvailable ? mapped.state : 'offline',
        booted: d.isAvailable && mapped.booted,
        model: d.name,
        osVersion: SimulatorProvider.runtimeVersionOf(d.runtimeKey)
      };
    });
  }

  async getCapabilities() {
    const simctlOk = this.xcrunAvailable();
    const idbOk = this.idbAvailable();
    return {
      touch: idbOk,
      rotate: false,
      screenshot: simctlOk,
      record: false,
      installApp: simctlOk,
      automation: false,
      camera: false,
      gps: false,
      maxConcurrentSessions: 1,
      inputDriver: idbOk ? 'idb' : 'none'
    };
  }

  async listSystemImages() {
    const out = this.simctl(['list', 'runtimes', '--json'], 30000);
    let json: any;
    try {
      json = JSON.parse(out);
    } catch {
      throw providerError('simctl runtimes 输出解析失败', 'PROVIDER_ERROR');
    }
    const arch = os.arch() === 'arm64' ? 'arm64' : 'x86_64';
    const images: Array<{ name: string; version: string; arch: string }> = [];
    for (const r of json.runtimes ?? []) {
      if (typeof r?.name !== 'string' || !r.name.startsWith('iOS')) continue;
      images.push({ name: r.identifier ?? r.name, version: String(r.version ?? r.name), arch });
    }
    return { images };
  }

  async listDeviceTypes(): Promise<IosDeviceTypeInfo[]> {
    const out = this.simctl(['list', 'devicetypes', '--json'], 30000);
    let json: any;
    try {
      json = JSON.parse(out);
    } catch {
      throw providerError('simctl devicetypes 输出解析失败', 'PROVIDER_ERROR');
    }
    return (json.devicetypes ?? []).map((t: any) => ({
      identifier: String(t.identifier ?? ''),
      name: String(t.name ?? ''),
      productFamily: String(t.productFamily ?? '')
    })).filter((t: IosDeviceTypeInfo) => t.identifier && t.productFamily === 'iPhone');
  }

  async listProfiles(): Promise<IosProfileInfo[]> {
    if (!this.xcrunAvailable()) throw new ProviderUnavailable('xcrun 未安装或不可用（需要 macOS + Xcode Command Line Tools）');
    return this.parseDevices().map((d) => ({
      id: d.udid,
      displayName: `${d.name} · iOS ${SimulatorProvider.runtimeVersionOf(d.runtimeKey)}`,
      osVersion: SimulatorProvider.runtimeVersionOf(d.runtimeKey),
      runtimeId: d.runtimeKey,
      deviceTypeId: d.deviceTypeIdentifier ?? '',
      model: d.name,
      managed: d.name.startsWith(MANAGED_PREFIX)
    }));
  }

  async createProfile(deviceTypeId: string, runtimeId: string, name?: string): Promise<{ id: string }> {
    if (!deviceTypeId || !runtimeId) throw providerError('创建模拟器需要 deviceTypeId 与 runtimeId', 'INVALID_PROFILE');
    if (!/^com\.apple\.CoreSimulator\.SimDeviceType\./.test(deviceTypeId) || !/^com\.apple\.CoreSimulator\.SimRuntime\./.test(runtimeId)) {
      throw providerError('deviceTypeId/runtimeId 格式非法', 'INVALID_PROFILE');
    }
    const profileName = (name?.trim() || `${MANAGED_PREFIX}iOS-${Date.now()}`).slice(0, 80);
    const out = this.simctl(['create', profileName, deviceTypeId, runtimeId], 120000).trim();
    if (!UDID_RE.test(out)) throw providerError(`创建模拟器返回异常: ${out.slice(0, 80)}`, 'PROVIDER_ERROR');
    return { id: out };
  }

  private async requireManaged(udid: string): Promise<SimctlDevice & { runtimeKey: string }> {
    if (!UDID_RE.test(udid)) throw providerError(`设备 ID 非法: ${udid}`, 'INVALID_DEVICE_ID');
    const dev = this.parseDevices().find((d) => d.udid.toLowerCase() === udid.toLowerCase());
    if (!dev) throw providerError(`设备不存在: ${udid}`, 'DEVICE_NOT_FOUND');
    if (!dev.name.startsWith(MANAGED_PREFIX)) {
      throw providerError(`仅允许操作 JingCang 创建的模拟器（${MANAGED_PREFIX}*）`, 'PROFILE_NOT_MANAGED');
    }
    return dev;
  }

  async deleteProfile(udid: string): Promise<void> {
    await this.requireManaged(udid);
    this.simctl(['delete', udid], 60000);
  }

  async startProfile(udid: string): Promise<void> {
    await this.requireManaged(udid);
    try {
      this.simctl(['boot', udid], 120000);
    } catch (e: any) {
      // 已处于 Booted 视为幂等成功
      if (!/Booted/i.test(String(e?.message ?? ''))) throw e;
    }
    await this.waitBooted(udid, 180000);
  }

  async stopProfile(udid: string): Promise<void> {
    await this.requireManaged(udid);
    try {
      this.simctl(['shutdown', udid], 60000);
    } catch (e: any) {
      // 未启动时视为幂等成功
      if (!/not booted|shut ?down/i.test(String(e?.message ?? ''))) throw e;
    }
  }

  private async waitBooted(udid: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const dev = this.parseDevices().find((d) => d.udid.toLowerCase() === udid.toLowerCase());
      if (dev?.state === 'Booted') return;
      if (Date.now() > deadline) throw providerError(`模拟器启动超时: ${udid}`, 'BOOT_TIMEOUT');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private resolveUdid(deviceId: string): string {
    if (deviceId === 'booted') return 'booted';
    if (!UDID_RE.test(deviceId)) throw providerError(`设备 ID 非法: ${deviceId}`, 'INVALID_DEVICE_ID');
    return deviceId;
  }

  async provision(deviceId: string, _mode: 'phone' | 'browser'): Promise<void> {
    const udid = this.resolveUdid(deviceId);
    if (udid === 'booted') return;
    const dev = this.parseDevices().find((d) => d.udid.toLowerCase() === udid.toLowerCase());
    if (!dev) throw providerError(`设备不存在: ${deviceId}`, 'DEVICE_NOT_FOUND');
    if (dev.state !== 'Booted') {
      this.simctl(['boot', udid], 120000);
      await this.waitBooted(udid, 180000);
    }
  }

  async installApp(deviceId: string, base64Zip: string): Promise<{ packageName: string }> {
    const udid = this.resolveUdid(deviceId);
    let zip: Buffer;
    try {
      zip = Buffer.from(base64Zip, 'base64');
    } catch {
      throw providerError('安装包不是合法 base64', 'INVALID_APP');
    }
    if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) throw providerError('安装包不是 zip 格式（需要包含 .app 的 zip）', 'INVALID_APP');
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-ios-install-'));
    try {
      const zipPath = path.join(workdir, 'app.zip');
      fs.writeFileSync(zipPath, zip);
      const r = this.runner('unzip', ['-q', '-o', zipPath, '-d', workdir], { timeoutMs: 120000 });
      if (r.status !== 0) throw providerError(`解压安装包失败: ${r.stderr.trim().slice(0, 200)}`, 'INVALID_APP');
      const appDir = findAppBundle(workdir);
      if (!appDir) throw providerError('zip 中未找到 .app 包（支持根目录或 Payload/*.app）', 'INVALID_APP');
      const bundleId = readBundleId(path.join(appDir, 'Info.plist'));
      this.simctl(['install', udid, appDir], 180000);
      return { packageName: bundleId };
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }

  async capture(deviceId: string): Promise<Buffer> {
    const udid = this.resolveUdid(deviceId);
    const pngPath = path.join(os.tmpdir(), `jc-ios-shot-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`);
    try {
      this.simctl(['io', udid, 'screenshot', pngPath], 30000);
      if (!fs.existsSync(pngPath)) throw providerError('截图失败：simctl 未生成文件', 'PROVIDER_ERROR');
      return fs.readFileSync(pngPath);
    } finally {
      fs.rmSync(pngPath, { force: true });
    }
  }

  async execute(deviceId: string, action: DeviceAction): Promise<Record<string, any>> {
    const udid = this.resolveUdid(deviceId);
    switch (action.type) {
      case 'tap':
        return this.idbTap(udid, action.x, action.y);
      case 'swipe':
        return this.idbSwipe(udid, action.x1, action.y1, action.x2, action.y2);
      case 'navigate': {
        const url = action.url;
        if (!url || !/^https?:\/\//i.test(url)) throw providerError('navigate 动作缺少合法 url', 'INVALID_URL');
        this.simctl(['openurl', udid, url], 30000);
        return { ok: true };
      }
      case 'screenshot':
        return { ok: true, png: (await this.capture(deviceId)).toString('base64') };
      case 'home':
      case 'back':
      case 'key':
      case 'rotate':
        throw providerError(`iOS 模拟器不支持该操作: ${action.type}（simctl 未提供对应 API）`, 'UNSUPPORTED_ACTION');
      default:
        throw providerError('未知动作', 'UNKNOWN_ACTION');
    }
  }

  private requireIdb(): void {
    if (!this.idbAvailable()) {
      throw providerError('触控需要 idb（Facebook iOS Development Bridge），macOS 节点未安装', 'INPUT_UNAVAILABLE');
    }
  }

  private idbTap(udid: string, x?: number, y?: number): Record<string, any> {
    this.requireIdb();
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw providerError('tap 动作缺少坐标', 'INVALID_ACTION');
    const r = this.runner('idb', ['--udid', udid, 'ui', 'tap', String(Math.round(x!)), String(Math.round(y!))], { timeoutMs: 30000 });
    if (r.status !== 0) throw providerError(`idb tap 失败: ${(r.stderr || r.stdout).trim().slice(0, 200)}`, 'INPUT_FAILED');
    return { ok: true };
  }

  private idbSwipe(udid: string, x1?: number, y1?: number, x2?: number, y2?: number): Record<string, any> {
    this.requireIdb();
    for (const v of [x1, y1, x2, y2]) {
      if (!Number.isFinite(v)) throw providerError('swipe 动作缺少坐标', 'INVALID_ACTION');
    }
    const r = this.runner('idb', ['--udid', udid, 'ui', 'swipe',
      String(Math.round(x1!)), String(Math.round(y1!)), String(Math.round(x2!)), String(Math.round(y2!))], { timeoutMs: 30000 });
    if (r.status !== 0) throw providerError(`idb swipe 失败: ${(r.stderr || r.stdout).trim().slice(0, 200)}`, 'INPUT_FAILED');
    return { ok: true };
  }

  async runAutomation(_deviceId: string): Promise<Record<string, any>> {
    // Appium XCUITest 链路：需独立 Appium server + WDA，与 android.ts 口径一致。
    throw providerError('Appium 自动化需独立 Appium server，本环境未启用', 'AUTOMATION_DISABLED');
  }

  async startVideoStream(_deviceId: string): Promise<{ stream: AsyncIterable<Buffer> } | null> {
    return null;
  }

  async health(): Promise<ProviderHealth> {
    let managed = 0;
    try {
      managed = this.parseDevices().filter((d) => d.name.startsWith(MANAGED_PREFIX) && d.state === 'Booted').length;
    } catch {
      // xcrun 不可用时健康检查不抛，沿用 android.ts 的宽容口径
    }
    return {
      nodeId: this.nodeId,
      platform: 'ios',
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt.getTime()) / 1000),
      managedEmulatorCount: managed
    };
  }
}

/** 在解压目录中查找 .app（根目录或 Payload/ 下）。 */
function findAppBundle(dir: string): string | null {
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.app')) {
      const p = path.join(dir, entry);
      if (fs.statSync(p).isDirectory()) return p;
    }
  }
  const payload = path.join(dir, 'Payload');
  if (fs.existsSync(payload) && fs.statSync(payload).isDirectory()) {
    for (const entry of fs.readdirSync(payload)) {
      if (entry.endsWith('.app')) {
        const p = path.join(payload, entry);
        if (fs.statSync(p).isDirectory()) return p;
      }
    }
  }
  return null;
}

/** 从 Info.plist（XML）读取 CFBundleIdentifier；解析失败返回 unknown。 */
function readBundleId(plistPath: string): string {
  try {
    const xml = fs.readFileSync(plistPath, 'utf8');
    const m = xml.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
    return m ? m[1].trim() : 'unknown';
  } catch {
    return 'unknown';
  }
}
