import { FastifyInstance } from 'fastify';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';

export function registerHealthRoutes(fastify: FastifyInstance, config: Config) {
  fastify.get('/health/live', async () => {
    return { status: 'UP', timestamp: new Date().toISOString() };
  });

  fastify.get('/health/ready', async (_request, reply) => {
    const components: Record<string, { status: string; detail?: string }> = {};
    let healthy = true;

    try {
      const db = getDb(config);
      db.prepare('SELECT 1').get();
      components.db = { status: 'UP' };
    } catch (err: any) {
      healthy = false;
      components.db = { status: 'DOWN', detail: err.message || 'SQLite check failed' };
    }

    try {
      const gridRes = await fetch(`${config.gridUrl}/status`, {
        signal: AbortSignal.timeout(5000)
      });
      const body = (await gridRes.json().catch(() => null)) as any;
      const gridReady = gridRes.ok && body?.value?.ready !== false;
      if (!gridReady) {
        healthy = false;
        components.grid = {
          status: 'DOWN',
          detail: body?.value?.message || `HTTP ${gridRes.status}`
        };
      } else {
        components.grid = { status: 'UP' };
      }
    } catch (err: any) {
      healthy = false;
      components.grid = {
        status: 'DOWN',
        detail: err.message || 'Selenium Grid check failed'
      };
    }

    if (!healthy) reply.status(503);

    return {
      status: healthy ? 'UP' : 'DOWN',
      components,
      maxConcurrency: config.sessionMaxConcurrency,
      timestamp: new Date().toISOString()
    };
  });
}
