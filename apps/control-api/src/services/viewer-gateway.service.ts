import { Config } from '../config.js';
import { generateToken, verifyToken } from '../utils/crypto.js';
import { OrchestratorService } from './orchestrator.service.js';

export class ViewerGatewayService {
  constructor(
    private config: Config,
    private orchestrator: OrchestratorService
  ) {}

  public issueViewerToken(sessionId: string, userId: string): string {
    const session = this.orchestrator.getSessionResponse(sessionId);
    if (!session) {
      throw new Error('测试舱会话不存在');
    }
    if (!session.seleniumSessionId || session.seleniumSessionId.startsWith('standalone-')) {
      throw new Error('该测试舱未连接到有效的桌面实例 (Selenium Grid 未就绪)，无法建立遥控连线');
    }

    return generateToken(
      { sessionId, userId, scope: 'viewer' },
      this.config.viewerSecret,
      this.config.viewerTokenTtlSeconds
    );
  }

  public validateViewerToken(token: string, expectedSessionId: string): boolean {
    const payload = verifyToken(token, this.config.viewerSecret);
    if (!payload) return false;
    if (payload.scope !== 'viewer') return false;
    if (payload.sessionId !== expectedSessionId) return false;
    return true;
  }

  public getTargetNoVncWebSocketUrl(sessionId: string): string {
    const session = this.orchestrator.getSessionResponse(sessionId);
    if (!session?.seleniumSessionId || session.seleniumSessionId.startsWith('standalone-')) {
      throw new Error('Selenium session is not available or invalid');
    }

    const targetBase = session.gridUrl || this.config.gridUrl;
    const gridUrl = new URL(targetBase);
    gridUrl.protocol = gridUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    gridUrl.pathname = `/session/${encodeURIComponent(session.seleniumSessionId)}/se/vnc`;
    gridUrl.search = '';
    gridUrl.hash = '';
    return gridUrl.toString();
  }
}
