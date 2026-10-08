import assert from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runMigrations,
  getMigrationVersion,
  rollbackTo,
  backupDatabase,
  restoreDatabase,
  listBackups
} from './migrations.js';

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

test('runMigrations 创建设备云表并记录版本', () => {
  const db = freshDb();
  const version = runMigrations(db);
  assert.strictEqual(version, 4);

  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
    .map((r) => r.name);
  for (const t of [
    'device_nodes',
    'device_profiles',
    'device_instances',
    'device_leases',
    'device_images',
    'device_install_jobs',
    'mobile_sessions',
    'mobile_agent_nodes',
    'mobile_node_credentials',
    'mobile_node_devices',
    'mobile_session_artifacts',
    'schema_migrations'
  ]) {
    assert.ok(tables.includes(t), `缺少表 ${t}`);
  }

  // 幂等：重复执行不应变更版本或报错
  assert.strictEqual(runMigrations(db), 4);
});

test('mobile_sessions 含 node_id 与 READY 独占索引', () => {
  const db = freshDb();
  runMigrations(db);
  const cols = db.prepare('PRAGMA table_info(mobile_sessions)').all() as Array<{ name: string }>;
  assert.ok(cols.some((c) => c.name === 'node_id'));

  db.prepare("INSERT INTO mobile_sessions(id,device_id,user_id,mode,status,node_id,created_at,updated_at,expires_at) VALUES('s1','d1','u1','phone','READY','n1',?,?,?)")
    .run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  // 同节点同设备第二个 READY 应因唯一索引失败
  assert.throws(() => {
    db.prepare("INSERT INTO mobile_sessions(id,device_id,user_id,mode,status,node_id,created_at,updated_at,expires_at) VALUES('s2','d1','u2','phone','READY','n1',?,?,?)")
      .run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  });
});

test('rollbackTo 回滚迁移并重建成功', () => {
  const db = freshDb();
  runMigrations(db);
  assert.strictEqual(rollbackTo(db, 0), 0);
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>)
    .map((r) => r.name);
  assert.ok(!tables.includes('device_nodes'));

  // 可再次前向应用
  assert.strictEqual(runMigrations(db), 4);
});

test('历史开发库 mobile_sessions 表被幂等补列与 backfill', () => {
  const db = freshDb();
  // 模拟早期开发库已存在精简版 mobile_sessions：缺少 lease/超时/结束列
  db.exec(`
    CREATE TABLE mobile_sessions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      node_id TEXT NOT NULL DEFAULT 'windows-local-dev',
      start_url TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(
    "INSERT INTO mobile_sessions(id,device_id,user_id,mode,status,node_id,created_at,updated_at) VALUES('s0','d0','u0','phone','QUEUED','n0',?,?)"
  ).run(new Date().toISOString(), new Date().toISOString());

  const version = runMigrations(db);
  assert.strictEqual(version, 4);

  const cols = (db.prepare('PRAGMA table_info(mobile_sessions)').all() as Array<{ name: string }>).map(
    (c) => c.name
  );
  for (const c of [
    'lease_id',
    'viewer_token_hash',
    'profile_id',
    'expires_at',
    'ended_at',
    'failure_code',
    'failure_message'
  ]) {
    assert.ok(cols.includes(c), `旧表缺少补列 ${c}`);
  }

  // 旧记录被 backfill：expires_at 被填充、仍可查询
  const row = db.prepare('SELECT expires_at FROM mobile_sessions WHERE id=?').get('s0') as {
    expires_at: string | null;
  };
  assert.ok(row.expires_at, '旧记录 expires_at 未被 backfill');

  // 新会话可写入新列（SessionCoreService 依赖 lease_id / profile_id）
  db.prepare(
    "INSERT INTO mobile_sessions(id,device_id,user_id,mode,status,node_id,lease_id,profile_id,created_at,updated_at,expires_at) VALUES('s1','d1','u1','phone','READY','n1','L1','P1',?,?,?)"
  ).run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
  assert.ok(db.prepare('SELECT id FROM mobile_sessions WHERE id=?').get('s1'));

  // 幂等：再次执行不改版本
  assert.strictEqual(runMigrations(db), 4);
});

test('backupDatabase / restoreDatabase 物理备份还原', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-mig-'));
  const dbPath = path.join(dir, 'test.sqlite');
  try {
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA foreign_keys = ON;');
    runMigrations(db);
    db.prepare("INSERT INTO device_nodes(node_id,platform,started_at,last_seen_at,uptime_seconds,managed_count,status,enrolled_at) VALUES('n1','windows',?,?,'0','0','ONLINE',?)")
      .run(new Date().toISOString(), new Date().toISOString(), new Date().toISOString());
    db.close();

    const backup = backupDatabase(dbPath, dir);
    assert.ok(fs.existsSync(backup));

    // 破坏原库
    fs.rmSync(dbPath);
    const broken = new DatabaseSync(dbPath);
    try {
      assert.throws(() => broken.prepare('SELECT * FROM device_nodes').get());
    } finally {
      broken.close();
    }

    restoreDatabase(backup, dbPath);
    const restored = new DatabaseSync(dbPath);
    const row = restored.prepare('SELECT node_id FROM device_nodes WHERE node_id=?').get('n1') as
      | { node_id: string }
      | undefined;
    assert.ok(row);
    restored.close();

    const backups = listBackups(dbPath, dir);
    assert.ok(backups.length >= 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
