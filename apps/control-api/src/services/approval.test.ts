import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AuthService } from './auth.service.js';
import { ApprovalService } from './approval.service.js';
import { CatalogService } from './catalog.service.js';
import { Config } from '../config.js';

function createMockConfig(): Config {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jc-test-'));
  const dbPath = path.join(tmpDir, 'test.sqlite');

  return {
    rootDir: tmpDir,
    port: 9999,
    bindHost: '127.0.0.1',
    baseUrl: 'http://127.0.0.1:9999',
    publicHostname: '127.0.0.1',
    timezone: 'Asia/Shanghai',
    sessionDefaultMinutes: 60,
    sessionMaxMinutes: 120,
    sessionIdleMinutes: 15,
    sessionMaxConcurrency: 5,
    sessionQueueLimit: 10,
    artifactRetentionDays: 7,
    artifactMaxTotalGb: 10,
    gridUrl: 'http://127.0.0.1:4444',
    viewerTokenTtlSeconds: 300,
    lanAccessEnabled: false,
    trustProxy: false,
    sessionSecret: 'test-secret-1234567890123456789012',
    viewerSecret: 'test-secret-1234567890123456789012',
    adminInitialPassword: 'test-admin-pwd',
    dbPath,
    artifactsDir: path.join(tmpDir, 'artifacts'),
    logsDir: path.join(tmpDir, 'logs'),
    catalogYamlPath: path.join(tmpDir, 'catalog.yaml')
  };
}

test('AuthService & ApprovalService permissions workflow', async () => {
  const config = createMockConfig();
  const authService = new AuthService(config);
  authService.bootstrapAdmin();

  const catalogService = new CatalogService(config);
  catalogService.loadAndSyncCatalog();

  const approvalService = new ApprovalService(config, authService, catalogService);

  // 1. Create a regular user
  const user = await authService.createUser('testuser', 'password123', 'tester');
  assert.equal(user.username, 'testuser');
  assert.equal(user.browserAccessPolicy, 'ALL');

  // 2. By default with ALL policy, any browser is permitted
  const check1 = authService.checkUserBrowserPermission(user.id, 'chrome-stable');
  assert.equal(check1.permitted, true);

  // 3. Set custom permissions with only chrome-stable
  authService.updateUserBrowserPermissions(user.id, 'CUSTOM', ['chrome-stable']);
  const allowed = authService.getUserAllowedBrowsers(user.id);
  assert.equal(allowed.policy, 'CUSTOM');
  assert.deepEqual(allowed.allowedBrowserIds, ['chrome-stable']);

  // 4. Now chrome-stable is permitted, edge-stable is not
  assert.equal(authService.checkUserBrowserPermission(user.id, 'chrome-stable').permitted, true);
  const checkEdge = authService.checkUserBrowserPermission(user.id, 'edge-stable');
  assert.equal(checkEdge.permitted, false);

  // 5. Submit approval request for edge-stable
  const request = approvalService.createRequest(user.id, user.username, {
    type: 'BROWSER_ACCESS',
    targetId: 'edge-stable',
    reason: 'Need Edge browser for compatibility testing'
  });
  assert.equal(request.status, 'PENDING');
  assert.equal(request.userId, user.id);

  // Duplicate request check
  assert.throws(() => {
    approvalService.createRequest(user.id, user.username, {
      type: 'BROWSER_ACCESS',
      targetId: 'edge-stable',
      reason: 'Repeat request'
    });
  }, /已有相同目标的审批申请/);

  // 6. Admin reviews and approves the request
  const reviewed = approvalService.reviewRequest(
    request.id,
    'admin-id',
    'admin',
    { action: 'APPROVE', comment: '准予使用' }
  );
  assert.equal(reviewed.status, 'APPROVED');
  assert.equal(reviewed.reviewedBy, 'admin');

  // 7. User now has access to edge-stable
  assert.equal(authService.checkUserBrowserPermission(user.id, 'edge-stable').permitted, true);
  assert.equal(authService.checkUserBrowserPermission(user.id, 'chrome-stable').permitted, true);
  assert.equal(authService.checkUserBrowserPermission(user.id, 'firefox-stable').permitted, false);

  // 8. Cannot review an already reviewed request
  assert.throws(() => {
    approvalService.reviewRequest(request.id, 'admin-id', 'admin', { action: 'REJECT' });
  }, /无法重复操作/);
});
