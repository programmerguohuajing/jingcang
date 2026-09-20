import fs from 'fs';
import path from 'path';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { OrchestratorService } from './orchestrator.service.js';

interface ArtifactRow {
  id: string;
  relative_path: string;
  size_bytes: number;
  created_at: string;
}

export class WorkerService {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private config: Config,
    private orchestrator: OrchestratorService
  ) {}

  public start(): void {
    if (this.timer) return;

    this.repairLegacyPrematureExpiryStatuses();
    this.resetIdleBaselineAfterRestart();

    this.timer = setInterval(() => {
      this.runPeriodicTasks().catch((err) => {
        console.error('[WorkerService] Periodic task error:', err);
      });
    }, 30000);

    this.runPeriodicTasks().catch((err) => {
      console.error('[WorkerService] Initial periodic task error:', err);
    });
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public async runPeriodicTasks(): Promise<{
    expiredCount: number;
    idleTerminatedCount: number;
    cleanedArtifacts: number;
  }> {
    await this.maintainActiveSessions();
    const expiredCount = await this.sweepExpiredSessions();
    const idleTerminatedCount = await this.sweepIdleSessions();
    const cleanedArtifacts = this.cleanupArtifacts();
    await this.orchestrator.processQueue();
    return { expiredCount, idleTerminatedCount, cleanedArtifacts };
  }

  private async sweepExpiredSessions(): Promise<number> {
    const db = getDb(this.config);
    const now = new Date();
    const nowIso = now.toISOString();
    const expiredRows = db.prepare(`
      SELECT id, status
      FROM sessions
      WHERE status IN ('QUEUED', 'PROVISIONING', 'STARTING', 'READY')
        AND expires_at <= ?
    `).all(nowIso) as Array<{ id: string; status: string }>;

    let count = 0;
    for (const row of expiredRows) {
      try {
        if (row.status === 'QUEUED') {
          const result = db.prepare(`
            UPDATE sessions
            SET status = 'EXPIRED', ended_at = ?
            WHERE id = ? AND status = 'QUEUED'
          `).run(nowIso, row.id);
          count += Number(result.changes);
          continue;
        }

        await this.orchestrator.terminateSession(row.id, 'system', true, 'EXPIRED');
        count++;
      } catch (err) {
        console.error(`[WorkerService] Error expiring session ${row.id}:`, err);
      }
    }

    return count;
  }

  private async sweepIdleSessions(): Promise<number> {
    if (this.config.sessionIdleMinutes <= 0) return 0;

    const db = getDb(this.config);
    const now = new Date();
    const nowIso = now.toISOString();
    const idleCutoff = new Date(
      now.getTime() - this.config.sessionIdleMinutes * 60 * 1000
    ).toISOString();

    const idleRows = db.prepare(`
      SELECT id
      FROM sessions
      WHERE status = 'READY'
        AND expires_at > ?
        AND COALESCE(last_activity_at, started_at, created_at) <= ?
    `).all(nowIso, idleCutoff) as Array<{ id: string }>;

    let count = 0;
    for (const row of idleRows) {
      try {
        await this.orchestrator.terminateSession(row.id, 'system', true, 'TERMINATED');
        db.prepare(`
          UPDATE sessions
          SET failure_code = 'IDLE_TIMEOUT',
              failure_message = ?
          WHERE id = ? AND status = 'TERMINATED'
        `).run(
          `连续 ${this.config.sessionIdleMinutes} 分钟没有 Viewer 活动，测试舱已自动回收`,
          row.id
        );
        count++;
      } catch (err) {
        console.error(`[WorkerService] Error reclaiming idle session ${row.id}:`, err);
      }
    }

    return count;
  }

  private repairLegacyPrematureExpiryStatuses(): void {
    const db = getDb(this.config);
    const message = this.config.sessionIdleMinutes > 0
      ? `旧版本将空闲回收误标记为已过期；该会话在实际 expires_at 前已结束`
      : '旧版本在实际 expires_at 前将会话误标记为已过期';

    const result = db.prepare(`
      UPDATE sessions
      SET status = 'TERMINATED',
          failure_code = 'IDLE_TIMEOUT',
          failure_message = COALESCE(failure_message, ?)
      WHERE status = 'EXPIRED'
        AND ended_at IS NOT NULL
        AND ended_at < expires_at
    `).run(message);

    if (result.changes > 0) {
      console.log(
        `[WorkerService] Reclassified ${result.changes} prematurely expired legacy session(s)`
      );
    }
  }

  private resetIdleBaselineAfterRestart(): void {
    if (this.config.sessionIdleMinutes <= 0) return;

    const db = getDb(this.config);
    const nowIso = new Date().toISOString();
    const result = db.prepare(`
      UPDATE sessions
      SET last_activity_at = ?
      WHERE status = 'READY'
        AND expires_at > ?
    `).run(nowIso, nowIso);

    if (result.changes > 0) {
      console.log(
        `[WorkerService] Reset idle baseline for ${result.changes} active session(s) after restart`
      );
    }
  }

  private resolveArtifactPath(relativePath: string): string | null {
    const root = path.resolve(this.config.artifactsDir);
    const fullPath = path.resolve(root, relativePath);
    const relative = path.relative(root, fullPath);

    if (
      !relative ||
      relative === '.' ||
      relative.startsWith('..') ||
      path.isAbsolute(relative)
    ) {
      return null;
    }

    return fullPath;
  }

  private deleteArtifact(row: ArtifactRow): boolean {
    const db = getDb(this.config);
    const fullPath = this.resolveArtifactPath(row.relative_path);

    if (!fullPath) {
      console.warn(
        `[WorkerService] Refusing to delete artifact outside root: ${row.relative_path}`
      );
      return false;
    }

    try {
      if (fs.existsSync(fullPath)) {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) fs.unlinkSync(fullPath);
      }
      db.prepare('DELETE FROM artifacts WHERE id = ?').run(row.id);
      return true;
    } catch (err) {
      console.warn(`[WorkerService] Failed to delete artifact ${row.id}:`, err);
      return false;
    }
  }

  private cleanupArtifacts(): number {
    const db = getDb(this.config);
    const deleted = new Set<string>();
    let cleaned = 0;

    if (this.config.artifactRetentionDays >= 0) {
      const cutoffDate = new Date(
        Date.now() - this.config.artifactRetentionDays * 86400 * 1000
      ).toISOString();

      const expiredArtifacts = db.prepare(`
        SELECT id, relative_path, size_bytes, created_at
        FROM artifacts
        WHERE created_at < ?
        ORDER BY created_at ASC
      `).all(cutoffDate) as unknown as ArtifactRow[];

      for (const row of expiredArtifacts) {
        if (this.deleteArtifact(row)) {
          deleted.add(row.id);
          cleaned++;
        }
      }
    }

    const maxBytes = this.config.artifactMaxTotalGb * 1024 * 1024 * 1024;
    let totalBytes = Number(
      (db.prepare('SELECT COALESCE(SUM(size_bytes), 0) AS total FROM artifacts').get() as any).total
    );

    if (totalBytes > maxBytes) {
      const oldest = db.prepare(`
        SELECT id, relative_path, size_bytes, created_at
        FROM artifacts
        ORDER BY created_at ASC
      `).all() as unknown as ArtifactRow[];

      for (const row of oldest) {
        if (totalBytes <= maxBytes) break;
        if (deleted.has(row.id)) continue;

        if (this.deleteArtifact(row)) {
          totalBytes = Math.max(0, totalBytes - Math.max(0, Number(row.size_bytes) || 0));
          cleaned++;
        }
      }
    }

    return cleaned;
  }

  private async maintainActiveSessions(): Promise<void> {
    const db = getDb(this.config);
    const readySessions = db.prepare(`
      SELECT id, selenium_session_id, grid_url
      FROM sessions
      WHERE status = 'READY'
    `).all() as Array<{ id: string; selenium_session_id?: string | null; grid_url?: string | null }>;

    for (const s of readySessions) {
      if (!s.selenium_session_id || s.selenium_session_id.startsWith('standalone-')) {
        continue;
      }
      const targetGrid = s.grid_url || this.config.gridUrl;
      try {
        const res = await fetch(`${targetGrid}/session/${s.selenium_session_id}/title`, {
          signal: AbortSignal.timeout(3000)
        });
        if (!res.ok && res.status === 404) {
          console.warn(`[WorkerService] Selenium session ${s.selenium_session_id} for session ${s.id} is closed, marking as TERMINATED`);
          await this.orchestrator.terminateSession(s.id, 'system', true, 'TERMINATED');
        }
      } catch {
        // network or transient error, do not kill
      }
    }
  }
}
