import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../services/auth.service.js';

export function registerMobileDeviceRoutes(server: FastifyInstance, auth: AuthService) {
  server.get('/api/v1/mobile/devices', async (request, reply) => {
    const token = request.cookies.jc_token || request.headers.authorization?.replace('Bearer ', '');
    const user = auth.getUserFromToken(token || '');
    if (!user) return reply.code(401).send({ success: false, error: { code: 'AUTH_UNAUTHORIZED', message: '请先登录' } });

    const agentUrl = process.env.JINGCANG_MOBILE_AGENT_URL;
    const agentToken = process.env.JINGCANG_MOBILE_AGENT_TOKEN;
    if (!agentUrl || !agentToken) {
      return { success: true, data: { status: 'not-configured', devices: [] } };
    }
    try {
      const response = await fetch(new URL('/devices', agentUrl), {
        headers: { Authorization: 'Bearer ' + agentToken },
        signal: AbortSignal.timeout(5000)
      });
      if (!response.ok) throw new Error('Agent HTTP ' + response.status);
      const payload = await response.json() as { devices?: unknown };
      return { success: true, data: { status: 'online', devices: Array.isArray(payload.devices) ? payload.devices : [] } };
    } catch {
      return { success: true, data: { status: 'offline', devices: [] } };
    }
  });
}
