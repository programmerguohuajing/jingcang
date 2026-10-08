import { Config } from '../config.js';
import { CatalogService } from '../services/catalog.service.js';
import { OrchestratorService } from '../services/orchestrator.service.js';
import {
  CreateSessionRequest,
  SessionResponse,
  SessionStatus
} from '@jingcang/contracts';

/**
 * DesktopProvider（CORE-001）
 *
 * 把"桌面云浏览器"这一能力抽象为统一 Provider 接口，既保留既有 Selenium Grid
 * 实现的全部行为（兼容层），也为后续 Android/iOS Provider 提供一致的会话管理契约。
 *
 * 控制面只依赖 DesktopProvider 接口；具体实现可替换，不影响会话/查看器路由。
 */
export interface DesktopProvider {
  createSession(userId: string, username: string, request: CreateSessionRequest): Promise<SessionResponse>;
  listSessions(
    userId: string,
    isAdmin: boolean,
    page?: number,
    pageSize?: number,
    status?: SessionStatus,
    requestedUserId?: string
  ): any;
  getSessionResponse(sessionId: string): SessionResponse | null;
  deleteSessionRecord(userId: string, requesterId: string, isAdmin: boolean): Promise<boolean>;
  terminateSession(
    sessionId: string,
    userId: string,
    isAdmin: boolean,
    finalStatus?: 'TERMINATED' | 'EXPIRED'
  ): Promise<boolean>;
  extendSession(
    sessionId: string,
    userId: string,
    isAdmin: boolean,
    extendMinutes: number
  ): Promise<SessionResponse>;
  /** 暴露底层编排器，供 ViewerGateway 等需要 Grid 细节的组件使用（兼容层）。 */
  readonly orchestrator: OrchestratorService;
}

/** 基于既有 Selenium Grid Orchestrator 的桌面 Provider 实现（旧接口兼容层）。 */
export class SeleniumDesktopProvider implements DesktopProvider {
  readonly orchestrator: OrchestratorService;

  constructor(config: Config, catalogService: CatalogService, orchestrator?: OrchestratorService) {
    this.orchestrator = orchestrator ?? new OrchestratorService(config, catalogService);
  }

  createSession(userId: string, username: string, request: CreateSessionRequest): Promise<SessionResponse> {
    return this.orchestrator.createSession(userId, username, request);
  }

  listSessions(
    userId: string,
    isAdmin: boolean,
    page?: number,
    pageSize?: number,
    status?: SessionStatus,
    requestedUserId?: string
  ): any {
    return this.orchestrator.listSessions(userId, isAdmin, page, pageSize, status, requestedUserId);
  }

  getSessionResponse(sessionId: string): SessionResponse | null {
    return this.orchestrator.getSessionResponse(sessionId);
  }

  deleteSessionRecord(userId: string, requesterId: string, isAdmin: boolean): Promise<boolean> {
    return this.orchestrator.deleteSessionRecord(userId, requesterId, isAdmin);
  }

  terminateSession(
    sessionId: string,
    userId: string,
    isAdmin: boolean,
    finalStatus?: 'TERMINATED' | 'EXPIRED'
  ): Promise<boolean> {
    return this.orchestrator.terminateSession(sessionId, userId, isAdmin, finalStatus);
  }

  extendSession(
    sessionId: string,
    userId: string,
    isAdmin: boolean,
    extendMinutes: number
  ): Promise<SessionResponse> {
    return this.orchestrator.extendSession(sessionId, userId, isAdmin, extendMinutes);
  }
}

export function createDesktopProvider(config: Config, catalogService: CatalogService): DesktopProvider {
  return new SeleniumDesktopProvider(config, catalogService);
}
