import crypto from 'node:crypto';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { hashPassword, verifyPassword, generateToken, verifyToken } from '../utils/crypto.js';
import { AdminUserItem, BrowserAccessPolicy, UserRole } from '@jingcang/contracts';

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  enabled: number;
  auth_version: number;
  browser_access_policy?: BrowserAccessPolicy;
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
        INSERT INTO users (id, username, password_hash, role, enabled, auth_version, browser_access_policy, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, 1, 'ALL', ?, ?)
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

  public listUsers(): AdminUserItem[] {
    const db = getDb(this.config);
    const users = db.prepare(`
      SELECT id, username, role, enabled, browser_access_policy, created_at, updated_at
      FROM users
      ORDER BY created_at ASC
    `).all() as Array<{
      id: string;
      username: string;
      role: UserRole;
      enabled: number;
      browser_access_policy?: BrowserAccessPolicy;
      created_at: string;
      updated_at: string;
    }>;

    const perms = db.prepare(`
      SELECT user_id, browser_id FROM user_browser_permissions
    `).all() as Array<{ user_id: string; browser_id: string }>;

    const permsByUser = new Map<string, string[]>();
    for (const p of perms) {
      const list = permsByUser.get(p.user_id) || [];
      list.push(p.browser_id);
      permsByUser.set(p.user_id, list);
    }

    return users.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      enabled: Boolean(u.enabled),
      browserAccessPolicy: (u.browser_access_policy as BrowserAccessPolicy) || 'ALL',
      allowedBrowserIds: permsByUser.get(u.id) || [],
      createdAt: u.created_at,
      updatedAt: u.updated_at
    }));
  }

  public async createUser(username: string, password: string, role: UserRole = 'tester', ip: string = '127.0.0.1'): Promise<AdminUserItem> {
    const db = getDb(this.config);
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      throw new Error(`用户名 "${username}" 已存在`);
    }

    const userId = crypto.randomUUID();
    const pwdHash = hashPassword(password);
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, enabled, auth_version, browser_access_policy, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, 'ALL', ?, ?)
    `).run(userId, username, pwdHash, role, now, now);

    this.logAudit('USER_CREATED', userId, null, { username, role }, ip);

    return {
      id: userId,
      username,
      role,
      enabled: true,
      browserAccessPolicy: 'ALL',
      allowedBrowserIds: [],
      createdAt: now,
      updatedAt: now
    };
  }

  public toggleUserStatus(userId: string, enabled: boolean, operatorId: string, ip: string = '127.0.0.1'): void {
    const db = getDb(this.config);
    const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!target) {
      throw new Error('用户不存在');
    }

    if (target.id === operatorId && !enabled) {
      throw new Error('不能停用当前登录的管理员账号');
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE users
      SET enabled = ?, auth_version = auth_version + 1, updated_at = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, now, userId);

    this.logAudit(enabled ? 'USER_ENABLED' : 'USER_DISABLED', userId, null, { username: target.username }, ip);
  }

  public checkUserBrowserPermission(userId: string, browserId: string): { permitted: boolean; reason?: string } {
    const db = getDb(this.config);
    const user = db.prepare('SELECT id, role, enabled, browser_access_policy FROM users WHERE id = ?').get(userId) as {
      id: string;
      role: UserRole;
      enabled: number;
      browser_access_policy?: BrowserAccessPolicy;
    } | undefined;

    if (!user || !user.enabled) {
      return { permitted: false, reason: '用户不存在或已被停用' };
    }

    if (user.role === 'admin') {
      return { permitted: true };
    }

    const policy = user.browser_access_policy || 'ALL';
    if (policy === 'ALL') {
      return { permitted: true };
    }

    const hasPerm = db.prepare(`
      SELECT 1 FROM user_browser_permissions WHERE user_id = ? AND browser_id = ?
    `).get(userId, browserId);

    if (hasPerm) {
      return { permitted: true };
    }

    return {
      permitted: false,
      reason: '未获得该浏览器的访问权限，请向管理员提交审批申请'
    };
  }

  public getUserAllowedBrowsers(userId: string): { policy: BrowserAccessPolicy; allowedBrowserIds: string[] } {
    const db = getDb(this.config);
    const user = db.prepare('SELECT role, browser_access_policy FROM users WHERE id = ?').get(userId) as {
      role: UserRole;
      browser_access_policy?: BrowserAccessPolicy;
    } | undefined;

    if (!user) {
      return { policy: 'ALL', allowedBrowserIds: [] };
    }

    if (user.role === 'admin' || (user.browser_access_policy || 'ALL') === 'ALL') {
      return { policy: 'ALL', allowedBrowserIds: [] };
    }

    const rows = db.prepare('SELECT browser_id FROM user_browser_permissions WHERE user_id = ?').all(userId) as Array<{ browser_id: string }>;
    return {
      policy: 'CUSTOM',
      allowedBrowserIds: rows.map((r) => r.browser_id)
    };
  }

  public updateUserBrowserPermissions(
    userId: string,
    policy: BrowserAccessPolicy,
    allowedBrowserIds: string[],
    ip: string = '127.0.0.1'
  ): void {
    const db = getDb(this.config);
    const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as UserRow | undefined;
    if (!user) {
      throw new Error('用户不存在');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE users SET browser_access_policy = ?, updated_at = ? WHERE id = ?').run(policy, now, userId);

    db.prepare('DELETE FROM user_browser_permissions WHERE user_id = ?').run(userId);

    if (policy === 'CUSTOM' && allowedBrowserIds.length > 0) {
      const insert = db.prepare('INSERT INTO user_browser_permissions (user_id, browser_id, created_at) VALUES (?, ?, ?)');
      for (const browserId of allowedBrowserIds) {
        insert.run(userId, browserId, now);
      }
    }

    this.logAudit('USER_PERMISSIONS_UPDATED', userId, null, {
      username: user.username,
      policy,
      allowedBrowserIds
    }, ip);
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
