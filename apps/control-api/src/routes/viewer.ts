import { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import { ViewerGatewayService } from '../services/viewer-gateway.service.js';
import { OrchestratorService } from '../services/orchestrator.service.js';

export function registerViewerRoutes(
  fastify: FastifyInstance,
  viewerGateway: ViewerGatewayService,
  orchestrator: OrchestratorService
) {
  fastify.get('/viewer/:sessionId/websockify', { websocket: true }, (clientSocket, req) => {
    const { sessionId } = req.params as { sessionId: string };
    const query = new URLSearchParams(req.url.split('?')[1] || '');
    const protocolHeader = req.headers['sec-websocket-protocol'];
    const protocols = typeof protocolHeader === 'string'
      ? protocolHeader.split(',').map((value) => value.trim())
      : [];
    const prefixedProtocol = protocols.find((value) => value.startsWith('jingcang.viewer.'));
    const token = prefixedProtocol?.slice('jingcang.viewer.'.length) || query.get('token') || '';

    if (!viewerGateway.validateViewerToken(token, sessionId)) {
      clientSocket.close(4001, 'Unauthorized or expired viewer token');
      return;
    }

    const session = orchestrator.getSessionResponse(sessionId);
    if (!session || session.status !== 'READY') {
      clientSocket.close(4002, 'Session is not active');
      return;
    }

    if (!session.seleniumSessionId || session.seleniumSessionId.startsWith('standalone-')) {
      clientSocket.close(4005, 'Testing pod has no active desktop session');
      return;
    }

    let targetSocket: WebSocket;
    try {
      targetSocket = new WebSocket(
        viewerGateway.getTargetNoVncWebSocketUrl(sessionId),
        { perMessageDeflate: false }
      );
    } catch {
      clientSocket.close(4003, 'Viewer target unavailable');
      return;
    }

    const pending: Array<{ data: WebSocket.RawData; isBinary: boolean }> = [];
    let lastActivityTouch = 0;

    const touchActivity = () => {
      const now = Date.now();
      if (now - lastActivityTouch >= 30000) {
        orchestrator.touchSession(sessionId);
        lastActivityTouch = now;
      }
    };

    touchActivity();

    clientSocket.on('message', (data, isBinary) => {
      touchActivity();
      try {
        if (targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(data, { binary: isBinary });
        } else if (targetSocket.readyState === WebSocket.CONNECTING && pending.length < 100) {
          pending.push({ data, isBinary });
        }
      } catch (err) {
        fastify.log.warn({ err, sessionId }, 'Failed to forward client message to upstream');
      }
    });

    targetSocket.on('open', () => {
      try {
        for (const message of pending.splice(0)) {
          targetSocket.send(message.data, { binary: message.isBinary });
        }
      } catch (err) {
        fastify.log.warn({ err, sessionId }, 'Failed to flush pending messages to upstream');
      }
    });

    targetSocket.on('message', (data, isBinary) => {
      try {
        if (clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.send(data, { binary: isBinary });
        }
      } catch (err) {
        fastify.log.warn({ err, sessionId }, 'Failed to forward upstream message to client');
      }
    });

    clientSocket.on('close', () => {
      try {
        if (
          targetSocket.readyState === WebSocket.OPEN ||
          targetSocket.readyState === WebSocket.CONNECTING
        ) {
          targetSocket.close();
        }
      } catch (_) {}
    });

    targetSocket.on('close', (code, reason) => {
      try {
        if (
          clientSocket.readyState === WebSocket.OPEN ||
          clientSocket.readyState === WebSocket.CONNECTING
        ) {
          clientSocket.close(code || 1000, reason ? reason.toString().slice(0, 123) : undefined);
        }
      } catch (_) {}
    });

    clientSocket.on('error', (err) => {
      fastify.log.debug({ err, sessionId }, 'Viewer client websocket error');
    });

    targetSocket.on('error', (err) => {
      fastify.log.warn({ err, sessionId }, 'Upstream VNC websocket failed');
      if (
        clientSocket.readyState === WebSocket.OPEN ||
        clientSocket.readyState === WebSocket.CONNECTING
      ) {
        clientSocket.close(4004, 'Upstream VNC target unreachable');
      }
    });
  });
}
