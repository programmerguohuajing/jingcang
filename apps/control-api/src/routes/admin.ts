import { FastifyInstance } from 'fastify';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { AuthService } from '../services/auth.service.js';
import { WorkerService } from '../services/worker.service.js';
import { ERROR_CODES } from '@jingcang/contracts';

export function registerAdminRoutes(
  fastify: FastifyInstance,
  config: Config,
  authService: AuthService,
  workerService: WorkerService
) {
  const requireAdmin = (request: any, reply: any) => {
    const token = request.cookies.jc_token || (request.headers.authorization?.replace('Bearer ', ''));
    const user = authService.getUserFromToken(token || '');
    if (!user || user.role !== 'admin') {
      reply.status(403).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '需要管理员权限' }
      });
      return null;
    }
    return user;
  };

  fastify.get('/api/v1/admin/status', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const db = getDb(config);

    const activeSessions = (db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE status IN ('PROVISIONING', 'STARTING', 'READY')
    `).get() as any).count;

    const queuedSessions = (db.prepare(`
      SELECT COUNT(*) as count FROM sessions WHERE status = 'QUEUED'
    `).get() as any).count;

    const totalSessions = (db.prepare(`
      SELECT COUNT(*) as count FROM sessions
    `).get() as any).count;

    const totalUsers = (db.prepare(`
      SELECT COUNT(*) as count FROM users
    `).get() as any).count;

    return {
      success: true,
      data: {
        maxConcurrency: config.sessionMaxConcurrency,
        activeSessions,
        queuedSessions,
        totalSessions,
        totalUsers,
        artifactRetentionDays: config.artifactRetentionDays,
        artifactMaxTotalGb: config.artifactMaxTotalGb,
        lanAccessEnabled: config.lanAccessEnabled
      }
    };
  });

  fastify.post('/api/v1/admin/cleanup', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const res = await workerService.runPeriodicTasks();
    authService.logAudit('MANUAL_CLEANUP_TRIGGERED', admin.id, null, res, request.ip || '127.0.0.1');

    return { success: true, data: res };
  });

  fastify.get('/api/v1/admin/audit-events', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const db = getDb(config);
    const rows = db.prepare(`
      SELECT a.*, u.username
      FROM audit_events a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `).all() as any[];

    return { success: true, data: rows };
  });
}
