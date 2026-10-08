import { z } from 'zod';

/**
 * JingCang 多端云测试平台 —— 设备/节点/会话统一契约
 *
 * 这些契约是控制面（control-api）与设备运行面（device-agent / provider）之间的
 * 唯一事实来源，前端、Agent、Provider 均须以此为准。
 *
 * 约定：
 * - NodePlatform：运行 Device Agent 的主机操作系统。
 * - DevicePlatform / DeviceKind：被管控设备的平台与形态（模拟器/真机）。
 * - SessionMode：同一设备底座之上的两种业务模式（完整云手机 / 移动浏览器）。
 */

// ---------------------------------------------------------------------------
// 平台与形态
// ---------------------------------------------------------------------------

export const NODE_PLATFORMS = ['windows', 'linux', 'macos'] as const;
export type NodePlatform = (typeof NODE_PLATFORMS)[number];

export const DEVICE_PLATFORMS = ['android', 'ios'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

export const DEVICE_KINDS = [
  'android-emulator',
  'android-real',
  'ios-simulator',
  'ios-real'
] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** 业务会话模式：完整云手机（phone）与移动浏览器测试（browser）。 */
export const SESSION_MODES = ['phone', 'browser'] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/**
 * 设备会话统一状态机（Session Core）：
 *   QUEUED → ALLOCATING → BOOTING → READY → TERMINATING → TERMINATED
 * 失败/异常分支：FAILED / EXPIRED / LOST
 */
export const DEVICE_SESSION_STATUSES = [
  'QUEUED',
  'ALLOCATING',
  'BOOTING',
  'READY',
  'TERMINATING',
  'TERMINATED',
  'FAILED',
  'EXPIRED',
  'LOST'
] as const;
export type DeviceSessionStatus = (typeof DEVICE_SESSION_STATUSES)[number];

/** 节点存活状态。 */
export const NODE_STATUSES = ['ONLINE', 'OFFLINE', 'REVOKED'] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

/** 设备实例在节点上的瞬时状态。 */
export const DEVICE_STATES = ['device', 'offline', 'unauthorized', 'booting', 'busy'] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

// ---------------------------------------------------------------------------
// 能力 / Profile
// ---------------------------------------------------------------------------

export const ScreenSpecSchema = z.object({
  width: z.number().int().min(200).max(4096),
  height: z.number().int().min(200).max(4096),
  densityDpi: z.number().int().min(72).max(640).optional()
});
export type ScreenSpec = z.infer<typeof ScreenSpecSchema>;

/** 设备能力描述，由 Agent 上报，用于目录过滤与调度。 */
export const DeviceCapabilitiesSchema = z.object({
  touch: z.boolean().default(true),
  rotate: z.boolean().default(true),
  screenshot: z.boolean().default(true),
  record: z.boolean().default(false),
  installApp: z.boolean().default(false),
  automation: z.boolean().default(false),
  camera: z.boolean().default(false),
  gps: z.boolean().default(false),
  maxConcurrentSessions: z.number().int().min(1).max(8).default(1)
});
export type DeviceCapabilities = z.infer<typeof DeviceCapabilitiesSchema>;

/**
 * DeviceProfile：节点的一种可供应镜像/系统版本组合（如某 AVD 镜像或某 iOS Runtime）。
 * 仅在目录中展示已安装、可用的版本。
 */
export const DeviceProfileSchema = z.object({
  id: z.string().trim().min(1).max(160),
  platform: z.enum(DEVICE_PLATFORMS),
  kind: z.enum(DEVICE_KINDS),
  displayName: z.string().trim().min(1).max(160),
  osVersion: z.string().trim().min(1).max(64),
  apiLevel: z.number().int().min(1).max(99).optional(),
  model: z.string().trim().max(120).optional(),
  imageName: z.string().trim().max(200).optional(),
  arch: z.string().trim().max(32).optional(),
  abi: z.string().trim().max(32).optional(),
  screen: ScreenSpecSchema.optional(),
  capabilities: DeviceCapabilitiesSchema.default({}),
  managed: z.boolean().default(false)
});
export type DeviceProfile = z.infer<typeof DeviceProfileSchema>;

// ---------------------------------------------------------------------------
// 节点 / 设备实例 / 租约
// ---------------------------------------------------------------------------

export const DeviceNodeSchema = z.object({
  nodeId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/, '节点 ID 仅允许字母数字 . _ -'),
  platform: z.enum(NODE_PLATFORMS),
  startedAt: z.string().datetime({ offset: true }),
  lastSeenAt: z.string().datetime({ offset: true }),
  uptimeSeconds: z.number().int().min(0),
  managedCount: z.number().int().min(0),
  status: z.enum(NODE_STATUSES).default('ONLINE'),
  version: z.string().trim().max(64).optional()
});
export type DeviceNode = z.infer<typeof DeviceNodeSchema>;

export const DeviceInstanceSchema = z.object({
  nodeId: z.string().trim().min(1).max(80),
  deviceId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/, '设备 ID 非法'),
  platform: z.enum(DEVICE_PLATFORMS),
  kind: z.enum(DEVICE_KINDS),
  state: z.enum(DEVICE_STATES),
  booted: z.boolean().default(false),
  lastSeenAt: z.string().datetime({ offset: true }),
  profileId: z.string().trim().max(160).optional(),
  capabilities: DeviceCapabilitiesSchema.optional()
});
export type DeviceInstance = z.infer<typeof DeviceInstanceSchema>;

export const DeviceLeaseSchema = z.object({
  leaseId: z.string().trim().min(1).max(80),
  nodeId: z.string().trim().min(1).max(80),
  deviceId: z.string().trim().min(1).max(80),
  sessionId: z.string().trim().min(1).max(80),
  userId: z.string().trim().min(1).max(80),
  mode: z.enum(SESSION_MODES),
  acquiredAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  releasedAt: z.string().datetime({ offset: true }).nullable().default(null)
});
export type DeviceLease = z.infer<typeof DeviceLeaseSchema>;

// ---------------------------------------------------------------------------
// 会话请求 / 响应
// ---------------------------------------------------------------------------

export const CreateDeviceSessionRequestSchema = z.object({
  deviceId: z.string().trim().min(1).max(80).regex(/^[\w.:-]+$/, '设备 ID 非法'),
  nodeId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/).optional(),
  mode: z.enum(SESSION_MODES),
  startUrl: z
    .string()
    .trim()
    .max(2048)
    .refine((v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    }, '起始 URL 须为 http/https')
    .optional(),
  profileId: z.string().trim().max(160).optional(),
  durationMinutes: z.number().int().min(5).max(1440).default(60)
});
export type CreateDeviceSessionRequest = z.infer<typeof CreateDeviceSessionRequestSchema>;

export const DeviceSessionResponseSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  nodeId: z.string(),
  mode: z.enum(SESSION_MODES),
  status: z.enum(DEVICE_SESSION_STATUSES),
  userId: z.string(),
  username: z.string().optional(),
  startUrl: z.string().optional(),
  viewerUrl: z.string().optional(),
  viewerToken: z.string().optional(),
  leaseId: z.string().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable().optional(),
  failureCode: z.string().nullable().optional(),
  failureMessage: z.string().nullable().optional()
});
export type DeviceSessionResponse = z.infer<typeof DeviceSessionResponseSchema>;

// ---------------------------------------------------------------------------
// 节点注册 / 心跳 / 设备发现
// ---------------------------------------------------------------------------

export const EnrollNodeRequestSchema = z.object({
  nodeId: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._-]+$/, '节点 ID 非法')
    .refine((v) => v !== 'windows-local-dev', '保留节点 ID 不可用于注册')
});
export type EnrollNodeRequest = z.infer<typeof EnrollNodeRequestSchema>;

export const NodeHeartbeatSchema = z.object({
  platform: z.enum(NODE_PLATFORMS),
  uptimeSeconds: z.number().int().min(0),
  managedEmulatorCount: z.number().int().min(0),
  startedAt: z.string().datetime({ offset: true }).optional(),
  devices: z.array(z.object({
    id: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/, '设备 ID 非法'),
    kind: z.enum(DEVICE_KINDS),
    state: z.enum(DEVICE_STATES),
    booted: z.boolean()
  })).max(100)
});
export type NodeHeartbeat = z.infer<typeof NodeHeartbeatSchema>;

export const NodeCredentialSchema = z.object({
  nodeId: z.string(),
  credential: z.string().length(64).regex(/^[a-f0-9]{64}$/, '凭证须为 64 位十六进制')
});
export type NodeCredential = z.infer<typeof NodeCredentialSchema>;

// ---------------------------------------------------------------------------
// Viewer Token（绑定 user / session / device / lease）
// ---------------------------------------------------------------------------

export const ViewerTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().min(1),
  did: z.string().min(1),
  lid: z.string().min(1),
  node: z.string().min(1),
  mode: z.enum(SESSION_MODES),
  iat: z.number().int(),
  exp: z.number().int()
});
export type ViewerTokenClaims = z.infer<typeof ViewerTokenClaimsSchema>;

// ---------------------------------------------------------------------------
// Provider 动作（Agent → 设备）契约
// ---------------------------------------------------------------------------

export const DeviceActionSchema = z.object({
  type: z.enum(['tap', 'swipe', 'key', 'back', 'home', 'rotate', 'navigate', 'screenshot']),
  x: z.number().optional(),
  y: z.number().optional(),
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  key: z.string().optional(),
  url: z.string().url().optional()
});
export type DeviceAction = z.infer<typeof DeviceActionSchema>;

export const ERROR_CODES = {
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  NODE_ALREADY_ENROLLED: 'NODE_ALREADY_ENROLLED',
  INVALID_NODE_ID: 'INVALID_NODE_ID',
  DEVICE_UNAVAILABLE: 'DEVICE_UNAVAILABLE',
  DEVICE_BUSY: 'DEVICE_BUSY',
  NODE_NOT_ROUTABLE: 'NODE_NOT_ROUTABLE',
  SESSION_NOT_READY: 'SESSION_NOT_READY',
  LEASE_MISMATCH: 'LEASE_MISMATCH',
  INVALID_VIEWER_TOKEN: 'INVALID_VIEWER_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  AGENT_OFFLINE: 'AGENT_OFFLINE',
  PROVISION_FAILED: 'PROVISION_FAILED'
} as const;
export type DeviceErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
