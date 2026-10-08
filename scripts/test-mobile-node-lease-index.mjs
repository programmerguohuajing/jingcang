import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const db=new DatabaseSync(':memory:');
db.exec("CREATE TABLE mobile_sessions (id TEXT PRIMARY KEY,device_id TEXT NOT NULL,user_id TEXT NOT NULL,mode TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); CREATE UNIQUE INDEX idx_mobile_device_active ON mobile_sessions(device_id) WHERE status='READY';");
db.prepare("INSERT INTO mobile_sessions VALUES(?,?,?,?,?,?,?)").run('legacy','emulator-5554','u','phone','READY','2026-10-08','2026-10-08');
db.exec("ALTER TABLE mobile_sessions ADD COLUMN node_id TEXT NOT NULL DEFAULT 'windows-local-dev'");
db.exec('BEGIN IMMEDIATE');
try {
 db.exec('DROP INDEX IF EXISTS idx_mobile_device_active');
 db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_node_device_active ON mobile_sessions(node_id,device_id) WHERE status='READY'");
 db.exec('COMMIT');
}catch(error){db.exec('ROLLBACK');throw error}
assert.equal(db.prepare("SELECT node_id FROM mobile_sessions WHERE id='legacy'").get().node_id,'windows-local-dev');
console.log('LEGACY_LEASE_NODE_MIGRATION=PASS');
assert.throws(()=>db.prepare("INSERT INTO mobile_sessions(id,device_id,user_id,mode,status,created_at,updated_at,node_id) VALUES(?,?,?,?,?,?,?,?)").run('duplicate','emulator-5554','v','phone','READY','2026-10-08','2026-10-08','windows-local-dev'));
console.log('SAME_NODE_EXCLUSIVE_LEASE=PASS');
db.prepare("INSERT INTO mobile_sessions(id,device_id,user_id,mode,status,created_at,updated_at,node_id) VALUES(?,?,?,?,?,?,?,?)").run('other','emulator-5554','v','phone','READY','2026-10-08','2026-10-08','other-node');
console.log('CROSS_NODE_SAME_SERIAL_ALLOWED=PASS');
assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name='idx_mobile_device_active'").get().n,0);
console.log('OLD_INDEX_DROPPED=PASS');
db.close();
