import assert from 'node:assert';
import { test } from 'node:test';
import {
  LoginRequestSchema,
  CreateSessionRequestSchema,
  ExtendSessionRequestSchema,
  SessionQuerySchema,
  BrowserInstallRequestSchema,
  SESSION_STATUSES
} from './index.js';

test('LoginRequestSchema validation', () => {
  const valid = LoginRequestSchema.safeParse({ username: 'admin', password: 'password123' });
  assert.strictEqual(valid.success, true);

  const invalid = LoginRequestSchema.safeParse({ username: '', password: '' });
  assert.strictEqual(invalid.success, false);
});

test('CreateSessionRequestSchema validation & defaults', () => {
  const parse = CreateSessionRequestSchema.safeParse({ browserId: 'chrome-stable' });
  assert.strictEqual(parse.success, true);
  if (parse.success) {
    assert.strictEqual(parse.data.durationMinutes, 60);
    assert.strictEqual(parse.data.startUrl, 'about:blank');
    assert.strictEqual(parse.data.screen.width, 1920);
  }

  const customParse = CreateSessionRequestSchema.safeParse({
    browserId: 'chrome-stable',
    screen: { width: 390, height: 844, depth: 24, dpi: 96 }
  });
  assert.strictEqual(customParse.success, true);
  if (customParse.success) {
    assert.strictEqual(customParse.data.screen.width, 390);
    assert.strictEqual(customParse.data.screen.height, 844);
  }

  const outOfRange = CreateSessionRequestSchema.safeParse({
    browserId: 'chrome-stable',
    screen: { width: 100, height: 100 }
  });
  assert.strictEqual(outOfRange.success, false);
});

test('SESSION_STATUSES list integrity', () => {
  assert.ok(SESSION_STATUSES.includes('READY'));
  assert.ok(SESSION_STATUSES.includes('QUEUED'));
  assert.ok(SESSION_STATUSES.includes('TERMINATED'));
});

test('ExtendSessionRequestSchema rejects out-of-range values', () => {
  assert.strictEqual(ExtendSessionRequestSchema.safeParse({ extendMinutes: 0 }).success, false);
  assert.strictEqual(ExtendSessionRequestSchema.safeParse({ extendMinutes: 61 }).success, false);
});

test('SessionQuerySchema coerces pagination and validates status', () => {
  const valid = SessionQuerySchema.safeParse({ page: '2', pageSize: '50', status: 'READY' });
  assert.strictEqual(valid.success, true);
  if (valid.success) {
    assert.strictEqual(valid.data.page, 2);
    assert.strictEqual(valid.data.pageSize, 50);
    assert.strictEqual(valid.data.status, 'READY');
  }

  assert.strictEqual(SessionQuerySchema.safeParse({ status: 'INVALID' }).success, false);
});

test('BrowserInstallRequestSchema accepts safe image tags only', () => {
  assert.strictEqual(
    BrowserInstallRequestSchema.safeParse({ browserName: 'chrome', version: '130.0' }).success,
    true
  );
  assert.strictEqual(
    BrowserInstallRequestSchema.safeParse({ browserName: 'firefox', version: '4.35.0-20250909' }).success,
    true
  );
  assert.strictEqual(
    BrowserInstallRequestSchema.safeParse({ browserName: 'safari', version: '18.0' }).success,
    false
  );
  assert.strictEqual(
    BrowserInstallRequestSchema.safeParse({ browserName: 'chrome', version: '../latest' }).success,
    false
  );
  assert.strictEqual(
    BrowserInstallRequestSchema.safeParse({ browserName: 'edge', version: '130:latest' }).success,
    false
  );
});
