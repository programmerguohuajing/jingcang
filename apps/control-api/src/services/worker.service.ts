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

  public async runPeriodicTasks(): Promise<{ expiredCount: number; cleanedArtifacts: number }> {
    await this.maintainActiveSessions();
    const expiredCount = await this.sweepExpiredSessions();
    const cleanedArtifacts = this.cleanupArtifacts();
    await this.orchestrator.processQueue();
    return { expiredCount, cleanedArtifacts };
  }

  private async sweepExpiredSessions(): Promise<number> {
    const db = getDb(this.config);
    const now = new Date();
    const nowIso = now.toISOString();
    const targets = new Map<string, { id: string; status: string }>();

    const expiredRows = db.prepare(`
      SELECT id, status
      FROM sessions
      WHERE status IN ('QUEUED', 'PROVISIONING', 'STARTING', 'READY')
        AND expires_at <= ?
    `).all(nowIso) as Array<{ id: string; status: string }>;

    for (const row of expiredRows) targets.set(row.id, row);

    if (this.config.sessionIdleMinutes > 0) {
      const idleCutoff = new Date(
        now.getTime() - this.config.sessionIdleMinutes * 60 * 1000
      ).toISOString();

      const idleRows = db.prepare(`
        SELECT id, status
        FROM sessions
        WHERE status = 'READY'
          AND COALESCE(last_activity_at, started_at, created_at) <= ?
      `).all(idleCutoff) as Array<{ id: string; status: string }>;

      for (const row of idleRows) targets.set(row.id, row);
    }

    let count = 0;
    for (const row of targets.values()) {
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
