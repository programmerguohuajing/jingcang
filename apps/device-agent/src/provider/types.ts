import { spawnSync } from 'node:child_process';
import type { DeviceKind, DevicePlatform, NodePlatform } from '@jingcang/device-contracts';

/**
 * provider-types（IOS-011）
 *
 * Android / iOS Provider 的共享基础类型。所有与宿主命令行的交互都经过
 * CommandRunner，便于在无真机/无 macOS 的环境注入假实现做单测
 * （沿用 AgentController 的 ControlApiTransport 注入思想）。
 */

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (cmd: string, args: string[], opts?: { timeoutMs?: number }) => CommandResult;

/** 默认执行器：同步 spawn（沿用 android.ts 的 spawnSync 风格）。 */
export const defaultRunner: CommandRunner = (cmd, args, opts) => {
  const r = spawnSync(cmd, args, {
    timeout: opts?.timeoutMs ?? 30000,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  });
  if (r.error) throw Object.assign(new ProviderUnavailable(`${cmd} 不可用: ${(r.error as Error).message}`), { code: 'PROVIDER_UNAVAILABLE' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

/** 节点发现的设备清单（跨平台统一形态）。 */
export interface DeviceInventory {
  id: string;
  kind: DeviceKind;
  state: 'device' | 'offline' | 'unauthorized' | 'booting' | 'busy';
  booted: boolean;
  model?: string;
  osVersion?: string;
}

/** Provider 健康摘要（心跳用最小集）。 */
export interface ProviderHealth {
  nodeId: string;
  platform: DevicePlatform;
  startedAt: string;
  uptimeSeconds: number;
  managedEmulatorCount: number;
}

/** 宿主操作系统 → 契约 NodePlatform。 */
export function nodePlatform(): NodePlatform {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

export class ProviderUnavailable extends Error {
  code = 'PROVIDER_UNAVAILABLE';
}

/** 命令执行失败（带 code 的受控错误）。 */
export function providerError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}
