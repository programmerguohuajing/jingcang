import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

export interface Config {
  rootDir: string;
  port: number;
  bindHost: string;
  baseUrl: string;
  publicHostname: string;
  timezone: string;
  sessionDefaultMinutes: number;
  sessionMaxMinutes: number;
  sessionIdleMinutes: number;
  sessionMaxConcurrency: number;
  sessionQueueLimit: number;
  artifactRetentionDays: number;
  artifactMaxTotalGb: number;
  gridUrl: string;
  viewerTokenTtlSeconds: number;
  lanAccessEnabled: boolean;
  trustProxy: boolean;
  sessionSecret: string;
  viewerSecret: string;
  adminInitialPassword: string;
  dbPath: string;
  artifactsDir: string;
  logsDir: string;
  catalogYamlPath: string;
}

function findProjectRoot(startDir: string): string {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml')) || fs.existsSync(path.join(current, '.env'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDir);
    current = parent;
  }
}

function requireSecret(name: string, minLength: number): string {
  const value = process.env[name]?.trim();
  const legacyDefaults = new Set([
    'jingcang-default-session-secret-key-32chars',
    'jingcang-default-viewer-secret-key-32chars',
    'admin-initial-password-123'
  ]);

  if (
    !value ||
    value.length < minLength ||
    value.startsWith('change-me-') ||
    legacyDefaults.has(value)
  ) {
    throw new Error(
      `[Config] ${name} must be configured securely (minimum ${minLength} characters). Run scripts/bootstrap.ps1 first.`
    );
  }
  return value;
}

function readInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`[Config] ${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function readBoolean(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`[Config] ${name} must be either true or false`);
}

function validateHttpUrl(name: string, raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[Config] ${name} must be a valid absolute URL`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`[Config] ${name} must use http or https`);
  }
  return parsed.toString().replace(/\/$/, '');
}

function readHttpUrl(name: string, fallback: string): string {
  return validateHttpUrl(name, process.env[name]?.trim() || fallback);
}

function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function loadConfig(): Config {
  const rootDir = path.resolve(process.env.JINGCANG_ROOT || findProjectRoot(process.cwd()));
  const envPath = path.join(rootDir, '.env');
  if (fs.existsSync(envPath)) dotenv.config({ path: envPath, override: false });

  const sessionSecret = requireSecret('JINGCANG_SESSION_SECRET', 32);
  const viewerSecret = requireSecret('JINGCANG_VIEWER_SECRET', 32);
  const adminInitialPassword = requireSecret('JINGCANG_ADMIN_INITIAL_PASSWORD', 12);

  const lanAccessEnabled = readBoolean('JINGCANG_LAN_ACCESS_ENABLED');
  const containerized = readBoolean('JINGCANG_CONTAINERIZED');
  const bindHost = process.env.JINGCANG_BIND_HOST?.trim() || '127.0.0.1';
  if (!containerized && !lanAccessEnabled && !isLoopbackHost(bindHost)) {
    throw new Error('[Config] Refusing non-loopback bind while JINGCANG_LAN_ACCESS_ENABLED=false');
  }

  const baseUrl = readHttpUrl('JINGCANG_BASE_URL', 'http://localhost:8088');
  let rawGridUrl = process.env.JINGCANG_GRID_URL?.trim() || 'http://selenium-docker:4444';
  if (!containerized && rawGridUrl.includes('selenium-docker')) {
    rawGridUrl = rawGridUrl.replace('selenium-docker', '127.0.0.1');
  }
  const gridUrl = validateHttpUrl('JINGCANG_GRID_URL', rawGridUrl);

  const sessionDefaultMinutes = readInt('JINGCANG_SESSION_DEFAULT_MINUTES', 60, 5, 1440);
  const sessionMaxMinutes = readInt('JINGCANG_SESSION_MAX_MINUTES', 120, 5, 1440);
  if (sessionDefaultMinutes > sessionMaxMinutes) {
    throw new Error('[Config] JINGCANG_SESSION_DEFAULT_MINUTES cannot exceed JINGCANG_SESSION_MAX_MINUTES');
  }

  // Create directories if missing
  const dbDir = path.resolve(rootDir, 'data/db');
  const artifactsDir = path.resolve(rootDir, 'data/artifacts');
  const logsDir = path.resolve(rootDir, 'data/logs');
  
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(artifactsDir)) fs.mkdirSync(artifactsDir, { recursive: true });
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

  const catalogYamlPath = path.resolve(rootDir, 'deploy/selenium/browser-catalog.yaml');

  return {
    rootDir,
    port: readInt('JINGCANG_PORT', 8088, 1, 65535),
    bindHost,
    baseUrl,
    publicHostname: process.env.JINGCANG_PUBLIC_HOSTNAME?.trim() || 'jingcang.localhost',
    timezone: process.env.JINGCANG_TIMEZONE?.trim() || 'Asia/Shanghai',
    sessionDefaultMinutes,
    sessionMaxMinutes,
    sessionIdleMinutes: readInt('JINGCANG_SESSION_IDLE_MINUTES', 30, 0, 1440),
    sessionMaxConcurrency: readInt('JINGCANG_SESSION_MAX_CONCURRENCY', 4, 1, 100),
    sessionQueueLimit: readInt('JINGCANG_SESSION_QUEUE_LIMIT', 10, 0, 10000),
    artifactRetentionDays: readInt('JINGCANG_ARTIFACT_RETENTION_DAYS', 7, 0, 3650),
    artifactMaxTotalGb: readInt('JINGCANG_ARTIFACT_MAX_TOTAL_GB', 50, 1, 10240),
    gridUrl,
    viewerTokenTtlSeconds: readInt('JINGCANG_VIEWER_TOKEN_TTL_SECONDS', 120, 30, 3600),
    lanAccessEnabled,
    trustProxy: readBoolean('JINGCANG_TRUST_PROXY'),
    sessionSecret,
    viewerSecret,
    adminInitialPassword,
    dbPath: path.resolve(dbDir, 'jingcang.sqlite'),
    artifactsDir,
    logsDir,
    catalogYamlPath
  };
}
