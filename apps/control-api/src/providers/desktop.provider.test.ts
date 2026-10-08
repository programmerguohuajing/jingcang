import assert from 'node:assert';
import { test } from 'node:test';
import { SeleniumDesktopProvider } from './desktop.provider.js';
import { OrchestratorService } from '../services/orchestrator.service.js';

// 轻量桩：仅验证 DesktopProvider 把调用正确委托给底层 Orchestrator（兼容层）
class StubOrchestrator extends OrchestratorService {
  calls: string[] = [];
  constructor() {
    // 用任意合法签名构造以避免连接真实 DB（方法不会被真实调用）
    super({} as any, {} as any);
  }
  async createSession(userId: string, username: string, request: any) {
    this.calls.push('createSession');
    return { id: 's1', userId, username, status: 'READY' } as any;
  }
  listSessions(userId: string, isAdmin: boolean, page = 1, pageSize = 20, status?: any, requestedUserId?: string) {
    this.calls.push('listSessions');
    void userId; void isAdmin; void status; void requestedUserId;
    return { items: [], total: 0, page, pageSize, totalPages: 0 };
  }
  getSessionResponse(id: string) {
    this.calls.push('getSessionResponse');
    return { id, status: 'READY' } as any;
  }
  async deleteSessionRecord() {
    this.calls.push('deleteSessionRecord');
    return true;
  }
  async terminateSession() {
    this.calls.push('terminateSession');
    return true;
  }
  async extendSession() {
    this.calls.push('extendSession');
    return { id: 's1' } as any;
  }
}

test('SeleniumDesktopProvider 委托全部会话方法到底层 Orchestrator', async () => {
  const stub = new StubOrchestrator();
  const provider = new SeleniumDesktopProvider({} as any, {} as any, stub as any);
  await provider.createSession('u1', 'alice', {} as any);
  provider.listSessions('u1', false);
  provider.getSessionResponse('s1');
  await provider.deleteSessionRecord('s1', 'u1', false);
  await provider.terminateSession('s1', 'u1', false);
  await provider.extendSession('s1', 'u1', false, 30);
  assert.deepStrictEqual(stub.calls, [
    'createSession',
    'listSessions',
    'getSessionResponse',
    'deleteSessionRecord',
    'terminateSession',
    'extendSession'
  ]);
  // 底层编排器可被 ViewerGateway 等组件访问
  assert.strictEqual(provider.orchestrator, stub);
});
