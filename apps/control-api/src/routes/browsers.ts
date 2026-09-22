import { FastifyInstance } from 'fastify';
import { CatalogService } from '../services/catalog.service.js';
import { AuthService } from '../services/auth.service.js';
import { BrowserProvisioningService } from '../services/browser-provisioning.service.js';
import { ApprovalService } from '../services/approval.service.js';
import {
  BrowserInstallRequestSchema,
  CatalogUpdateSchema,
  CreateApprovalRequestSchema,
  ERROR_CODES
} from '@jingcang/contracts';

export function registerBrowserRoutes(
  fastify: FastifyInstance,
  catalogService: CatalogService,
  authService: AuthService,
  browserProvisioningService: BrowserProvisioningService,
  approvalService: ApprovalService
) {
  const getUser = (request: any) => {
    const token = request.cookies.jc_token || (request.headers.authorization?.replace('Bearer ', ''));
    return authService.getUserFromToken(token || '');
  };

  fastify.get('/api/v1/browsers', async (request, reply) => {
    const items = catalogService.getCatalogItems(true);
    const user = getUser(request);

    if (user) {
      if (user.role === 'admin') {
        items.forEach((item) => {
          item.isPermitted = true;
        });
      } else {
        const allowed = authService.getUserAllowedBrowsers(user.id);
        if (allowed.policy === 'ALL') {
          items.forEach((item) => {
            item.isPermitted = true;
          });
        } else {
          const allowedSet = new Set(allowed.allowedBrowserIds);
          items.forEach((item) => {
            item.isPermitted = allowedSet.has(item.id);
          });
        }
      }
    } else {
      items.forEach((item) => {
        item.isPermitted = true;
      });
    }

    return { success: true, data: items };
  });

  // User-facing Approval Routes
  fastify.post('/api/v1/approvals', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录后再提交审批申请' }
      });
    }

    const parsed = CreateApprovalRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: '审批申请参数格式不正确',
          details: parsed.error.format()
        }
      });
    }

    try {
      const item = approvalService.createRequest(user.id, user.username, parsed.data);
      return reply.status(201).send({ success: true, data: item });
    } catch (err: any) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: err?.message || '提交审批申请失败' }
      });
    }
  });

  fastify.get('/api/v1/approvals/my', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const list = approvalService.listRequests({ userId: user.id });
    return { success: true, data: list };
  });

  fastify.get('/api/v1/admin/browsers', async (request, reply) => {
    const user = getUser(request);
    if (!user || user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '需要管理员权限' }
      });
    }

    return { success: true, data: catalogService.getCatalogItems() };
  });

  fastify.get('/api/v1/browsers/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const item = catalogService.getBrowserById(id);
    if (!item) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '浏览器舱位不存在' }
      });
    }
    return { success: true, data: item };
  });

  fastify.post('/api/v1/browser-installs', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录后再添加浏览器版本' }
      });
    }
    const parsed = BrowserInstallRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: {
          code: ERROR_CODES.INVALID_REQUEST,
          message: '浏览器厂商或版本格式不正确',
          details: parsed.error.format()
        }
      });
    }

    try {
      const job = browserProvisioningService.createInstallJob(user.id, parsed.data);
      authService.logAudit(
        'BROWSER_INSTALL_REQUESTED',
        user.id,
        null,
        { jobId: job.id, browserName: job.browserName, version: job.version, image: job.image },
        request.ip || '127.0.0.1'
      );
      return reply.status(job.status === 'READY' ? 200 : 202).send({ success: true, data: job });
    } catch (error: any) {
      return reply.status(409).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: error?.message || '创建安装任务失败' }
      });
    }
  });

  fastify.get('/api/v1/browser-installs/:id', async (request, reply) => {
    const user = getUser(request);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const { id } = request.params as { id: string };
    const ownerId = browserProvisioningService.getInstallJobOwner(id);
    if (!ownerId) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '浏览器安装任务不存在' }
      });
    }
    if (user.role !== 'admin' && ownerId !== user.id) {
      return reply.status(403).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '无权查看此浏览器安装任务' }
      });
    }

    return { success: true, data: browserProvisioningService.getInstallJob(id) };
  });

  fastify.put('/api/v1/admin/browsers/:id', async (request, reply) => {
    const user = getUser(request);

    if (!user || user.role !== 'admin') {
      return reply.status(403).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '需要管理员权限' }
      });
    }

    const { id } = request.params as { id: string };
    const parse = CatalogUpdateSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '输入参数有误' }
      });
    }

    const ok = catalogService.updateCatalogItem(id, parse.data);
    if (!ok) {
      return reply.status(404).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '更新失败，目标舱位不存在' }
      });
    }

    authService.logAudit('CATALOG_UPDATED', user.id, null, { browserId: id, updates: parse.data }, request.ip || '127.0.0.1');

    return { success: true, data: catalogService.getBrowserById(id) };
  });
}
