import Fastify, { type FastifyInstance } from 'fastify';
import { AndroidProvider } from './provider/android.js';
import { DeviceActionSchema } from '@jingcang/device-contracts';

/**
 * Device Agent HTTP 服务（AND-008）
 *
 * 暴露控制面所需的所有设备操作端点；路径与 control-api 的 agent() 代理一一对应。
 * 若配置了 JINGCANG_AGENT_TOKEN，则要求请求携带一致的 Bearer 令牌（Agent 侧双向认证）。
 */
export function createAgentServer(provider: AndroidProvider, opts: { token?: string } = {}): FastifyInstance {
  const server = Fastify({ logger: false });

  if (opts.token) {
    server.addHook('onRequest', async (req, reply) => {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${opts.token}`) {
        return reply.code(401).send({ success: false, error: { code: 'AGENT_UNAUTHORIZED' } });
      }
    });
  }

  server.get('/health', async (_req, reply) => {
    try {
      return await provider.health();
    } catch (e: any) {
      return reply503(reply, e);
    }
  });

  server.get('/devices', async (req, reply) => {
    try {
      return { devices: await provider.listDevices() };
    } catch (e: any) {
      return reply503(reply, e);
    }
  });

  server.get('/capabilities', async (req, reply) => {
    try {
      return await provider.getCapabilities();
    } catch (e: any) {
      return reply503(reply, e);
    }
  });

  server.get('/system-images', async (req, reply) => {
    try {
      return await provider.listSystemImages();
    } catch (e: any) {
      return reply503(reply, e);
    }
  });

  server.get('/profiles', async (req, reply) => {
    try {
      return { profiles: await provider.listProfiles() };
    } catch (e: any) {
      return reply503(reply, e);
    }
  });

  server.post('/profiles/create', async (req, reply) => {
    const apiLevel = (req.body as any)?.apiLevel;
    try {
      return await provider.createProfile(Number(apiLevel));
    } catch (e: any) {
      return replyCode(reply, e);
    }
  });

  server.post('/profiles/:id/delete', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      await provider.deleteProfile(id);
      return { success: true };
    } catch (e: any) {
      return replyCode(reply, e);
    }
  });

  server.post('/profiles/:id/:operation', async (req, reply) => {
    const { id, operation } = req.params as { id: string; operation: string };
    try {
      if (operation === 'start') await provider.startProfile(id);
      else if (operation === 'stop') await provider.stopProfile(id);
      else return reply.code(400).send({ success: false, error: { code: 'INVALID_OPERATION' } });
      return { success: true };
    } catch (e: any) {
      return replyCode(reply, e);
    }
  });

  server.post('/devices/:id/action', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = DeviceActionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ success: false, error: { code: 'INVALID_ACTION' } });
    try {
      return await provider.execute(id, parsed.data);
    } catch (e: any) {
      return replyCode(reply, e);
    }
  });

  server.get('/devices/:id/screenshot', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const buf = await provider.capture(id);
      reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store');
      return reply.send(buf);
    } catch (e: any) {
      return reply503(reply, e);
    }
  });

  server.post('/devices/:id/install', { bodyLimit: 16 * 1024 * 1024 }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const base64 = (req.body as any)?.base64;
    if (typeof base64 !== 'string') return reply.code(400).send({ success: false, error: { code: 'INVALID_APK' } });
    try {
      return await provider.installApp(id, base64);
    } catch (e: any) {
      return replyCode(reply, e);
    }
  });

  server.post('/devices/:id/automation', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      return await provider.runAutomation(id);
    } catch (e: any) {
      return replyCode(reply, e);
    }
  });

  server.get('/devices/:id/h264', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const stream = await provider.startVideoStream(id);
      if (!stream) return reply.code(501).send({ success: false, error: { code: 'H264_UNSUPPORTED' } });
      reply.header('Content-Type', 'video/h264');
      // 简化：将首个分块写出（真实实现应持续推送）
      for await (const chunk of stream.stream) {
        reply.raw.write(chunk);
        break;
      }
      reply.raw.end();
      return reply;
    } catch (e: any) {
      return reply503(reply, e);
    }
  });

  return server;
}

function reply503(reply: any, e: any) {
  return reply.code(503).send({ success: false, error: { code: e?.code || 'PROVIDER_UNAVAILABLE', message: e?.message } });
}
function replyCode(reply: any, e: any) {
  const status = e?.code === 'PROVIDER_UNAVAILABLE' ? 503 : 400;
  return reply.code(status).send({ success: false, error: { code: e?.code || 'PROVIDER_ERROR', message: e?.message } });
}
