import assert from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { NodeRouterService } from './node-router.service.js';
import { runMigrations } from '../db/migrations.js';
import type { Config } from '../config.js';

const cfg = { rootDir: '/tmp', viewerSecret: 'test-viewer-secret-key-32chars-xxxx' } as unknown as Config;

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  runMigrations(db);
  return db;
}

test('windows-local-dev 从环境变量解析端点（向后兼容）', () => {
  const db = freshDb();
  const router = new NodeRouterService(cfg, db);
  const prevUrl = process.env.JINGCANG_MOBILE_AGENT_URL;
  const prevToken = process.env.JINGCANG_MOBILE_AGENT_TOKEN;
  process.env.JINGCANG_MOBILE_AGENT_URL = 'http://127.0.0.1:19879';
  process.env.JINGCANG_MOBILE_AGENT_TOKEN = 'a'.repeat(64);
  try {
    const resolved = router.resolve('windows-local-dev');
    assert.ok(resolved);
    assert.strictEqual(resolved!.agentUrl, 'http://127.0.0.1:19879');
    assert.strictEqual(resolved!.agentToken, 'a'.repeat(64));
    assert.strictEqual(router.hasNode('windows-local-dev'), true);
  } finally {
    if (prevUrl === undefined) delete process.env.JINGCANG_MOBILE_AGENT_URL;
    else process.env.JINGCANG_MOBILE_AGENT_URL = prevUrl;
    if (prevToken === undefined) delete process.env.JINGCANG_MOBILE_AGENT_TOKEN;
    else process.env.JINGCANG_MOBILE_AGENT_TOKEN = prevToken;
  }
});

test('未配置环境变量时本地节点不可路由', () => {
  const db = freshDb();
  const router = new NodeRouterService(cfg, db);
  const prevUrl = process.env.JINGCANG_MOBILE_AGENT_URL;
  const prevToken = process.env.JINGCANG_MOBILE_AGENT_TOKEN;
  delete process.env.JINGCANG_MOBILE_AGENT_URL;
  delete process.env.JINGCANG_MOBILE_AGENT_TOKEN;
  try {
    assert.strictEqual(router.resolve('windows-local-dev'), null);
    assert.strictEqual(router.hasNode('windows-local-dev'), false);
  } finally {
    if (prevUrl !== undefined) process.env.JINGCANG_MOBILE_AGENT_URL = prevUrl;
    if (prevToken !== undefined) process.env.JINGCANG_MOBILE_AGENT_TOKEN = prevToken;
  }
});

test('凭证加解密往返一致，错误密文返回 null', () => {
  const db = freshDb();
  const router = new NodeRouterService(cfg, db);
  const enc = router.encryptSecret('f'.repeat(64));
  assert.strictEqual(router.decryptSecret(enc), 'f'.repeat(64));
  assert.strictEqual(router.decryptSecret('bad-format'), null);
  assert.strictEqual(router.decryptSecret('v1:00'.repeat(2)), null);
});

test('远程节点 upsertEndpoint 后可按 nodeId 路由，明文不落库', () => {
  const db = freshDb();
  const router = new NodeRouterService(cfg, db);
  const token = 'f'.repeat(64);
  router.upsertEndpoint('node-remote-1', 'https://agent.example.com:9443', router.encryptSecret(token));
  const resolved = router.resolve('node-remote-1');
  assert.ok(resolved);
  assert.strictEqual(resolved!.agentUrl, 'https://agent.example.com:9443');
  assert.strictEqual(resolved!.agentToken, token);

  // 数据库只存密文，不存明文
  const row = db.prepare('SELECT agent_url, agent_token_enc FROM mobile_agent_nodes WHERE node_id=?').get('node-remote-1') as any;
  assert.strictEqual(row.agent_url, 'https://agent.example.com:9443');
  assert.ok(row.agent_token_enc);
  assert.ok(!row.agent_token_enc.includes(token));

  // device_nodes 桥接同步
  const drow = db.prepare('SELECT agent_url FROM device_nodes WHERE node_id=?').get('node-remote-1') as any;
  assert.ok(drow && drow.agent_url === 'https://agent.example.com:9443');
});

test('失联判定：心跳超时或撤销节点进入 offlineNodeIds', () => {
  const db = freshDb();
  const router = new NodeRouterService(cfg, db, 45000);
  router.upsertEndpoint('node-fresh', 'http://127.0.0.1:19901', router.encryptSecret('a'.repeat(64)));
  db.prepare('UPDATE mobile_agent_nodes SET last_seen_at = ? WHERE node_id = ?').run(
    new Date().toISOString(),
    'node-fresh'
  );
  assert.strictEqual(router.isOnline('node-fresh'), true);

  router.upsertEndpoint('node-stale', 'http://127.0.0.1:19902', router.encryptSecret('b'.repeat(64)));
  db.prepare('UPDATE mobile_agent_nodes SET last_seen_at = ? WHERE node_id = ?').run(
    new Date(Date.now() - 120000).toISOString(),
    'node-stale'
  );
  assert.strictEqual(router.isOnline('node-stale'), false);

  router.upsertEndpoint('node-revoked', 'http://127.0.0.1:19903', router.encryptSecret('c'.repeat(64)));
  db.prepare('UPDATE mobile_agent_nodes SET last_seen_at = ? WHERE node_id = ?').run(
    new Date().toISOString(),
    'node-revoked'
  );
  db.prepare('INSERT INTO mobile_node_credentials(node_id, token_hash, created_at, revoked_at) VALUES(?,?,?,?)').run(
    'node-revoked',
    '0'.repeat(64),
    new Date().toISOString(),
    new Date().toISOString()
  );
  assert.strictEqual(router.isOnline('node-revoked'), false);

  const offline = router.offlineNodeIds();
  assert.ok(offline.has('node-stale'));
  assert.ok(offline.has('node-revoked'));
  assert.ok(!offline.has('node-fresh'));
});

test('routableNodeIds 仅返回在线且已登记端点节点', () => {
  const db = freshDb();
  const router = new NodeRouterService(cfg, db, 45000);
  router.upsertEndpoint('node-ok', 'http://127.0.0.1:19911', router.encryptSecret('d'.repeat(64)));
  db.prepare('UPDATE mobile_agent_nodes SET last_seen_at = ? WHERE node_id = ?').run(new Date().toISOString(), 'node-ok');
  router.upsertEndpoint('node-late', 'http://127.0.0.1:19912', router.encryptSecret('e'.repeat(64)));
  db.prepare('UPDATE mobile_agent_nodes SET last_seen_at = ? WHERE node_id = ?').run(
    new Date(Date.now() - 120000).toISOString(),
    'node-late'
  );
  const routable = router.routableNodeIds();
  assert.deepStrictEqual(routable.sort(), ['node-ok']);
});

test('probe 对不可达端点返回 false（确认失联）', async () => {
  const db = freshDb();
  const router = new NodeRouterService(cfg, db);
  router.upsertEndpoint('node-dead', 'http://127.0.0.1:1', router.encryptSecret('9'.repeat(64)));
  const reachable = await router.probe('node-dead', 1500);
  assert.strictEqual(reachable, false);
});