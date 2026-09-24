import { DatabaseSync } from 'node:sqlite';
import { Config } from '../config.js';

let dbInstance: DatabaseSync | null = null;

export function getDb(config?: Config): DatabaseSync {
  if (dbInstance) return dbInstance;
  if (!config) throw new Error('DB not initialized. Call initDb(config) first.');

  dbInstance = new DatabaseSync(config.dbPath);
  
  // WAL is preferred for native/local filesystems. Docker Desktop bind mounts on
  // Windows are more reliable with DELETE journaling because WAL shared-memory
  // semantics can produce SQLITE_IOERR on the virtualized filesystem.
  const configuredJournalMode = process.env.JINGCANG_SQLITE_JOURNAL_MODE?.trim().toUpperCase();
  const journalMode = configuredJournalMode ||
    (process.env.JINGCANG_CONTAINERIZED === 'true' ? 'DELETE' : 'WAL');
  if (!['WAL', 'DELETE'].includes(journalMode)) {
    throw new Error('JINGCANG_SQLITE_JOURNAL_MODE must be WAL or DELETE');
  }
  dbInstance.exec(`PRAGMA journal_mode = ${journalMode};`);
  dbInstance.exec('PRAGMA foreign_keys = ON;');
  dbInstance.exec('PRAGMA busy_timeout = 5000;');

  initSchema(dbInstance);
  return dbInstance;
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'tester',
      enabled INTEGER NOT NULL DEFAULT 1,
      auth_version INTEGER NOT NULL DEFAULT 1,
      browser_access_policy TEXT NOT NULL DEFAULT 'ALL',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_browser_permissions (
      user_id TEXT NOT NULL,
      browser_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, browser_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (browser_id) REFERENCES browser_catalog(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approval_requests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      title TEXT NOT NULL,
      target_id TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      review_comment TEXT,
      reviewed_by TEXT,
      reviewed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS browser_catalog (
      id TEXT PRIMARY KEY,
      browser_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      version TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'stable',
      image TEXT NOT NULL,
      grid_url TEXT,
      platform TEXT NOT NULL DEFAULT 'linux-amd64',
      enabled INTEGER NOT NULL DEFAULT 1,
      enabled_override INTEGER,
      is_default INTEGER NOT NULL DEFAULT 0,
      capabilities_json TEXT,
      resource_json TEXT,
      source TEXT NOT NULL DEFAULT 'builtin',
      container_id TEXT
    );

    CREATE TABLE IF NOT EXISTS browser_install_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      browser_name TEXT NOT NULL,
      version TEXT NOT NULL,
      image TEXT NOT NULL,
      status TEXT NOT NULL,
      status_message TEXT NOT NULL,
      browser_id TEXT,
      container_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (browser_id) REFERENCES browser_catalog(id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      selenium_session_id TEXT,
      user_id TEXT NOT NULL,
      browser_catalog_id TEXT NOT NULL,
      status TEXT NOT NULL,
      start_url TEXT NOT NULL,
      requested_options_json TEXT,
      resolved_capabilities_json TEXT,
      node_id TEXT,
      container_id TEXT,
      grid_url TEXT,
      resolved_browser_version TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      last_activity_at TEXT,
      expires_at TEXT NOT NULL,
      ended_at TEXT,
      failure_code TEXT,
      failure_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (browser_catalog_id) REFERENCES browser_catalog(id)
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      user_id TEXT,
      session_id TEXT,
      details_json TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const userColumns = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userColumns.some((column) => column.name === 'auth_version')) {
    db.exec('ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 1;');
  }
  if (!userColumns.some((column) => column.name === 'browser_access_policy')) {
    db.exec("ALTER TABLE users ADD COLUMN browser_access_policy TEXT NOT NULL DEFAULT 'ALL';");
  }

  const sessionColumns = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
  if (!sessionColumns.some((column) => column.name === 'last_activity_at')) {
    db.exec('ALTER TABLE sessions ADD COLUMN last_activity_at TEXT;');
  }
  if (!sessionColumns.some((column) => column.name === 'grid_url')) {
    db.exec('ALTER TABLE sessions ADD COLUMN grid_url TEXT;');
  }
  if (!sessionColumns.some((column) => column.name === 'resolved_browser_version')) {
    db.exec('ALTER TABLE sessions ADD COLUMN resolved_browser_version TEXT;');
  }

  const catalogColumns = db.prepare('PRAGMA table_info(browser_catalog)').all() as Array<{ name: string }>;
  if (!catalogColumns.some((column) => column.name === 'source')) {
    db.exec("ALTER TABLE browser_catalog ADD COLUMN source TEXT NOT NULL DEFAULT 'builtin';");
  }
  if (!catalogColumns.some((column) => column.name === 'container_id')) {
    db.exec('ALTER TABLE browser_catalog ADD COLUMN container_id TEXT;');
  }
  if (!catalogColumns.some((column) => column.name === 'enabled_override')) {
    db.exec('ALTER TABLE browser_catalog ADD COLUMN enabled_override INTEGER;');
  }

  const installJobColumns = db.prepare('PRAGMA table_info(browser_install_jobs)').all() as Array<{ name: string }>;
  if (!installJobColumns.some((column) => column.name === 'options_json')) {
    db.exec('ALTER TABLE browser_install_jobs ADD COLUMN options_json TEXT;');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_status_expires ON sessions(status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created_at);
    CREATE INDEX IF NOT EXISTS idx_browser_install_jobs_user_created
      ON browser_install_jobs(user_id, created_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_browser_catalog_vendor_version
      ON browser_catalog(browser_name, version);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_approval_requests_user ON approval_requests(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_browser_permissions_user ON user_browser_permissions(user_id);
  `);
}
