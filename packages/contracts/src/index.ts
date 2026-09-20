import { z } from 'zod';

export const SESSION_STATUSES = [
  'REQUESTED',
  'QUEUED',
  'PROVISIONING',
  'STARTING',
  'READY',
  'TERMINATING',
  'TERMINATED',
  'FAILED',
  'EXPIRED',
  'LOST',
  'ORPHANED'
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const USER_ROLES = ['admin', 'tester'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ERROR_CODES = {
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_FORBIDDEN: 'AUTH_FORBIDDEN',
  INVALID_REQUEST: 'INVALID_REQUEST',
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  CAPACITY_EXCEEDED: 'CAPACITY_EXCEEDED',
  QUEUE_FULL: 'QUEUE_FULL',
  BROWSER_DISABLED: 'BROWSER_DISABLED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: ErrorCode | string;
    message: string;
    details?: any;
  };
  meta?: Record<string, any>;
}

// Auth Schemas
export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, '用户名不能为空').max(128, '用户名过长'),
  password: z.string().min(1, '密码不能为空').max(512, '密码过长')
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const ChangePasswordRequestSchema = z.object({
  oldPassword: z.string().min(1, '旧密码不能为空').max(512, '旧密码过长'),
  newPassword: z.string().min(12, '新密码至少12位').max(512, '新密码过长')
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// Browser Catalog Schemas
export const BrowserItemSchema = z.object({
  id: z.string(),
  browserName: z.enum(['chrome', 'edge', 'firefox', 'chromium']),
  displayName: z.string(),
  version: z.string(),
  channel: z.enum(['stable', 'beta', 'dev', 'esr']).default('stable'),
  image: z.string(),
  gridUrl: z.string().optional(),
  platform: z.string().default('linux-amd64'),
  enabled: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  capabilitiesJson: z.string().optional(),
  resourceJson: z.object({
    cpus: z.number().default(2),
    memory: z.string().default('3g'),
    shmSize: z.string().default('2g')
  }).optional()
});
export type BrowserItem = z.infer<typeof BrowserItemSchema>;

export const CatalogUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional()
});
export type CatalogUpdate = z.infer<typeof CatalogUpdateSchema>;

export const BROWSER_VENDORS = ['chrome', 'edge', 'firefox', 'chromium'] as const;
export type BrowserVendor = (typeof BROWSER_VENDORS)[number];

export const BrowserInstallRequestSchema = z.object({
  browserName: z.enum(BROWSER_VENDORS),
  version: z.string()
    .trim()
    .min(1, '浏览器版本不能为空')
    .max(64, '浏览器版本过长')
    .regex(/^(?:latest|[0-9][0-9A-Za-z._-]*)$/, '版本只能包含字母、数字、点、短横线或下划线')
});
export type BrowserInstallRequest = z.infer<typeof BrowserInstallRequestSchema>;

export const BROWSER_INSTALL_STATUSES = [
  'PENDING',
  'PULLING',
  'STARTING',
  'READY',
  'FAILED'
] as const;
export type BrowserInstallStatus = (typeof BROWSER_INSTALL_STATUSES)[number];

export interface BrowserInstallJob {
  id: string;
  browserName: BrowserVendor;
  version: string;
  image: string;
  status: BrowserInstallStatus;
  statusMessage: string;
  browserId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

// Session Schemas
export const ScreenOptionSchema = z.object({
  width: z.number().int().min(320, '宽度不能低于 320').max(5120, '宽度不能超过 5120').default(1920),
  height: z.number().int().min(240, '高度不能低于 240').max(3840, '高度不能超过 3840').default(1080),
  depth: z.number().int().min(8).max(32).default(24),
  dpi: z.number().int().min(72).max(300).default(96)
});

const StartUrlSchema = z.string().trim().max(2048).refine((value) => {
  if (value === 'about:blank') return true;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}, '启动网址必须是 http/https URL 或 about:blank');

export const CreateSessionRequestSchema = z.object({
  browserId: z.string().trim().min(1, '必须指定浏览器ID').max(128),
  startUrl: StartUrlSchema.optional().default('about:blank'),
  screen: ScreenOptionSchema.default({ width: 1920, height: 1080, depth: 24, dpi: 96 }),
  locale: z.string().trim().min(1).max(32).default('zh-CN'),
  timezone: z.string().trim().min(1).max(64).default('Asia/Shanghai'),
  durationMinutes: z.number().int().min(5).max(1440).default(60),
  recordVideo: z.boolean().default(false),
  acceptInsecureCerts: z.boolean().default(false),
  proxy: z.string().trim().max(2048).optional(),
  hosts: z.record(z.string().max(255)).optional(),
  name: z.string().trim().max(128).optional()
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SessionQuerySchema = z.object({
  status: z.enum(SESSION_STATUSES).optional(),
  userId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});
export type SessionQuery = z.infer<typeof SessionQuerySchema>;

export const ExtendSessionRequestSchema = z.object({
  extendMinutes: z.number().int().min(5).max(60).default(30)
});
export type ExtendSessionRequest = z.infer<typeof ExtendSessionRequestSchema>;

export interface SessionResponse {
  id: string;
  seleniumSessionId: string | null;
  userId: string;
  username?: string;
  browserId: string;
  browserName: string;
  browserVersion: string;
  status: SessionStatus;
  startUrl: string;
  viewerUrl: string;
  viewerToken?: string;
  createdAt: string;
  startedAt: string | null;
  expiresAt: string;
  endedAt: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  screen?: { width: number; height: number; depth?: number; dpi?: number };
  gridUrl?: string;
}
