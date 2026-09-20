import { FastifyInstance } from 'fastify';
import { AuthService } from '../services/auth.service.js';
import { Config } from '../config.js';
import { LoginRequestSchema, ChangePasswordRequestSchema, ERROR_CODES } from '@jingcang/contracts';

export function registerAuthRoutes(fastify: FastifyInstance, authService: AuthService, config: Config) {
  fastify.post('/api/v1/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const parse = LoginRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '输入参数有误', details: parse.error.format() }
      });
    }

    const ip = request.ip || '127.0.0.1';
    const result = await authService.login(parse.data.username, parse.data.password, ip);
    if (!result) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '用户名或密码错误' }
      });
    }

    // Set HTTP-Only Cookie
    reply.setCookie('jc_token', result.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: config.baseUrl.startsWith('https://'),
      maxAge: 86400 * 7
    });

    return {
      success: true,
      data: {
        user: result.user
      }
    };
  });

  fastify.post('/api/v1/auth/logout', async (request, reply) => {
    reply.clearCookie('jc_token', { path: '/' });
    return { success: true };
  });

  fastify.get('/api/v1/auth/me', async (request, reply) => {
    const token = request.cookies.jc_token || (request.headers.authorization?.replace('Bearer ', ''));
    if (!token) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '未登录' }
      });
    }

    const user = authService.getUserFromToken(token);
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '登录已过期' }
      });
    }

    return { success: true, data: user };
  });

  fastify.post('/api/v1/auth/change-password', async (request, reply) => {
    const token = request.cookies.jc_token || (request.headers.authorization?.replace('Bearer ', ''));
    const user = authService.getUserFromToken(token || '');
    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '未登录' }
      });
    }

    const parse = ChangePasswordRequestSchema.safeParse(request.body);
    if (!parse.success) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '输入参数有误' }
      });
    }

    const ip = request.ip || '127.0.0.1';
    const ok = await authService.changePassword(user.id, parse.data.oldPassword, parse.data.newPassword, ip);
    if (!ok) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '旧密码校验失败' }
      });
    }

    return { success: true };
  });
}
