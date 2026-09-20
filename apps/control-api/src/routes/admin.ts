import { FastifyInstance } from 'fastify';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { AuthService } from '../services/auth.service.js';
import { WorkerService } from '../services/worker.service.js';
import { ApprovalService } from '../services/approval.service.js';
import {
  CreateUserRequestSchema,
  UpdateUserPermissionsSchema,
  ReviewApprovalRequestSchema,
  ERROR_CODES
} from '@jingcang/contracts';

export function registerAdminRoutes(
  fastify: FastifyInstance,
  config: Config,
  authService: AuthService,
  workerService: WorkerService,
  approvalService: ApprovalService
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

  // User Management
  fastify.get('/api/v1/admin/users', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const users = authService.listUsers();
    return { success: true, data: users };
  });

  fastify.post('/api/v1/admin/users', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const parsed = CreateUserRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: '用户参数格式不正确',
          details: parsed.error.format()
        }
      });
    }

    try {
      const user = await authService.createUser(
        parsed.data.username,
        parsed.data.password,
        parsed.data.role,
        request.ip || '127.0.0.1'
      );
      return { success: true, data: user };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: err?.message || '创建用户失败' }
      });
    }
  });

  fastify.put('/api/v1/admin/users/:id/status', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };
    const { enabled } = (request.body || {}) as { enabled?: boolean };

    if (typeof enabled !== 'boolean') {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '必须指定 enabled 状态 (true/false)' }
      });
    }

    try {
      authService.toggleUserStatus(id, enabled, admin.id, request.ip || '127.0.0.1');
      return { success: true };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: err?.message || '更新用户状态失败' }
      });
    }
  });

  fastify.put('/api/v1/admin/users/:id/permissions', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };
    const parsed = UpdateUserPermissionsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: '权限配置格式不正确',
          details: parsed.error.format()
        }
      });
    }

    try {
      authService.updateUserBrowserPermissions(
        id,
        parsed.data.browserAccessPolicy,
        parsed.data.allowedBrowserIds,
        request.ip || '127.0.0.1'
      );
      return { success: true };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: err?.message || '更新用户权限失败' }
      });
    }
  });

  // Approvals Management
  fastify.get('/api/v1/admin/approvals', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const query = (request.query || {}) as { status?: any; type?: any };
    const approvals = approvalService.listRequests({
      status: query.status,
      type: query.type
    });
    return { success: true, data: approvals };
  });

  fastify.post('/api/v1/admin/approvals/:id/review', async (request, reply) => {
    const admin = requireAdmin(request, reply);
    if (!admin) return;

    const { id } = request.params as { id: string };
    const parsed = ReviewApprovalRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: '审批参数格式不正确',
          details: parsed.error.format()
        }
      });
    }

    try {
      const result = approvalService.reviewRequest(
        id,
        admin.id,
        admin.username,
        parsed.data,
        request.ip || '127.0.0.1'
      );
      return { success: true, data: result };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: err?.message || '审批操作失败' }
      });
    }
  });
}

