import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { CatalogService } from './catalog.service.js';
import { buildW3CCapabilities, transformUrlForContainer } from '@jingcang/browser-catalog';
import { CreateSessionRequest, SessionResponse, SessionStatus, ERROR_CODES } from '@jingcang/contracts';

export class OrchestratorService {
  private queueProcessing = false;

  constructor(
    private config: Config,
    private catalogService: CatalogService
  ) {}

  public async createSession(userId: string, username: string, request: CreateSessionRequest): Promise<SessionResponse> {
    const db = getDb(this.config);
    const browser = this.catalogService.getBrowserById(request.browserId);

    if (!browser || !browser.enabled) {
      throw { code: ERROR_CODES.BROWSER_DISABLED, message: '指定的浏览器舱位未启用或不存在' };
    }

    // Check active concurrency
    const activeCountStmt = db.prepare(`
      SELECT COUNT(*) as count FROM sessions 
      WHERE status IN ('PROVISIONING', 'STARTING', 'READY')
    `);
    const activeCount = (activeCountStmt.get() as any).count;

    if (activeCount >= this.config.sessionMaxConcurrency) {
      // Check queue limit
      const queueCountStmt = db.prepare(`
        SELECT COUNT(*) as count FROM sessions WHERE status = 'QUEUED'
      `);
      const queueCount = (queueCountStmt.get() as any).count;

      if (queueCount >= this.config.sessionQueueLimit) {
        throw { code: ERROR_CODES.QUEUE_FULL, message: '目前测试舱并发和排队均已达到容量上限，请稍后再试' };
      }
    }

    const sessionId = `jc-${crypto.randomUUID().slice(0, 12)}`;
    const now = new Date();
    const durationMins = request.durationMinutes || this.config.sessionDefaultMinutes;
    if (durationMins > this.config.sessionMaxMinutes) {
      throw {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `测试舱时长不能超过 ${this.config.sessionMaxMinutes} 分钟`
      };
    }
    const expiresAt = new Date(now.getTime() + durationMins * 60 * 1000).toISOString();

    const isQueued = activeCount >= this.config.sessionMaxConcurrency;
    const initialStatus: SessionStatus = isQueued ? 'QUEUED' : 'PROVISIONING';

    const insertStmt = db.prepare(`
      INSERT INTO sessions (
        id, selenium_session_id, user_id, browser_catalog_id, status, start_url,
        requested_options_json, resolved_capabilities_json, created_at, last_activity_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transformedUrl = transformUrlForContainer(request.startUrl).url;

    insertStmt.run(
      sessionId,
      null,
      userId,
      browser.id,
      initialStatus,
      transformedUrl,
      JSON.stringify(request),
      JSON.stringify(buildW3CCapabilities(browser, request)),
      now.toISOString(),
      now.toISOString(),
      expiresAt
    );

    if (isQueued) {
      return this.formatSessionResponse(sessionId);
    }

    // Provision session
    return await this.provisionSession(sessionId, browser, request, transformedUrl);
  }

  private async provisionSession(
    sessionId: string,
    browser: any,
    request: CreateSessionRequest,
    targetUrl: string
  ): Promise<SessionResponse> {
    const db = getDb(this.config);

    const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
    if (!sessionCols.some((col) => col.name === 'grid_url')) {
      db.exec('ALTER TABLE sessions ADD COLUMN grid_url TEXT;');
    }
    if (!sessionCols.some((col) => col.name === 'resolved_browser_version')) {
      db.exec('ALTER TABLE sessions ADD COLUMN resolved_browser_version TEXT;');
    }

    const targetGridUrl = browser.gridUrl || this.config.gridUrl;

    try {
      db.prepare("UPDATE sessions SET status = 'STARTING' WHERE id = ?").run(sessionId);

      const capabilities = buildW3CCapabilities(browser, request);
      let seleniumSessionId: string | null = null;
      let nodeId: string | null = null;
      let containerId: string | null = null;
      let resolvedCaps: any = {};

      try {
        const gridRes = await fetch(`${targetGridUrl}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ capabilities }),
          signal: AbortSignal.timeout(10000)
        });

        if (gridRes.ok) {
          const gridData = (await gridRes.json().catch(() => null)) as any;
          seleniumSessionId = gridData?.value?.sessionId || gridData?.sessionId || null;
          resolvedCaps = gridData?.value?.capabilities || {};
          nodeId = resolvedCaps['se:nodeId'] || null;
          containerId = resolvedCaps['se:containerName'] || null;
        } else {
          const errBody = await gridRes.text().catch(() => '');
          console.warn(`[Orchestrator] Grid session creation failed on ${targetGridUrl} (HTTP ${gridRes.status}):`, errBody);
        }

        if (seleniumSessionId) {
          const screen = request.screen || { width: 1920, height: 1080 };
          try {
            await fetch(`${targetGridUrl}/session/${seleniumSessionId}/window/rect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ width: screen.width, height: screen.height, x: 0, y: 0 }),
              signal: AbortSignal.timeout(8000)
            });
          } catch (rectErr) {
            console.warn(`[Orchestrator] Failed to set window rect for ${sessionId}:`, rectErr);
          }

          if (targetUrl && targetUrl !== 'about:blank') {
            try {
              await fetch(`${targetGridUrl}/session/${seleniumSessionId}/url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: targetUrl }),
                signal: AbortSignal.timeout(8000)
              });
            } catch (navErr) {
              console.warn(`[Orchestrator] Initial navigation failed for ${sessionId}:`, navErr);
            }
          }
        }
      } catch (gridErr: any) {
        console.warn(`[Orchestrator] Grid session allocation failed on ${targetGridUrl}:`, gridErr.message || gridErr);
      }

      if (!seleniumSessionId) {
        throw new Error(`无法在目标调度节点 (${targetGridUrl}) 创建浏览器会话，可能服务未就绪或未找到匹配的 ${browser.displayName || browser.browserName} 节点`);
      }

      const actualVersion = resolvedCaps['browserVersion'] || browser.version;
      const startedAt = new Date();
      const durationMinutes = request.durationMinutes || this.config.sessionDefaultMinutes;
      const expiresAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000).toISOString();

      const readyUpdate = db.prepare(`
        UPDATE sessions SET
          status = 'READY',
          selenium_session_id = ?,
          node_id = ?,
          container_id = ?,
          grid_url = ?,
          resolved_browser_version = ?,
          resolved_capabilities_json = ?,
          started_at = ?,
          last_activity_at = ?,
          expires_at = ?,
          failure_code = NULL,
          failure_message = NULL
        WHERE id = ? AND status = 'STARTING'
      `).run(
        seleniumSessionId,
        nodeId,
        containerId,
        targetGridUrl,
        actualVersion,
        JSON.stringify(resolvedCaps),
        startedAt.toISOString(),
        startedAt.toISOString(),
        expiresAt,
        sessionId
      );

      if (readyUpdate.changes !== 1) {
        try {
          await fetch(`${targetGridUrl}/session/${seleniumSessionId}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(8000)
          });
        } catch (cleanupErr) {
          console.warn(`[Orchestrator] Failed to clean raced Grid session ${seleniumSessionId}:`, cleanupErr);
        }
        throw new Error('Session state changed while provisioning');
      }

      return this.formatSessionResponse(sessionId);
    } catch (err: any) {
      const current = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId) as
        | { status: SessionStatus }
        | undefined;

      if (!current || !['TERMINATING', 'TERMINATED', 'EXPIRED'].includes(current.status)) {
        db.prepare(`
          UPDATE sessions SET
            status = 'FAILED',
            failure_code = 'PROVISION_FAILED',
            failure_message = ?,
            ended_at = ?
          WHERE id = ?
        `).run(err.message || '容器启动失败', new Date().toISOString(), sessionId);
      }

      throw { code: ERROR_CODES.INTERNAL_ERROR, message: `测试舱启动失败: ${err.message || '未知错误'}` };
    }
  }

  public async terminateSession(
    sessionId: string,
    userId: string,
    isAdmin: boolean,
    finalStatus: 'TERMINATED' | 'EXPIRED' = 'TERMINATED'
  ): Promise<boolean> {
    const db = getDb(this.config);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;

    if (!session) return false;
    if (!isAdmin && session.user_id !== userId) {
      throw { code: ERROR_CODES.AUTH_FORBIDDEN, message: '无权操作此测试舱' };
    }

    if (['TERMINATED', 'EXPIRED', 'FAILED'].includes(session.status)) {
      return true;
    }

    db.prepare("UPDATE sessions SET status = 'TERMINATING' WHERE id = ?").run(sessionId);

    const targetGrid = session.grid_url || this.config.gridUrl;
    if (session.selenium_session_id && !session.selenium_session_id.startsWith('standalone-')) {
      try {
        await fetch(`${targetGrid}/session/${session.selenium_session_id}`, {
          method: 'DELETE',
          signal: AbortSignal.timeout(8000)
        });
      } catch (err) {
        console.warn(`[Orchestrator] Grid session delete failed for ${session.selenium_session_id} on ${targetGrid}:`, err);
      }
    }

    db.prepare('UPDATE sessions SET status = ?, ended_at = ? WHERE id = ?')
      .run(finalStatus, new Date().toISOString(), sessionId);

    setImmediate(() => {
      this.processQueue().catch((err) =>
        console.warn('[Orchestrator] processQueue background error:', err)
      );
    });

    return true;
  }

  public async deleteSessionRecord(
    sessionId: string,
    userId: string,
    isAdmin: boolean
  ): Promise<boolean> {
    const db = getDb(this.config);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;

    if (!session) return true;
    if (!isAdmin && session.user_id !== userId) {
      throw { code: ERROR_CODES.AUTH_FORBIDDEN, message: '无权删除此测试舱记录' };
    }

    if (!['TERMINATED', 'EXPIRED', 'FAILED', 'LOST', 'ORPHANED'].includes(session.status)) {
      await this.terminateSession(sessionId, userId, isAdmin, 'TERMINATED');
    }

    const artifactDir = path.resolve(this.config.artifactsDir, sessionId);
    if (fs.existsSync(artifactDir)) {
      try {
        fs.rmSync(artifactDir, { recursive: true, force: true });
      } catch (rmErr) {
        console.warn(`[Orchestrator] Failed to remove artifact dir for ${sessionId}:`, rmErr);
      }
    }

    db.prepare('DELETE FROM artifacts WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

    return true;
  }

  public async extendSession(
    sessionId: string,
    userId: string,
    isAdmin: boolean,
    extendMinutes: number
  ): Promise<SessionResponse> {
    const db = getDb(this.config);
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as any;

    if (!session) {
      throw { code: ERROR_CODES.SESSION_NOT_FOUND, message: '测试舱不存在' };
    }
    if (!isAdmin && session.user_id !== userId) {
      throw { code: ERROR_CODES.AUTH_FORBIDDEN, message: '无权延长此测试舱' };
    }
    if (session.status !== 'READY') {
      throw { code: ERROR_CODES.INVALID_REQUEST, message: '只有已就绪的测试舱可以延长时间' };
    }

    const startedAt = new Date(session.started_at || session.created_at).getTime();
    const hardLimit = startedAt + this.config.sessionMaxMinutes * 60 * 1000;
    const currentExpires = new Date(session.expires_at).getTime();
    const requestedExpires = currentExpires + extendMinutes * 60 * 1000;

    if (requestedExpires > hardLimit) {
      throw {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `测试舱总运行时长不能超过 ${this.config.sessionMaxMinutes} 分钟`
      };
    }

    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .run(new Date(requestedExpires).toISOString(), sessionId);
    return this.formatSessionResponse(sessionId);
  }

  public async processQueue(): Promise<void> {
    if (this.queueProcessing) return;
    this.queueProcessing = true;

    try {
      const db = getDb(this.config);

      while (true) {
        const activeCount = (db.prepare(`
          SELECT COUNT(*) as count
          FROM sessions
          WHERE status IN ('PROVISIONING', 'STARTING', 'READY')
        `).get() as any).count;

        if (activeCount >= this.config.sessionMaxConcurrency) break;

        const queued = db.prepare(`
          SELECT *
          FROM sessions
          WHERE status = 'QUEUED'
          ORDER BY created_at ASC
          LIMIT 1
        `).get() as any;

        if (!queued) break;

        if (new Date(queued.expires_at).getTime() <= Date.now()) {
          db.prepare("UPDATE sessions SET status = 'EXPIRED', ended_at = ? WHERE id = ?")
            .run(new Date().toISOString(), queued.id);
          continue;
        }

        const claimed = db.prepare(`
          UPDATE sessions
          SET status = 'PROVISIONING'
          WHERE id = ? AND status = 'QUEUED'
        `).run(queued.id);

        if (claimed.changes !== 1) continue;

        const browser = this.catalogService.getBrowserById(queued.browser_catalog_id);
        if (!browser || !browser.enabled) {
          db.prepare(`
            UPDATE sessions
            SET status = 'FAILED', failure_code = 'BROWSER_DISABLED',
                failure_message = ?, ended_at = ?
            WHERE id = ?
          `).run('浏览器舱位不存在或已禁用', new Date().toISOString(), queued.id);
          continue;
        }

        try {
          const request = JSON.parse(queued.requested_options_json || '{}') as CreateSessionRequest;
          await this.provisionSession(queued.id, browser, request, queued.start_url);
        } catch (err) {
          console.warn(`[Orchestrator] Failed to provision queued session ${queued.id}:`, err);
        }
      }
    } finally {
      this.queueProcessing = false;
    }
  }

  public getSessionResponse(sessionId: string): SessionResponse | null {
    const db = getDb(this.config);
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return null;
    return this.formatSessionResponse(sessionId);
  }

  public async touchSession(sessionId: string): Promise<void> {
    const db = getDb(this.config);
    const nowIso = new Date().toISOString();
    const row = db.prepare(`
      SELECT selenium_session_id FROM sessions
      WHERE id = ? AND status = 'READY'
    `).get(sessionId) as { selenium_session_id?: string | null } | undefined;

    db.prepare(`
      UPDATE sessions
      SET last_activity_at = ?
      WHERE id = ? AND status = 'READY'
    `).run(nowIso, sessionId);

    if (row?.selenium_session_id && !row.selenium_session_id.startsWith('standalone-')) {
      try {
        await fetch(`${this.config.gridUrl}/session/${row.selenium_session_id}/title`, {
          signal: AbortSignal.timeout(3000)
        });
      } catch {
        // ignore ping error
      }
    }
  }

  public listSessions(
    userId: string,
    isAdmin: boolean,
    page: number = 1,
    pageSize: number = 20,
    status?: SessionStatus,
    requestedUserId?: string
  ) {
    const db = getDb(this.config);
    const conditions: string[] = [];
    const params: any[] = [];

    if (!isAdmin) {
      conditions.push('s.user_id = ?');
      params.push(userId);
    } else if (requestedUserId) {
      conditions.push('s.user_id = ?');
      params.push(requestedUserId);
    }

    if (status) {
      conditions.push('s.status = ?');
      params.push(status);
    }

    const whereClause = conditions.length > 0
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const offset = (page - 1) * pageSize;
    const countSql = `SELECT COUNT(*) as count FROM sessions s ${whereClause}`;
    const total = (db.prepare(countSql).get(...params) as any).count;

    const sql = `
      SELECT s.*, u.username, b.browser_name, b.version as browser_version
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      JOIN browser_catalog b ON s.browser_catalog_id = b.id
      ${whereClause}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(sql).all(...params, pageSize, offset) as any[];

    const items = rows.map((r) => {
      let screenOpt: { width: number; height: number; depth?: number; dpi?: number } | undefined;
      try {
        const parsed = JSON.parse(r.requested_options_json || '{}');
        if (parsed.screen) screenOpt = parsed.screen;
      } catch (_) {}

      return {
        id: r.id,
        seleniumSessionId: r.selenium_session_id,
        userId: r.user_id,
        username: r.username,
        browserId: r.browser_catalog_id,
        browserName: r.browser_name,
        browserVersion: r.resolved_browser_version || r.browser_version,
        gridUrl: r.grid_url || undefined,
        status: r.status as SessionStatus,
        startUrl: r.start_url,
        viewerUrl: `/viewer/${r.id}/`,
        createdAt: r.created_at,
        startedAt: r.started_at,
        expiresAt: r.expires_at,
        endedAt: r.ended_at,
        failureCode: r.failure_code,
        failureMessage: r.failure_message,
        screen: screenOpt
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    };
  }

  private formatSessionResponse(sessionId: string): SessionResponse {
    const db = getDb(this.config);
    const r = db.prepare(`
      SELECT s.*, u.username, b.browser_name, b.version as browser_version
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      JOIN browser_catalog b ON s.browser_catalog_id = b.id
      WHERE s.id = ?
    `).get(sessionId) as any;

    if (!r) throw new Error(`Session ${sessionId} not found`);

    let screenOpt: { width: number; height: number; depth?: number; dpi?: number } | undefined;
    try {
      const parsed = JSON.parse(r.requested_options_json || '{}');
      if (parsed.screen) screenOpt = parsed.screen;
    } catch (_) {}

    return {
      id: r.id,
      seleniumSessionId: r.selenium_session_id,
      userId: r.user_id,
      username: r.username,
      browserId: r.browser_catalog_id,
      browserName: r.browser_name,
      browserVersion: r.resolved_browser_version || r.browser_version,
      gridUrl: r.grid_url || undefined,
      status: r.status as SessionStatus,
      startUrl: r.start_url,
      viewerUrl: `/viewer/${r.id}/`,
      createdAt: r.created_at,
      startedAt: r.started_at,
      expiresAt: r.expires_at,
      endedAt: r.ended_at,
      failureCode: r.failure_code,
      failureMessage: r.failure_message,
      screen: screenOpt
    };
  }
}
