import crypto from 'node:crypto';
import { ViewerTokenClaimsSchema, type ViewerTokenClaims } from '@jingcang/device-contracts';

/**
 * Viewer Token 与 Agent 双向认证（CORE-004）
 *
 * Viewer Token 绑定 user / session / device / lease 四元组，短期有效，
 * 用于保护移动会话的流媒体/截图/控制通道，避免仅凭会话 ID 越权连接。
 *
 * 令牌格式： base64url(payload) + '.' + base64url(HMAC-SHA256(secret, payload))
 * - 服务端不持久化明文令牌，仅存其 SHA-256 摘要用于轮转/吊销核对。
 * - Agent 侧：节点凭据（device_node_credentials.token_hash）以 SHA-256 存储，
 *   心跳/注册经 Bearer 64-hex 校验（见 routes/devices.ts 与 mobile-devices.ts）。
 */
export class ViewerTokenService {
  constructor(
    private secret: string,
    private ttlSeconds: number = 120
  ) {}

  private encode(input: Buffer | string): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private decode(input: string): Buffer {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(padded, 'base64');
  }

  /** 为已建立的会话签发绑定四元组的 Viewer Token。 */
  issue(input: {
    sub: string;
    sid: string;
    did: string;
    lid: string;
    node: string;
    mode: 'phone' | 'browser';
  }): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: ViewerTokenClaims = {
      sub: input.sub,
      sid: input.sid,
      did: input.did,
      lid: input.lid,
      node: input.node,
      mode: input.mode,
      iat: now,
      exp: now + this.ttlSeconds
    };
    const payloadB64 = this.encode(JSON.stringify(claims));
    const sig = crypto.createHmac('sha256', this.secret).update(payloadB64).digest();
    return `${payloadB64}.${this.encode(sig)}`;
  }

  /** 校验令牌签名与有效期，返回声明或 null。 */
  verify(token: string): ViewerTokenClaims | null {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts;
    const expected = crypto.createHmac('sha256', this.secret).update(payloadB64).digest();
    const provided = this.decode(sigB64);
    if (expected.length !== provided.length) return null;
    if (!crypto.timingSafeEqual(expected, provided)) return null;
    let claims: ViewerTokenClaims;
    try {
      claims = JSON.parse(this.decode(payloadB64).toString('utf8'));
    } catch {
      return null;
    }
    const parsed = ViewerTokenClaimsSchema.safeParse(claims);
    if (!parsed.success) return null;
    if (parsed.data.exp * 1000 < Date.now()) return null;
    return parsed.data;
  }

  /** 令牌摘要（用于持久化与轮转核对）。 */
  digest(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /** 节点 Bearer 凭据校验：比对 64-hex 明文与存储的 SHA-256 摘要。 */
  static verifyNodeCredential(bearerToken: string, storedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(bearerToken)) return false;
    const hash = crypto.createHash('sha256').update(bearerToken).digest('hex');
    if (hash.length !== storedHash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
  }
}
