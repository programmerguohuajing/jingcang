import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';

import { loadConfig } from './config.js';
import { getDb } from './db/index.js';
import { AuthService } from './services/auth.service.js';
import { CatalogService } from './services/catalog.service.js';
import { OrchestratorService } from './services/orchestrator.service.js';
import { ViewerGatewayService } from './services/viewer-gateway.service.js';
import { WorkerService } from './services/worker.service.js';
import { BrowserProvisioningService } from './services/browser-provisioning.service.js';
import { ApprovalService } from './services/approval.service.js';
import { createDesktopProvider, DesktopProvider } from './providers/desktop.provider.js';

import { registerAuthRoutes } from './routes/auth.js';
import { registerBrowserRoutes } from './routes/browsers.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerViewerRoutes } from './routes/viewer.js';
import { registerArtifactRoutes } from './routes/artifacts.js';
import { registerMobileDeviceRoutes } from './routes/mobile-devices.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { DeviceRegistryService } from './services/device-registry.service.js';
import { SessionCoreService } from './services/session-core.service.js';
import { ViewerTokenService } from './services/viewer-token.service.js';
import { NodeRouterService } from './services/node-router.service.js';
import { NodeRecoveryService } from './services/node-recovery.service.js';

async function main() {
  const config = loadConfig();

  // Initialize DB and bootstrap admin
  getDb(config);
  
  const authService = new AuthService(config);
  authService.bootstrapAdmin();

  const catalogService = new CatalogService(config);
  catalogService.loadAndSyncCatalog();
  const browserProvisioningService = new BrowserProvisioningService(config, catalogService);
  const approvalService = new ApprovalService(config, authService, catalogService, browserProvisioningService);

  const orchestrator = new OrchestratorService(config, catalogService);
  // CORE-001：以统一 DesktopProvider 接口承载桌面云浏览器能力（兼容层）
  const desktopProvider: DesktopProvider = createDesktopProvider(config, catalogService);
  const viewerGateway = new ViewerGatewayService(config, orchestrator);
  const workerService = new WorkerService(config, orchestrator);

  workerService.start();

  const server = Fastify({
    logger: true,
    trustProxy: config.trustProxy
  });

  await server.register(fastifyRateLimit, {
    global: false
  });

  await server.register(fastifyCookie, {
    secret: config.sessionSecret
  });

  await server.register(fastifyWebsocket);

  server.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return payload;
  });

  // Serve static UI console if built
  const webDistPath = path.resolve(config.rootDir, 'apps/console-web/dist');
  if (fs.existsSync(webDistPath)) {
    await server.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/'
    });

    server.setNotFoundHandler((request, reply) => {
      const url = request.raw.url || '';
      if (url.startsWith('/api') || url.startsWith('/health') || url.startsWith('/artifacts') || url.includes('/websockify')) {
        reply.status(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'API 接口不存在' } });
      } else {
        reply.sendFile('index.html');
      }
    });
  }

  // Register REST & Viewer Gateway routes
  registerAuthRoutes(server, authService, config);
  registerBrowserRoutes(server, catalogService, authService, browserProvisioningService, approvalService);
  registerSessionRoutes(server, desktopProvider, viewerGateway, authService);
  registerAdminRoutes(server, config, authService, workerService, approvalService);
  registerHealthRoutes(server, config);
  registerViewerRoutes(server, viewerGateway, orchestrator);
  registerArtifactRoutes(server, config, authService);
  const sessionCore = new SessionCoreService(config);
  const nodeRouter = new NodeRouterService(config);
  const nodeRecovery = new NodeRecoveryService(config, sessionCore, nodeRouter);
  // 失联节点恢复确认与安全释放：周期探测失联节点并回收其活动租约
  nodeRecovery.start();
  registerMobileDeviceRoutes(
    server,
    authService,
    sessionCore,
    new ViewerTokenService(config.viewerSecret, config.viewerTokenTtlSeconds),
    nodeRouter
  );

  const deviceRegistry = new DeviceRegistryService(config);
  registerDeviceRoutes(server, authService, deviceRegistry);

  try {
    await server.listen({ port: config.port, host: config.bindHost });
    console.log(`[JingCang Control API] Server running at http://${config.bindHost}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('[Control-API UnhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Control-API UncaughtException]', err);
});

main().catch(console.error);
