import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

/**
 * 版本化数据库迁移 + 备份/回滚（AND-012 / CORE-003）
 *
 * 设计原则：
 * - 旧表（users / browser_catalog / sessions / artifacts / audit_events 等）仍由 db/index.ts 的
 *   initSchema 负责（基线 schema，视为 version 0）。本模块只承载"多端云测试"新增的设备云表，
 *   以编号迁移方式演进，保证旧会话数据不丢失、异常迁移可回滚。
 * - 每个迁移在独立事务内执行，已应用版本记入 schema_migrations，幂等可重放。
 * - 提供 backupDatabase / restoreDatabase 用于上线前备份与失败回滚。
 */

export interface Migration {
  id: number;
  name: string;
  up: (db: DatabaseSync) => void;
  down?: (db: DatabaseSync) => void;
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'device-cloud-baseline',
    up: (db) => {
      // 统一设备节点注册表
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_nodes (
          node_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          started_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          uptime_seconds INTEGER NOT NULL DEFAULT 0,
          managed_count INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'ONLINE',
          version TEXT,
          enrolled_at TEXT NOT NULL
        );
      `);

      // 已安装、可用的镜像/系统版本 profile（仅展示 verified 的）
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_profiles (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          kind TEXT NOT NULL,
          display_name TEXT NOT NULL,
          os_version TEXT NOT NULL,
          api_level INTEGER,
          model TEXT,
          image_name TEXT,
          arch TEXT,
          abi TEXT,
          screen_json TEXT,
          capabilities_json TEXT,
          managed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
      `);

      // 节点当前发现的设备实例
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_instances (
          node_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          kind TEXT NOT NULL,
          state TEXT NOT NULL,
          booted INTEGER NOT NULL DEFAULT 0,
          last_seen_at TEXT NOT NULL,
          profile_id TEXT,
          capabilities_json TEXT,
          PRIMARY KEY (node_id, device_id)
        );
      `);

      // 设备独占租约（每台设备同一时刻仅一个 READY 租约）
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_leases (
          lease_id TEXT PRIMARY KEY,
          node_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          session_id TEXT NOT NULL UNIQUE,
          user_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          acquired_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          released_at TEXT
        );
      `);

      // 预制镜像清单（离线部署用）
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_images (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          name TEXT NOT NULL,
          version TEXT NOT NULL,
          arch TEXT,
          sha256 TEXT,
          source TEXT NOT NULL DEFAULT 'builtin',
          size_bytes INTEGER,
          created_at TEXT NOT NULL
        );
      `);

      // 设备侧安装任务（APK/IPA）
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_install_jobs (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          platform TEXT NOT NULL,
          name TEXT NOT NULL,
          version TEXT,
          image TEXT,
          device_id TEXT,
          status TEXT NOT NULL,
          status_message TEXT NOT NULL,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);

      // 移动会话（与 legacy sessions 并存，不依赖 browser_catalog_id / selenium_session_id）
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_sessions (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          node_id TEXT NOT NULL DEFAULT 'windows-local-dev',
          start_url TEXT,
          lease_id TEXT,
          viewer_token_hash TEXT,
          profile_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          ended_at TEXT,
          failure_code TEXT,
          failure_message TEXT
        );
      `);
      // 历史开发库升级：早期版本创建的 mobile_sessions 缺少 lease/超时/结束列。
      // 幂等补列，保证旧记录可查询、新迁移可继续执行（expand → backfill）。
      {
        const sessionCols = db.prepare('PRAGMA table_info(mobile_sessions)').all() as Array<{ name: string }>;
        const have = new Set(sessionCols.map((c) => c.name));
        const addColumn = (name: string, ddl: string) => {
          if (!have.has(name)) db.exec(`ALTER TABLE mobile_sessions ADD COLUMN ${name} ${ddl}`);
        };
        addColumn('start_url', 'TEXT');
        addColumn('lease_id', 'TEXT');
        addColumn('viewer_token_hash', 'TEXT');
        addColumn('profile_id', 'TEXT');
        addColumn('expires_at', 'TEXT');
        addColumn('ended_at', 'TEXT');
        addColumn('failure_code', 'TEXT');
        addColumn('failure_message', 'TEXT');
        db.exec("UPDATE mobile_sessions SET expires_at = COALESCE(expires_at, updated_at, created_at) WHERE expires_at IS NULL");
        db.exec("UPDATE mobile_sessions SET created_at = COALESCE(created_at, updated_at) WHERE created_at IS NULL");
        db.exec("UPDATE mobile_sessions SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL");
      }
      db.exec('DROP INDEX IF EXISTS idx_mobile_node_device_active');
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_node_device_active
        ON mobile_sessions(node_id, device_id) WHERE status = 'READY'`);

      // 兼容既有 mobile-devices.ts 路由的节点凭据/设备清单表
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_node_credentials (
          node_id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_agent_nodes (
          node_id TEXT PRIMARY KEY,
          platform TEXT NOT NULL,
          started_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          uptime_seconds INTEGER NOT NULL DEFAULT 0,
          managed_count INTEGER NOT NULL DEFAULT 0
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_node_credentials (
          node_id TEXT PRIMARY KEY,
          token_hash TEXT NOT NULL,
          created_at TEXT NOT NULL,
          revoked_at TEXT
        );
      `);
      db.exec(`
        CREATE TABLE IF NOT EXISTS mobile_node_devices (
          node_id TEXT NOT NULL,
          device_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          state TEXT NOT NULL,
          booted INTEGER NOT NULL DEFAULT 0,
          last_seen_at TEXT NOT NULL,
          PRIMARY KEY (node_id, device_id)
        );
      `);

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_device_leases_active
          ON device_leases(node_id, device_id) WHERE released_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_device_instances_node
          ON device_instances(node_id);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_user
          ON mobile_sessions(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_mobile_sessions_status
          ON mobile_sessions(status, expires_at);
      `);
    },
    down: (db) => {
      db.exec('DROP INDEX IF EXISTS idx_mobile_node_device_active');
      db.exec('DROP INDEX IF EXISTS idx_device_leases_active');
      db.exec('DROP INDEX IF EXISTS idx_device_instances_node');
      db.exec('DROP INDEX IF EXISTS idx_mobile_sessions_user');
      db.exec('DROP INDEX IF EXISTS idx_mobile_sessions_status');
      for (const t of [
        'mobile_node_devices',
        'mobile_node_credentials',
        'mobile_agent_nodes',
        'mobile_sessions',
        'device_node_credentials',
        'device_install_jobs',
        'device_images',
        'device_leases',
        'device_instances',
        'device_profiles',
        'device_nodes'
      ]) {
        db.exec(`DROP TABLE IF EXISTS ${t};`);
      }
    }
  },
  {
    id: 2,
    name: 'node-endpoint-routing',
    up: (db) => {
      // 跨节点设备控制与调度（任务1）：为节点登记"控制面可达 Agent"的端点与
      // 控制面→Agent 调用凭证（AES-256-GCM 加密存储，密钥来自服务端 viewerSecret）。
      // windows-local-dev 保留旧的环境变量解析路径，无需写入端点。
      const mobileColumns = db.prepare('PRAGMA table_info(mobile_agent_nodes)').all() as Array<{ name: string }>;
      if (!mobileColumns.some((c) => c.name === 'agent_url')) {
        db.exec('ALTER TABLE mobile_agent_nodes ADD COLUMN agent_url TEXT');
      }
      if (!mobileColumns.some((c) => c.name === 'agent_token_enc')) {
        db.exec('ALTER TABLE mobile_agent_nodes ADD COLUMN agent_token_enc TEXT');
      }
      const deviceColumns = db.prepare('PRAGMA table_info(device_nodes)').all() as Array<{ name: string }>;
      if (!deviceColumns.some((c) => c.name === 'agent_url')) {
        db.exec('ALTER TABLE device_nodes ADD COLUMN agent_url TEXT');
      }
      if (!deviceColumns.some((c) => c.name === 'agent_token_enc')) {
        db.exec('ALTER TABLE device_nodes ADD COLUMN agent_token_enc TEXT');
      }
    },
    down: (db) => {
      for (const table of ['mobile_agent_nodes', 'device_nodes']) {
        try {
          db.exec(`ALTER TABLE ${table} DROP COLUMN agent_url`);
        } catch {
          /* 列不存在或旧 SQLite 不支持 DROP COLUMN 时忽略 */
        }
        try {
          db.exec(`ALTER TABLE ${table} DROP COLUMN agent_token_enc`);
        } catch {
          /* 同上 */
        }
      }
    }
  },
  {
    id: 3,
    name: 'mobile-sessions-start-url-backfill',
    up: (db) => {
      // 早期开发库在 migration 1 首次应用时可能已补齐部分列但缺少 start_url，
      // 此迁移幂等补齐该列，保证历史会话可继续查询/播放。
      const sessionCols = db.prepare('PRAGMA table_info(mobile_sessions)').all() as Array<{ name: string }>;
      if (!sessionCols.some((c) => c.name === 'start_url')) {
        db.exec('ALTER TABLE mobile_sessions ADD COLUMN start_url TEXT');
      }
    },
    down: (db) => {
      try {
        db.exec('ALTER TABLE mobile_sessions DROP COLUMN start_url');
      } catch {
        /* 列不存在时忽略 */
      }
    }
  }
];

export function getMigrationVersion(db: DatabaseSync): number {
  const row = db
    .prepare('SELECT MAX(version) AS v FROM schema_migrations')
    .get() as { v: number | null };
  return row.v ?? 0;
}

export function runMigrations(db: DatabaseSync): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const appliedSet = new Set(applied.map((r) => r.version));

  const pending = MIGRATIONS.filter((m) => !appliedSet.has(m.id)).sort((a, b) => a.id - b.id);
  for (const migration of pending) {
    const tx = db.prepare('BEGIN IMMEDIATE');
    tx.run();
    try {
      migration.up(db);
      db.prepare('INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
      db.prepare('COMMIT').run();
    } catch (err) {
      db.prepare('ROLLBACK').run();
      throw err;
    }
  }
  return getMigrationVersion(db);
}

/** 回滚到指定版本（不含该版本）。仅执行已定义的 down。 */
export function rollbackTo(db: DatabaseSync, targetVersion: number): number {
  const ordered = [...MIGRATIONS].sort((a, b) => b.id - a.id);
  for (const migration of ordered) {
    if (migration.id <= targetVersion) break;
    if (!migration.down) {
      throw new Error(`迁移 ${migration.id} (${migration.name}) 未定义 down()，无法回滚`);
    }
    const tx = db.prepare('BEGIN IMMEDIATE');
    tx.run();
    try {
      migration.down(db);
      db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migration.id);
      db.prepare('COMMIT').run();
    } catch (err) {
      db.prepare('ROLLBACK').run();
      throw err;
    }
  }
  return getMigrationVersion(db);
}

/**
 * 物理备份数据库（含 -wal / -shm 附属文件）。返回备份目录路径。
 * CORE-003：上线前调用，异常时以 restoreDatabase 还原。
 */
export function backupDatabase(dbPath: string, backupDir?: string): string {
  const dir = backupDir ?? path.dirname(dbPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(dbPath, '.sqlite');
  const target = path.join(dir, `${base}.backup.${stamp}.sqlite`);
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbPath + suffix;
    if (fs.existsSync(src)) fs.copyFileSync(src, target + suffix);
  }
  return target;
}

export function restoreDatabase(backupPath: string, dbPath: string): void {
  if (!fs.existsSync(backupPath)) throw new Error(`备份文件不存在: ${backupPath}`);
  for (const suffix of ['', '-wal', '-shm']) {
    const src = backupPath + suffix;
    if (fs.existsSync(src)) fs.copyFileSync(src, dbPath + suffix);
  }
}

export function listBackups(dbPath: string, backupDir?: string): string[] {
  const dir = backupDir ?? path.dirname(dbPath);
  const base = path.basename(dbPath, '.sqlite');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.backup.`) && f.endsWith('.sqlite'))
    .map((f) => path.join(dir, f))
    .sort()
    .reverse();
}

export { randomUUID };
