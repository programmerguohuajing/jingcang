import assert from 'node:assert';
import { test } from 'node:test';
import crypto from 'node:crypto';
import { ViewerTokenService } from './viewer-token.service.js';

test('issue/verify 绑定四元组且短期有效', () => {
  const svc = new ViewerTokenService('test-secret', 120);
  const token = svc.issue({ sub: 'u1', sid: 's1', did: 'd1', lid: 'l1', node: 'n1', mode: 'phone' });
  const claims = svc.verify(token);
  assert.ok(claims);
  assert.strictEqual(claims!.sub, 'u1');
  assert.strictEqual(claims!.sid, 's1');
  assert.strictEqual(claims!.did, 'd1');
  assert.strictEqual(claims!.lid, 'l1');
  assert.strictEqual(claims!.node, 'n1');
  assert.strictEqual(claims!.mode, 'phone');
});

test('篡改令牌签名或载荷导致校验失败', () => {
  const svc = new ViewerTokenService('test-secret', 120);
  const token = svc.issue({ sub: 'u1', sid: 's1', did: 'd1', lid: 'l1', node: 'n1', mode: 'phone' });
  const [p, s] = token.split('.');
  assert.strictEqual(svc.verify(`${p}.` + 'AAAA'), null);
  assert.strictEqual(svc.verify('garbage'), null);
});

test('过期令牌被拒绝', () => {
  const svc = new ViewerTokenService('test-secret', 1);
  const token = svc.issue({ sub: 'u1', sid: 's1', did: 'd1', lid: 'l1', node: 'n1', mode: 'browser' });
  // 快进时间
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 2000;
    assert.strictEqual(svc.verify(token), null);
  } finally {
    Date.now = realNow;
  }
});

test('不同密钥签发无法互验', () => {
  const a = new ViewerTokenService('secret-A', 120);
  const b = new ViewerTokenService('secret-B', 120);
  const token = a.issue({ sub: 'u1', sid: 's1', did: 'd1', lid: 'l1', node: 'n1', mode: 'phone' });
  assert.strictEqual(b.verify(token), null);
});

test('verifyNodeCredential 比对 64-hex 明文与 SHA-256 摘要', () => {
  const bearer = 'a'.repeat(64);
  const stored = crypto.createHash('sha256').update(bearer).digest('hex');
  assert.strictEqual(ViewerTokenService.verifyNodeCredential(bearer, stored), true);
  assert.strictEqual(ViewerTokenService.verifyNodeCredential('b'.repeat(64), stored), false);
  assert.strictEqual(ViewerTokenService.verifyNodeCredential('short', stored), false);
});
