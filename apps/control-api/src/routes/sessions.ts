import { FastifyInstance } from 'fastify';
import { OrchestratorService } from '../services/orchestrator.service.js';
import { ViewerGatewayService } from '../services/viewer-gateway.service.js';
import { AuthService } from '../services/auth.service.js';
import {
  CreateSessionRequestSchema,
  SessionQuerySchema,
  ExtendSessionRequestSchema,
  BatchDeleteSessionsRequestSchema,
  ERROR_CODES
} from '@jingcang/contracts';

export function registerSessionRoutes(
  fastify: FastifyInstance,
  orchestrator: OrchestratorService,
  viewerGateway: ViewerGatewayService,
  authService: AuthService
) {
  // Middleware helper
  const getUser = (request: any) => {
    const token = request.cookies.jc_token || (request.headers.authorization?.replace('Bearer ', ''));
    return authService.getUserFromToken(token || '');
  };

  fastify.post('/api/v1/sessions', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录后再启动测试舱' }
      });
    }

    const parse = CreateSessionRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '输入参数校验失败', details: parse.error.format() }
      });
    }

    const permCheck = authService.checkUserBrowserPermission(user.id, parse.data.browserId);
    if (!permCheck.permitted) {
      return reply.status(403).send({
        success: false,
        error: {
          code: ERROR_CODES.AUTH_FORBIDDEN,
          message: permCheck.reason || '未获得该浏览器的访问权限，请向管理员申请'
        }
      });
    }

    try {
      const session = await orchestrator.createSession(user.id, user.username, parse.data);
      authService.logAudit('SESSION_CREATED', user.id, session.id, { browserId: session.browserId, status: session.status }, request.ip || '127.0.0.1');
      return { success: true, data: session };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: err.code || ERROR_CODES.INTERNAL_ERROR, message: err.message || '启动测试舱失败' }
      });
    }
  });

  fastify.get('/api/v1/sessions', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const parsedQuery = SessionQuerySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: '查询参数校验失败',
          details: parsedQuery.error.format()
        }
      });
    }

    const query = parsedQuery.data;
    const isAdmin = user.role === 'admin';
    const result = orchestrator.listSessions(
      user.id,
      isAdmin,
      query.page,
      query.pageSize,
      query.status,
      isAdmin ? query.userId : undefined
    );
    return { success: true, data: result };
  });

  fastify.get('/api/v1/sessions/:id', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const { id } = request.params as { id: string };
    const session = orchestrator.getSessionResponse(id);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.SESSION_NOT_FOUND, message: '测试舱不存在' }
      });
    }

    if (user.role !== 'admin' && session.userId !== user.id) {
      return reply.status(403).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '无权查看此测试舱' }
      });
    }

    return { success: true, data: session };
  });

  fastify.delete('/api/v1/sessions/:id', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const { id } = request.params as { id: string };
    const query = request.query as { permanent?: string } | undefined;
    const isAdmin = user.role === 'admin';
    const isPermanent = query?.permanent === 'true' || query?.permanent === '1';

    try {
      const session = orchestrator.getSessionResponse(id);
      const isHistorical = session && ['TERMINATED', 'EXPIRED', 'FAILED', 'LOST', 'ORPHANED'].includes(session.status);

      if (isPermanent || isHistorical) {
        await orchestrator.deleteSessionRecord(id, user.id, isAdmin);
        authService.logAudit('SESSION_DELETED', user.id, id, null, request.ip || '127.0.0.1');
      } else {
        await orchestrator.terminateSession(id, user.id, isAdmin);
        authService.logAudit('SESSION_TERMINATED', user.id, id, null, request.ip || '127.0.0.1');
      }
      return { success: true };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: err.code || ERROR_CODES.INTERNAL_ERROR, message: err.message || '操作测试舱失败' }
      });
    }
  });

  fastify.post('/api/v1/sessions/batch-delete', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const parse = BatchDeleteSessionsRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '请提供有效的测试舱 ID 列表', details: parse.error.format() }
      });
    }

    const isAdmin = user.role === 'admin';
    const ids = parse.data.ids;
    const results: { id: string; success: boolean; error?: string }[] = [];

    for (const id of ids) {
      try {
        await orchestrator.deleteSessionRecord(id, user.id, isAdmin);
        authService.logAudit('SESSION_DELETED', user.id, id, null, request.ip || '127.0.0.1');
        results.push({ id, success: true });
      } catch (err: any) {
        results.push({ id, success: false, error: err?.message || '删除失败' });
      }
    }

    return {
      success: true,
      data: {
        total: ids.length,
        deleted: results.filter((r) => r.success).length,
        failed: results.filter((r) => !r.success).length,
        results
      }
    };
  });

  fastify.post('/api/v1/sessions/:id/extend', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const { id } = request.params as { id: string };
    const parse = ExtendSessionRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: '延长时长参数校验失败',
          details: parse.error.format()
        }
      });
    }
    const extendMins = parse.data.extendMinutes;

    try {
      const updated = await orchestrator.extendSession(id, user.id, user.role === 'admin', extendMins);
      authService.logAudit('SESSION_EXTENDED', user.id, id, { extendMinutes: extendMins }, request.ip || '127.0.0.1');
      return { success: true, data: updated };
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: err.code || ERROR_CODES.INTERNAL_ERROR, message: err.message || '延长测试舱失败' }
      });
    }
  });

  fastify.get('/api/v1/sessions/:id/viewer-token', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const { id } = request.params as { id: string };
    const session = orchestrator.getSessionResponse(id);
    if (!session) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.SESSION_NOT_FOUND, message: '测试舱不存在' }
      });
    }

    if (user.role !== 'admin' && session.userId !== user.id) {
      return reply.status(403).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '无权获取访问令牌' }
      });
    }

    if (session.status !== 'READY') {
      return reply.status(409).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '测试舱尚未就绪，无法获取 Viewer Token' }
      });
    }

    const token = viewerGateway.issueViewerToken(id, user.id);
    return { success: true, data: { token, viewerUrl: `/viewer/${id}` } };
  });
}
