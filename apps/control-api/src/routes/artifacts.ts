import fs from 'fs';
import path from 'path';
import { FastifyInstance } from 'fastify';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { AuthService } from '../services/auth.service.js';
import { ERROR_CODES } from '@jingcang/contracts';

function getContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.json': return 'application/json; charset=utf-8';
    case '.har': return 'application/json; charset=utf-8';
    case '.mp4': return 'video/mp4';
    case '.webm': return 'video/webm';
    case '.txt':
    case '.log': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

export function registerArtifactRoutes(
  fastify: FastifyInstance,
  config: Config,
  authService: AuthService
) {
  fastify.get('/artifacts/*', async (request, reply) => {
    const token =
      request.cookies.jc_token ||
      request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const user = authService.getUserFromToken(token || '');

    if (!user) {
      return reply.status(401).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_UNAUTHORIZED, message: '请先登录' }
      });
    }

    const relativePath = (request.params as { '*': string })['*'];
    if (!relativePath || path.isAbsolute(relativePath)) {
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '产物路径无效' }
      });
    }

    const db = getDb(config);
    const artifact = db.prepare(`
      SELECT a.relative_path, s.user_id
      FROM artifacts a
      JOIN sessions s ON s.id = a.session_id
      WHERE a.relative_path = ?
      LIMIT 1
    `).get(relativePath) as { relative_path: string; user_id: string } | undefined;

    if (!artifact) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ARTIFACT_NOT_FOUND', message: '产物不存在' }
      });
    }

    if (user.role !== 'admin' && artifact.user_id !== user.id) {
      return reply.status(403).send({
        success: false,
        error: { code: ERROR_CODES.AUTH_FORBIDDEN, message: '无权访问此产物' }
      });
    }

    const root = path.resolve(config.artifactsDir);
    const fullPath = path.resolve(root, artifact.relative_path);
    const relative = path.relative(root, fullPath);
    if (!relative || relative === '.' || relative.startsWith('..') || path.isAbsolute(relative)) {
      fastify.log.warn({ relativePath }, 'Rejected artifact path outside artifact root');
      return reply.status(400).send({
        success: false,
        error: { code: ERROR_CODES.INVALID_REQUEST, message: '产物路径无效' }
      });
    }

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return reply.status(404).send({
        success: false,
        error: { code: 'ARTIFACT_NOT_FOUND', message: '产物文件不存在' }
      });
    }

    reply
      .type(getContentType(fullPath))
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff');

    return reply.send(fs.createReadStream(fullPath));
  });
}
