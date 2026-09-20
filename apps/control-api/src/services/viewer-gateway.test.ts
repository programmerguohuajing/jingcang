import assert from 'node:assert';
import { test } from 'node:test';
import { ViewerGatewayService } from './viewer-gateway.service.js';

test('ViewerGatewayService rejects standalone sessions with no active desktop', () => {
  const mockConfig: any = {
    viewerSecret: 'test-secret-at-least-32-characters-long!!',
    viewerTokenTtlSeconds: 120,
    gridUrl: 'http://127.0.0.1:4444'
  };

  const mockOrchestrator: any = {
    getSessionResponse(sessionId: string) {
      if (sessionId === 'standalone-session') {
        return {
          id: 'standalone-session',
          seleniumSessionId: 'standalone-mock-id',
          status: 'READY'
        };
      }
      if (sessionId === 'valid-session') {
        return {
          id: 'valid-session',
          seleniumSessionId: 'real-webdriver-session-123',
          status: 'READY'
        };
      }
      return null;
    }
  };

  const gateway = new ViewerGatewayService(mockConfig, mockOrchestrator);

  assert.throws(
    () => gateway.issueViewerToken('standalone-session', 'u1'),
    /未连接到有效的桌面实例/
  );

  assert.throws(
    () => gateway.getTargetNoVncWebSocketUrl('standalone-session'),
    /Selenium session is not available or invalid/
  );

  const token = gateway.issueViewerToken('valid-session', 'u1');
  assert.strictEqual(typeof token, 'string');
  assert.strictEqual(gateway.validateViewerToken(token, 'valid-session'), true);
  assert.strictEqual(gateway.validateViewerToken(token, 'wrong-session'), false);

  const wsUrl = gateway.getTargetNoVncWebSocketUrl('valid-session');
  assert.strictEqual(wsUrl, 'ws://127.0.0.1:4444/session/real-webdriver-session-123/se/vnc');
});
