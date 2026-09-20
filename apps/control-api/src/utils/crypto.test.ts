import assert from 'node:assert';
import { test } from 'node:test';
import {
  generateToken,
  hashPassword,
  verifyPassword,
  verifyToken
} from './crypto.js';

test('password hashing verifies the correct password only', async () => {
  const hash = hashPassword('correct-horse-battery-staple');
  assert.strictEqual(await verifyPassword('correct-horse-battery-staple', hash), true);
  assert.strictEqual(await verifyPassword('wrong-password', hash), false);
});

test('signed token rejects tampering and expires', () => {
  const secret = 'test-secret-that-is-long-enough-for-hmac-validation';
  const token = generateToken({ userId: 'u1', scope: 'test' }, secret, 60);
  assert.strictEqual(verifyToken(token, secret)?.userId, 'u1');

  const parts = token.split('.');
  parts[1] = Buffer.from(JSON.stringify({ userId: 'u2', exp: 9999999999 })).toString('base64url');
  assert.strictEqual(verifyToken(parts.join('.'), secret), null);

  const expired = generateToken({ userId: 'u1' }, secret, -1);
  assert.strictEqual(verifyToken(expired, secret), null);
});
