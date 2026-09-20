import crypto from 'node:crypto';

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export async function verifyPassword(password: string, combinedHash: string): Promise<boolean> {
  if (!combinedHash || !combinedHash.includes(':')) return false;
  const [salt, key] = combinedHash.split(':');
  if (!salt || !key || !/^[0-9a-f]{128}$/i.test(key)) return false;

  return new Promise<boolean>((resolve) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) {
        resolve(false);
        return;
      }
      const storedKey = Buffer.from(key, 'hex');
      resolve(
        storedKey.length === derivedKey.length &&
        crypto.timingSafeEqual(storedKey, derivedKey)
      );
    });
  });
}

export function generateToken(payload: Record<string, any>, secret: string, ttlSeconds: number): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + ttlSeconds };

  const b64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const b64Payload = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${b64Header}.${b64Payload}`)
    .digest('base64url');

  return `${b64Header}.${b64Payload}.${signature}`;
}

export function verifyToken(token: string, secret: string): Record<string, any> | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [b64Header, b64Payload, signature] = parts;

  try {
    const header = JSON.parse(Buffer.from(b64Header, 'base64url').toString('utf8'));
    if (header?.alg !== 'HS256' || header?.typ !== 'JWT') return null;

    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${b64Header}.${b64Payload}`)
      .digest('base64url');

    const actualBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSig, 'utf8');
    if (
      actualBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(b64Payload, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}
