import crypto from 'node:crypto';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../utils/crypto.js';
import { UserRole } from '@jingcang/contracts';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  enabled: number;
  auth_version: number;
  created_at: string;
  updated_at: string;
}

export class AuthService {
  constructor(private config: Config) {}

  public bootstrapAdmin(): void {
    const db = getDb(this.config);
    const stmt = db.prepare('SELECT COUNT(*) as count FROM users');
    const result = stmt.get() as { count: number };

    if (result.count === 0) {
      const now = new Date().toISOString();
      const adminId = crypto.randomUUID();
      const pwdHash = hashPassword(this.config.adminInitialPassword);
      
      const insert = db.prepare(`
        INSERT INTO users (id, username, password_hash, role, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
      `);
      insert.run(adminId, 'admin', pwdHash, 'admin', now, now);

      this.logAudit('USER_BOOTSTRAP', adminId, null, { username: 'admin', role: 'admin' }, '127.0.0.1');
    }
  }

  public async login(username: string, password: string, ip: string = '127.0.0.1') {
    const db = getDb(this.config);
    const stmt = db.prepare('SELECT * FROM users WHERE username = ? AND enabled = 1');
    const user = stmt.get(username) as UserRow | undefined;

    if (!user) {
      this.logAudit('LOGIN_FAILED', null, null, { username, reason: 'user_not_found' }, ip);
      return null;
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      this.logAudit('LOGIN_FAILED', user.id, null, { username, reason: 'invalid_password' }, ip);
      return null;
    }

    const token = generateToken(
      { userId: user.id, username: user.username, role: user.role, authVersion: user.auth_version || 1 },
      this.config.sessionSecret,
      86400 * 7
    );
    this.logAudit('LOGIN_SUCCESS', user.id, null, { username }, ip);

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    };
  }

  public getUserFromToken(token: string): { id: string; username: string; role: UserRole } | null {
    const payload = verifyToken(token, this.config.sessionSecret);
    if (!payload || !payload.userId) return null;

    const db = getDb(this.config);
    const stmt = db.prepare('SELECT id, username, role, enabled, auth_version FROM users WHERE id = ?');
    const user = stmt.get(payload.userId) as UserRow | undefined;

    if (!user || !user.enabled) return null;
    if ((payload.authVersion || 1) !== (user.auth_version || 1)) return null;
    return {
      id: user.id,
      username: user.username,
      role: user.role
    };
  }

  public async changePassword(userId: string, oldPwd: string, newPwd: string, ip: string = '127.0.0.1'): Promise<boolean> {
    const db = getDb(this.config);
    const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(userId) as UserRow | undefined;

    if (!user || !(await verifyPassword(oldPwd, user.password_hash))) {
      return false;
    }

    const newHash = hashPassword(newPwd);
    const now = new Date().toISOString();
    const update = db.prepare(
      'UPDATE users SET password_hash = ?, auth_version = auth_version + 1, updated_at = ? WHERE id = ?'
    );
    update.run(newHash, now, userId);

    this.logAudit('PASSWORD_CHANGED', userId, null, { username: user.username }, ip);
    return true;
  }

  public logAudit(eventType: string, userId: string | null, sessionId: string | null, details: any, ip: string) {
    const db = getDb(this.config);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO audit_events (id, event_type, user_id, session_id, details_json, ip, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, eventType, userId, sessionId, JSON.stringify(details || {}), ip, now);
  }
}
