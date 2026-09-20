import crypto from 'node:crypto';
import { Config } from '../config.js';
import { getDb } from '../db/index.js';
import { AuthService } from './auth.service.js';
import { BrowserProvisioningService } from './browser-provisioning.service.js';
import { CatalogService } from './catalog.service.js';
import {
  ApprovalRequestItem,
  ApprovalStatus,
  ApprovalType,
  CreateApprovalRequest,
  ReviewApprovalRequest
} from '@jingcang/contracts';

interface ApprovalRow {
  id: string;
  type: ApprovalType;
  user_id: string;
  username: string;
  title: string;
  target_id: string | null;
  reason: string;
  status: ApprovalStatus;
  review_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class ApprovalService {
  constructor(
    private config: Config,
    private authService: AuthService,
    private catalogService: CatalogService,
    private provisioningService?: BrowserProvisioningService
  ) {}

  public setProvisioningService(provisioningService: BrowserProvisioningService) {
    this.provisioningService = provisioningService;
  }

  public createRequest(userId: string, username: string, input: CreateApprovalRequest): ApprovalRequestItem {
    const db = getDb(this.config);

    const existing = db.prepare(`
      SELECT id FROM approval_requests
      WHERE user_id = ? AND type = ? AND target_id = ? AND status = 'PENDING'
    `).get(userId, input.type, input.targetId) as { id: string } | undefined;

    if (existing) {
      throw new Error('您已有相同目标的审批申请正在等待管理员审核，无需重复提交');
    }

    const id = `req-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    let title = input.title;
    if (!title) {
      if (input.type === 'BROWSER_ACCESS') {
        const browser = this.catalogService.getBrowserById(input.targetId);
        title = browser
          ? `申请使用浏览器 [${browser.displayName} v${browser.version}]`
          : `申请使用浏览器 [${input.targetId}]`;
      } else {
        title = `申请接入新浏览器 [${input.targetId}]`;
      }
    }

    db.prepare(`
      INSERT INTO approval_requests (
        id, type, user_id, username, title, target_id, reason, status,
        review_comment, reviewed_by, reviewed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', NULL, NULL, NULL, ?, ?)
    `).run(id, input.type, userId, username, title, input.targetId, input.reason, now, now);

    this.authService.logAudit('APPROVAL_REQUESTED', userId, null, {
      requestId: id,
      type: input.type,
      targetId: input.targetId
    }, '127.0.0.1');

    return this.getRequest(id)!;
  }

  public getRequest(id: string): ApprovalRequestItem | null {
    const db = getDb(this.config);
    const row = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(id) as unknown as ApprovalRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  public listRequests(filter?: { userId?: string; status?: ApprovalStatus; type?: ApprovalType }): ApprovalRequestItem[] {
    const db = getDb(this.config);
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.userId) {
      conditions.push('user_id = ?');
      params.push(filter.userId);
    }
    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT * FROM approval_requests ${whereClause} ORDER BY created_at DESC LIMIT 200`;
    const rows = db.prepare(query).all(...params) as unknown as ApprovalRow[];
    return rows.map((r) => this.mapRow(r));
  }

  public reviewRequest(
    requestId: string,
    adminId: string,
    adminUsername: string,
    input: ReviewApprovalRequest,
    ip: string = '127.0.0.1'
  ): ApprovalRequestItem {
    const db = getDb(this.config);
    const req = db.prepare('SELECT * FROM approval_requests WHERE id = ?').get(requestId) as unknown as ApprovalRow | undefined;
    if (!req) {
      throw new Error('审批单不存在');
    }
    if (req.status !== 'PENDING') {
      throw new Error('该审批单已被处理，无法重复操作');
    }

    const now = new Date().toISOString();
    const newStatus: ApprovalStatus = input.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    const comment = input.comment || (input.action === 'APPROVE' ? '管理员审核通过' : '管理员驳回申请');

    if (input.action === 'APPROVE') {
      if (req.type === 'BROWSER_ACCESS' && req.target_id) {
        const userPerms = this.authService.getUserAllowedBrowsers(req.user_id);
        const currentAllowed = new Set(userPerms.allowedBrowserIds);
        currentAllowed.add(req.target_id);

        this.authService.updateUserBrowserPermissions(
          req.user_id,
          'CUSTOM',
          Array.from(currentAllowed),
          ip
        );
      } else if (req.type === 'BROWSER_INSTALL' && req.target_id && this.provisioningService) {
        try {
          let browserName: any = 'chrome';
          let version = '115';
          if (req.target_id.includes(':')) {
            const [b, v] = req.target_id.split(':');
            browserName = b;
            version = v;
          } else {
            version = req.target_id;
          }
          this.provisioningService.createInstallJob(req.user_id, {
            browserName,
            version
          });
        } catch (e: any) {
          console.warn('[ApprovalService] Auto trigger install job warning:', e?.message);
        }
      }
    }

    db.prepare(`
      UPDATE approval_requests
      SET status = ?, review_comment = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
      WHERE id = ?
    `).run(newStatus, comment, adminUsername, now, now, requestId);

    this.authService.logAudit('APPROVAL_REVIEWED', adminId, null, {
      requestId,
      type: req.type,
      applicantId: req.user_id,
      applicantUsername: req.username,
      status: newStatus,
      comment
    }, ip);

    return this.getRequest(requestId)!;
  }

  private mapRow(row: ApprovalRow): ApprovalRequestItem {
    return {
      id: row.id,
      type: row.type,
      userId: row.user_id,
      username: row.username,
      title: row.title,
      targetId: row.target_id,
      reason: row.reason,
      status: row.status,
      reviewComment: row.review_comment,
      reviewedBy: row.reviewed_by,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
