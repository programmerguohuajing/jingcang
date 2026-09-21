import React, { useEffect, useState, useMemo } from 'react';
import { api } from '../api/client';
import {
  ShieldCheck,
  Cpu,
  HardDrive,
  Trash2,
  Activity,
  FileText,
  Users,
  CheckCircle,
  XCircle,
  Clock,
  Settings,
  UserPlus,
  Lock,
  Unlock,
  Check,
  X,
  AlertCircle,
  Layers,
  ChevronRight,
  Filter
} from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  AdminUserItem,
  ApprovalRequestItem,
  ApprovalStatus,
  BrowserAccessPolicy,
  BrowserItem,
  UserRole
} from '@jingcang/contracts';

export const AdminDashboardPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'approvals' | 'audits'>('overview');
  const [status, setStatus] = useState<any>(null);
  const [audits, setAudits] = useState<any[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequestItem[]>([]);
  const [browsers, setBrowsers] = useState<BrowserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Approval Filter
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<'ALL' | ApprovalStatus>('ALL');

  // User Status Toggle Confirm Modal
  const [pendingUserToggle, setPendingUserToggle] = useState<AdminUserItem | null>(null);
  const [userToggleSaving, setUserToggleSaving] = useState(false);
  const [userToggleError, setUserToggleError] = useState('');

  // Assign Browser Permissions Modal
  const [assignUser, setAssignUser] = useState<AdminUserItem | null>(null);
  const [assignPolicy, setAssignPolicy] = useState<BrowserAccessPolicy>('ALL');
  const [assignAllowedIds, setAssignAllowedIds] = useState<string[]>([]);
  const [assignSaving, setAssignSaving] = useState(false);

  // Create User Modal
  const [showCreateUserModal, setShowCreateUserModal] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('tester');
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState('');

  // Review Approval Modal
  const [reviewItem, setReviewItem] = useState<ApprovalRequestItem | null>(null);
  const [reviewAction, setReviewAction] = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);

  const loadAllData = async () => {
    setLoading(true);
    try {
      const [s, a, u, app, b] = await Promise.all([
        api.getAdminStatus(),
        api.getAuditEvents(),
        api.getAdminUsers(),
        api.getAdminApprovals(),
        api.getBrowsers(true)
      ]);
      setStatus(s);
      setAudits(a);
      setUsers(u);
      setApprovals(app);
      setBrowsers(b);
    } catch (err: any) {
      console.error(err);
      setNotice({ type: 'error', message: err.message || '加载管理数据失败' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllData();
  }, []);

  const pendingApprovalsCount = useMemo(() => {
    return approvals.filter((a) => a.status === 'PENDING').length;
  }, [approvals]);

  const filteredApprovals = useMemo(() => {
    if (approvalStatusFilter === 'ALL') return approvals;
    return approvals.filter((a) => a.status === approvalStatusFilter);
  }, [approvals, approvalStatusFilter]);

  const browserMap = useMemo(() => {
    const map = new Map<string, BrowserItem>();
    browsers.forEach((b) => map.set(b.id, b));
    return map;
  }, [browsers]);

  // Group browsers by vendor for permission modal
  const browsersByVendor = useMemo(() => {
    const groups: Record<string, { name: string; items: BrowserItem[] }> = {
      chrome: { name: 'Google Chrome', items: [] },
      edge: { name: 'Microsoft Edge', items: [] },
      firefox: { name: 'Mozilla Firefox', items: [] },
      chromium: { name: 'Chromium', items: [] }
    };
    for (const b of browsers) {
      const v = (b.browserName || '').toLowerCase();
      if (!groups[v]) {
        groups[v] = { name: b.browserName, items: [] };
      }
      groups[v].items.push(b);
    }
    return Object.entries(groups).filter(([_, g]) => g.items.length > 0);
  }, [browsers]);

  const handleManualCleanup = async () => {
    setCleaning(true);
    try {
      const res = await api.triggerCleanup();
      setNotice({
        type: 'success',
        message: `清理完成！释放 ${res.expiredCount} 个到期会话，回收 ${res.idleTerminatedCount || 0} 个空闲会话，清除 ${res.cleanedArtifacts} 个废弃产物。`
      });
      loadAllData();
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || '清理失败' });
    } finally {
      setCleaning(false);
    }
  };

  // Toggle user status trigger
  const handleToggleUserStatus = (user: AdminUserItem) => {
    setUserToggleError('');
    setPendingUserToggle(user);
  };

  // Confirm user status toggle
  const handleConfirmUserToggle = async () => {
    if (!pendingUserToggle) return;
    const user = pendingUserToggle;
    const next = !user.enabled;
    const actionText = next ? '启用' : '停用';
    setUserToggleSaving(true);
    setUserToggleError('');

    try {
      await api.toggleUserStatus(user.id, next);
      setNotice({ type: 'success', message: `已成功${actionText}用户 ${user.username}` });
      setPendingUserToggle(null);
      const updated = await api.getAdminUsers();
      setUsers(updated);
    } catch (err: any) {
      setUserToggleError(err.message || '修改用户状态失败');
    } finally {
      setUserToggleSaving(false);
    }
  };

  // Open Assign Permissions Modal
  const handleOpenAssignModal = (user: AdminUserItem) => {
    setAssignUser(user);
    setAssignPolicy(user.browserAccessPolicy || 'ALL');
    setAssignAllowedIds([...(user.allowedBrowserIds || [])]);
  };

  // Save Permissions
  const handleSavePermissions = async () => {
    if (!assignUser) return;
    setAssignSaving(true);
    try {
      await api.updateUserPermissions(assignUser.id, {
        browserAccessPolicy: assignPolicy,
        allowedBrowserIds: assignPolicy === 'ALL' ? [] : assignAllowedIds
      });
      setNotice({ type: 'success', message: `已更新用户 ${assignUser.username} 的浏览器使用权限！` });
      setAssignUser(null);
      const updated = await api.getAdminUsers();
      setUsers(updated);
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || '更新权限失败' });
    } finally {
      setAssignSaving(false);
    }
  };

  // Create User
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    if (!newUsername.trim()) {
      setCreateError('请输入用户名');
      return;
    }
    if (newPassword.length < 6) {
      setCreateError('密码至少 6 位');
      return;
    }
    setCreateSaving(true);
    try {
      const created = await api.createAdminUser({
        username: newUsername.trim(),
        password: newPassword,
        role: newRole
      });
      setNotice({ type: 'success', message: `用户 "${created.username}" 创建成功！` });
      setShowCreateUserModal(false);
      setNewUsername('');
      setNewPassword('');
      setNewRole('tester');
      const updated = await api.getAdminUsers();
      setUsers(updated);
    } catch (err: any) {
      setCreateError(err.message || '创建用户失败');
    } finally {
      setCreateSaving(false);
    }
  };

  // Open Review Modal
  const handleOpenReviewModal = (item: ApprovalRequestItem, action: 'APPROVE' | 'REJECT') => {
    setReviewItem(item);
    setReviewAction(action);
    setReviewComment(action === 'APPROVE' ? '准予使用' : '管理员驳回申请');
  };

  // Submit Review
  const handleSubmitReview = async () => {
    if (!reviewItem) return;
    setReviewSaving(true);
    try {
      await api.reviewApproval(reviewItem.id, {
        action: reviewAction,
        comment: reviewComment.trim() || undefined
      });
      setNotice({
        type: 'success',
        message: `审批完成：已${reviewAction === 'APPROVE' ? '通过' : '驳回'}该申请！`
      });
      setReviewItem(null);
      const [updatedApprovals, updatedUsers] = await Promise.all([
        api.getAdminApprovals(),
        api.getAdminUsers()
      ]);
      setApprovals(updatedApprovals);
      setUsers(updatedUsers);
    } catch (err: any) {
      setNotice({ type: 'error', message: err.message || '审批操作失败' });
    } finally {
      setReviewSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted, #94a3b8)' }}>正在读取管理数据...</div>;
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: '1280px', margin: '0 auto' }}>
      {/* Toast Notice */}
      {notice && (
        <div style={{
          position: 'fixed',
          top: '80px',
          right: '24px',
          zIndex: 999,
          padding: '12px 20px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          backgroundColor: notice.type === 'success' ? '#065f46' : '#991b1b',
          color: '#fff',
          fontSize: '14px',
          animation: 'fadeIn 0.2s ease'
        }}>
          {notice.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          <span>{notice.message}</span>
          <button
            onClick={() => setNotice(null)}
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: '8px' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShieldCheck size={26} style={{ color: 'var(--primary-color, #38bdf8)' }} />
            管理与授权控制台 (Admin Dashboard)
          </h1>
          <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '14px', marginTop: '4px' }}>
            用户细粒度浏览器授权矩阵 · 审批中心工单流转 · 系统容量与会话监控
          </p>
        </div>

        {activeTab === 'overview' && (
          <button
            onClick={handleManualCleanup}
            disabled={cleaning}
            className="btn-danger"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Trash2 size={16} /> {cleaning ? '清理中...' : '手动执行会话与产物清理'}
          </button>
        )}

        {activeTab === 'users' && (
          <button
            onClick={() => setShowCreateUserModal(true)}
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <UserPlus size={16} /> 新建用户
          </button>
        )}
      </div>

      {/* Navigation Tabs */}
      <div style={{
        display: 'flex',
        gap: '4px',
        borderBottom: '1px solid var(--border-color)',
        marginBottom: '28px'
      }}>
        <button
          onClick={() => setActiveTab('overview')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'overview' ? '2px solid var(--primary-color, #38bdf8)' : '2px solid transparent',
            color: activeTab === 'overview' ? 'var(--primary-color, #38bdf8)' : 'var(--text-muted, #94a3b8)',
            fontWeight: activeTab === 'overview' ? 600 : 400,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px'
          }}
        >
          <Cpu size={16} /> 运行概况与容量
        </button>

        <button
          onClick={() => setActiveTab('users')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'users' ? '2px solid var(--primary-color, #38bdf8)' : '2px solid transparent',
            color: activeTab === 'users' ? 'var(--primary-color, #38bdf8)' : 'var(--text-muted, #94a3b8)',
            fontWeight: activeTab === 'users' ? 600 : 400,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px'
          }}
        >
          <Users size={16} /> 用户与浏览器授权
          <span style={{
            fontSize: '11px',
            padding: '2px 6px',
            borderRadius: '10px',
            backgroundColor: 'var(--bg-subtle, #334155)',
            color: 'var(--text-muted, #cbd5e1)'
          }}>
            {users.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('approvals')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'approvals' ? '2px solid var(--primary-color, #38bdf8)' : '2px solid transparent',
            color: activeTab === 'approvals' ? 'var(--primary-color, #38bdf8)' : 'var(--text-muted, #94a3b8)',
            fontWeight: activeTab === 'approvals' ? 600 : 400,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px'
          }}
        >
          <Clock size={16} /> 审批中心
          {pendingApprovalsCount > 0 ? (
            <span style={{
              fontSize: '11px',
              padding: '2px 7px',
              borderRadius: '10px',
              backgroundColor: '#d97706',
              color: '#fff',
              fontWeight: 'bold'
            }}>
              {pendingApprovalsCount} 待处理
            </span>
          ) : (
            <span style={{
              fontSize: '11px',
              padding: '2px 6px',
              borderRadius: '10px',
              backgroundColor: 'var(--bg-subtle, #334155)',
              color: 'var(--text-muted, #cbd5e1)'
            }}>
              {approvals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('audits')}
          style={{
            padding: '12px 20px',
            background: 'none',
            border: 'none',
            borderBottom: activeTab === 'audits' ? '2px solid var(--primary-color, #38bdf8)' : '2px solid transparent',
            color: activeTab === 'audits' ? 'var(--primary-color, #38bdf8)' : 'var(--text-muted, #94a3b8)',
            fontWeight: activeTab === 'audits' ? 600 : 400,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '14px'
          }}
        >
          <FileText size={16} /> 安全审计日志
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === 'overview' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
            <div className="card">
              <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cpu size={16} /> 最大允许并发测试舱
              </div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: 'var(--primary-color, #38bdf8)', marginTop: '8px' }}>
                {status?.activeSessions || 0} / {status?.maxConcurrency || 4}
              </div>
            </div>

            <div className="card">
              <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Activity size={16} /> 等待队列中的请求
              </div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#d97706', marginTop: '8px' }}>
                {status?.queuedSessions || 0}
              </div>
            </div>

            <div className="card">
              <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Users size={16} /> 系统注册用户总数
              </div>
              <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#6366f1', marginTop: '8px' }}>
                {status?.totalUsers || users.length} 位
              </div>
            </div>

            <div className="card">
              <div style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <HardDrive size={16} /> 产物保留策略
              </div>
              <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#059669', marginTop: '8px' }}>
                {status?.artifactRetentionDays || 7} 天 / {status?.artifactMaxTotalGb || 50} GB
              </div>
            </div>
          </div>

          <div className="card" style={{ padding: '24px', backgroundColor: 'var(--bg-subtle)' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', color: 'var(--text-main)' }}>
              系统运行参数与网络配置
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px', fontSize: '13px' }}>
              <div>
                <span style={{ color: 'var(--text-muted, #94a3b8)' }}>局域网远端访问: </span>
                <strong style={{ color: status?.lanAccessEnabled ? '#059669' : '#d97706' }}>
                  {status?.lanAccessEnabled ? '已启用 (全网段开放)' : '未启用 (仅限本机 127.0.0.1)'}
                </strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted, #94a3b8)' }}>总测试舱调度记录: </span>
                <strong style={{ color: 'var(--text-main)' }}>{status?.totalSessions || 0} 次</strong>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted, #94a3b8)' }}>待处理权限/安装审批: </span>
                <strong style={{ color: pendingApprovalsCount > 0 ? '#d97706' : '#059669' }}>
                  {pendingApprovalsCount} 笔工单
                </strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Users & Browser Permissions */}
      {activeTab === 'users' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '16px 20px',
            backgroundColor: 'var(--table-header-bg)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <div style={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
              <Users size={18} /> 用户账号与浏览器授权矩阵
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>
              共 {users.length} 个账号 · 默认策略为全量访问，可针对指定普通用户设置白名单
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted, #94a3b8)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '12px 16px' }}>用户名</th>
                <th style={{ padding: '12px 16px' }}>系统角色</th>
                <th style={{ padding: '12px 16px' }}>账号状态</th>
                <th style={{ padding: '12px 16px' }}>浏览器授权模式</th>
                <th style={{ padding: '12px 16px' }}>已授权浏览器规格</th>
                <th style={{ padding: '12px 16px' }}>注册时间</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isCustom = u.browserAccessPolicy === 'CUSTOM';
                const allowedCount = u.allowedBrowserIds?.length || 0;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle, #1e293b)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          backgroundColor: u.role === 'admin' ? 'rgba(2, 132, 199, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                          color: u.role === 'admin' ? 'var(--primary-color, #38bdf8)' : '#818cf8',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '12px',
                          fontWeight: 'bold'
                        }}>
                          {u.username.slice(0, 2).toUpperCase()}
                        </div>
                        {u.username}
                      </div>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: u.role === 'admin' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                        color: u.role === 'admin' ? 'var(--primary-color, #38bdf8)' : 'var(--text-muted, #94a3b8)',
                        fontWeight: 'bold'
                      }}>
                        {u.role === 'admin' ? '管理员 (Admin)' : '测试员 (Tester)'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: u.enabled ? 'rgba(5, 150, 105, 0.15)' : 'rgba(220, 38, 38, 0.15)',
                        color: u.enabled ? '#34d399' : '#f87171'
                      }}>
                        {u.enabled ? '正常' : '已停用'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{
                        fontSize: '12px',
                        fontWeight: 500,
                        color: isCustom ? '#f59e0b' : '#38bdf8'
                      }}>
                        {isCustom ? '🎯 自定义授权' : '🌐 全量可用 (ALL)'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      {u.role === 'admin' ? (
                        <span style={{ color: 'var(--text-subtle, #64748b)', fontSize: '12px' }}>管理员拥有全部最高权限</span>
                      ) : isCustom ? (
                        allowedCount === 0 ? (
                          <span style={{ color: '#f87171', fontSize: '12px' }}>⚠️ 未授权任何浏览器</span>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '380px' }}>
                            {u.allowedBrowserIds.map((bid) => {
                              const bItem = browserMap.get(bid);
                              const label = bItem ? bItem.displayName : bid;
                              return (
                                <span
                                  key={bid}
                                  style={{
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: 'var(--bg-surface)',
                                    border: '1px solid var(--border-subtle, #334155)',
                                    color: 'var(--text-muted, #cbd5e1)'
                                  }}
                                >
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        )
                      ) : (
                        <span style={{ color: '#34d399', fontSize: '12px' }}>全部已上架规格均可直接使用</span>
                      )}
                    </td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-subtle, #64748b)' }}>
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {u.role !== 'admin' && (
                          <button
                            onClick={() => handleOpenAssignModal(u)}
                            className="btn-secondary"
                            style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <Settings size={13} /> 分配浏览器
                          </button>
                        )}
                        <button
                          onClick={() => handleToggleUserStatus(u)}
                          className={`btn-secondary ${u.enabled ? 'btn-toggle-disable' : 'btn-toggle-enable'}`}
                          style={{
                            padding: '4px 10px',
                            fontSize: '12px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          {u.enabled ? <Lock size={13} /> : <Unlock size={13} />}
                          {u.enabled ? '停用' : '启用'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Tab 3: Approvals Center */}
      {activeTab === 'approvals' && (
        <div>
          {/* Status Filter Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              {(['ALL', 'PENDING', 'APPROVED', 'REJECTED'] as const).map((st) => {
                const count = st === 'ALL' ? approvals.length : approvals.filter((a) => a.status === st).length;
                const labels = {
                  ALL: '全部工单',
                  PENDING: '待审核',
                  APPROVED: '已通过',
                  REJECTED: '已驳回'
                };
                const active = approvalStatusFilter === st;
                return (
                  <button
                    key={st}
                    onClick={() => setApprovalStatusFilter(st)}
                    className="btn-secondary"
                    style={{
                      padding: '6px 14px',
                      fontSize: '13px',
                      backgroundColor: active ? 'var(--primary-color, #38bdf8)' : undefined,
                      color: active ? '#fff' : undefined,
                      borderColor: active ? 'var(--primary-color, #38bdf8)' : undefined
                    }}
                  >
                    {labels[st]} ({count})
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted, #94a3b8)' }}>
              审核通过后系统将自动下发该浏览器权限给申请人
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
              <thead>
                <tr style={{ color: 'var(--text-muted, #94a3b8)', borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ padding: '12px 16px' }}>申请时间</th>
                  <th style={{ padding: '12px 16px' }}>工单类型</th>
                  <th style={{ padding: '12px 16px' }}>申请人</th>
                  <th style={{ padding: '12px 16px' }}>目标浏览器 / 需求</th>
                  <th style={{ padding: '12px 16px' }}>申请事由</th>
                  <th style={{ padding: '12px 16px' }}>审批状态</th>
                  <th style={{ padding: '12px 16px' }}>审批信息</th>
                  <th style={{ padding: '12px 16px', textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredApprovals.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted, #94a3b8)' }}>
                      暂无相关审批工单记录
                    </td>
                  </tr>
                ) : (
                  filteredApprovals.map((item) => {
                    const browser = item.targetId ? browserMap.get(item.targetId) : null;
                    const targetDisplay = browser
                      ? `${browser.displayName || browser.browserName} v${browser.version}`
                      : item.targetId || '-';

                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid var(--border-subtle, #1e293b)' }}>
                        <td style={{ padding: '12px 16px', color: 'var(--text-subtle, #64748b)' }}>
                          {new Date(item.createdAt).toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            backgroundColor: item.type === 'BROWSER_ACCESS' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                            color: item.type === 'BROWSER_ACCESS' ? 'var(--primary-color, #38bdf8)' : '#c084fc',
                            fontWeight: 'bold'
                          }}>
                            {item.type === 'BROWSER_ACCESS' ? '🔑 浏览器访问权限' : '📦 接入新版本'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                          {item.username}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <strong style={{ color: 'var(--text-main)' }}>{targetDisplay}</strong>
                          {item.targetId && (
                            <div style={{ fontSize: '11px', color: 'var(--text-subtle, #64748b)' }}>
                              <code>{item.targetId}</code>
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', color: 'var(--text-muted, #cbd5e1)', maxWidth: '240px' }}>
                          {item.reason}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{
                            fontSize: '11px',
                            padding: '2px 8px',
                            borderRadius: '4px',
                            fontWeight: 'bold',
                            backgroundColor:
                              item.status === 'PENDING'
                                ? 'rgba(217, 119, 6, 0.15)'
                                : item.status === 'APPROVED'
                                ? 'rgba(5, 150, 105, 0.15)'
                                : 'rgba(220, 38, 38, 0.15)',
                            color:
                              item.status === 'PENDING'
                                ? '#fbbf24'
                                : item.status === 'APPROVED'
                                ? '#34d399'
                                : '#f87171'
                          }}>
                            {item.status === 'PENDING' ? '⏳ 待审核' : item.status === 'APPROVED' ? '✅ 已通过' : '❌ 已驳回'}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '12px', color: 'var(--text-muted, #94a3b8)' }}>
                          {item.status !== 'PENDING' ? (
                            <div>
                              <div>审核人: <strong>{item.reviewedBy || '-'}</strong></div>
                              {item.reviewComment && <div>批注: <em>{item.reviewComment}</em></div>}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-subtle, #64748b)' }}>等待管理员操作</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                          {item.status === 'PENDING' ? (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                              <button
                                onClick={() => handleOpenReviewModal(item, 'APPROVE')}
                                className="btn-primary"
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '12px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  backgroundColor: '#059669',
                                  borderColor: '#059669'
                                }}
                              >
                                <Check size={13} /> 通过
                              </button>
                              <button
                                onClick={() => handleOpenReviewModal(item, 'REJECT')}
                                className="btn-secondary btn-toggle-disable"
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '12px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                              >
                                <X size={13} /> 驳回
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-subtle, #64748b)', fontSize: '12px' }}>已归档</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 4: Audit Logs */}
      {activeTab === 'audits' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{
            padding: '16px 20px',
            backgroundColor: 'var(--table-header-bg)',
            borderBottom: '1px solid var(--border-color)',
            fontWeight: 'bold',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--text-main)'
          }}>
            <FileText size={18} /> 最近 100 条安全审计日志 (Audit Log)
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted, #94a3b8)', borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ padding: '10px 16px' }}>时间</th>
                <th style={{ padding: '10px 16px' }}>事件类型</th>
                <th style={{ padding: '10px 16px' }}>操作用户</th>
                <th style={{ padding: '10px 16px' }}>目标测试舱 / 会话</th>
                <th style={{ padding: '10px 16px' }}>IP 地址</th>
              </tr>
            </thead>
            <tbody>
              {audits.map((a) => (
                <tr key={a.id} style={{ borderBottom: '1px solid var(--border-subtle, #1e293b)' }}>
                  <td style={{ padding: '10px 16px', color: 'var(--text-subtle, #64748b)' }}>
                    {new Date(a.created_at).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px 16px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                    {a.event_type}
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-muted, #cbd5e1)' }}>
                    {a.username || a.user_id || '系统/未登录'}
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--primary-color, #38bdf8)' }}>
                    {a.session_id || '-'}
                  </td>
                  <td style={{ padding: '10px 16px', color: 'var(--text-subtle, #64748b)' }}>{a.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal 1: Assign Browser Permissions */}
      {assignUser && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(3px)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            width: '640px',
            maxWidth: '90vw',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            {/* Modal Header */}
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <h2 style={{ fontSize: '18px', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Settings size={20} style={{ color: 'var(--primary-color, #38bdf8)' }} />
                  配置浏览器权限 - {assignUser.username}
                </h2>
                <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px' }}>
                  指定该用户可以调度的浏览器规格列表
                </div>
              </div>
              <button
                onClick={() => setAssignUser(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '24px', overflowY: 'auto', flex: 1 }}>
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '10px', color: 'var(--text-main)' }}>
                  权限模式
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div
                    onClick={() => setAssignPolicy('ALL')}
                    style={{
                      border: assignPolicy === 'ALL' ? '2px solid var(--primary-color, #38bdf8)' : '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '14px',
                      cursor: 'pointer',
                      backgroundColor: assignPolicy === 'ALL' ? 'rgba(56, 189, 248, 0.08)' : 'var(--bg-subtle)'
                    }}
                  >
                    <div style={{ fontWeight: 'bold', color: assignPolicy === 'ALL' ? 'var(--primary-color, #38bdf8)' : 'var(--text-main)', fontSize: '14px' }}>
                      🌐 允许使用全部规格
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px' }}>
                      该测试员可启动当前及后续新接入的全部浏览器规格。
                    </div>
                  </div>

                  <div
                    onClick={() => setAssignPolicy('CUSTOM')}
                    style={{
                      border: assignPolicy === 'CUSTOM' ? '2px solid var(--primary-color, #38bdf8)' : '1px solid var(--border-color)',
                      borderRadius: '8px',
                      padding: '14px',
                      cursor: 'pointer',
                      backgroundColor: assignPolicy === 'CUSTOM' ? 'rgba(56, 189, 248, 0.08)' : 'var(--bg-subtle)'
                    }}
                  >
                    <div style={{ fontWeight: 'bold', color: assignPolicy === 'CUSTOM' ? 'var(--primary-color, #38bdf8)' : 'var(--text-main)', fontSize: '14px' }}>
                      🎯 细粒度自定义授权
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted, #94a3b8)', marginTop: '4px' }}>
                      仅允许启动在下方勾选授权的特定浏览器版本规格。
                    </div>
                  </div>
                </div>
              </div>

              {/* Browser Checkboxes if CUSTOM */}
              {assignPolicy === 'CUSTOM' && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <label style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-main)' }}>
                      选择允许访问的浏览器规格 ({assignAllowedIds.length} / {browsers.length} 已选)
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setAssignAllowedIds(browsers.map((b) => b.id))}
                        className="btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                      >
                        全部勾选
                      </button>
                      <button
                        type="button"
                        onClick={() => setAssignAllowedIds([])}
                        className="btn-secondary"
                        style={{ padding: '2px 8px', fontSize: '11px' }}
                      >
                        清空选择
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {browsersByVendor.map(([vKey, group]) => {
                      const allGroupSelected = group.items.every((item) => assignAllowedIds.includes(item.id));
                      return (
                        <div
                          key={vKey}
                          style={{
                            border: '1px solid var(--border-subtle, #334155)',
                            borderRadius: '8px',
                            padding: '12px 16px',
                            backgroundColor: 'var(--bg-subtle)'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '13px', color: 'var(--text-main)' }}>
                              {group.name} ({group.items.length})
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (allGroupSelected) {
                                  const groupIds = new Set(group.items.map((i) => i.id));
                                  setAssignAllowedIds(assignAllowedIds.filter((id) => !groupIds.has(id)));
                                } else {
                                  const next = new Set(assignAllowedIds);
                                  group.items.forEach((i) => next.add(i.id));
                                  setAssignAllowedIds(Array.from(next));
                                }
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: 'var(--primary-color, #38bdf8)',
                                fontSize: '12px',
                                cursor: 'pointer'
                              }}
                            >
                              {allGroupSelected ? '取消全选' : '全选本组'}
                            </button>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' }}>
                            {group.items.map((b) => {
                              const checked = assignAllowedIds.includes(b.id);
                              return (
                                <label
                                  key={b.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '12px',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    backgroundColor: checked ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg-surface)',
                                    border: checked ? '1px solid var(--primary-color, #38bdf8)' : '1px solid var(--border-color)',
                                    color: checked ? 'var(--text-main)' : 'var(--text-muted, #cbd5e1)'
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setAssignAllowedIds([...assignAllowedIds, b.id]);
                                      } else {
                                        setAssignAllowedIds(assignAllowedIds.filter((id) => id !== b.id));
                                      }
                                    }}
                                  />
                                  <span>v{b.version}</span>
                                  {b.isDefault && (
                                    <span style={{ fontSize: '10px', color: '#34d399' }}>(推荐)</span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
              backgroundColor: 'var(--table-header-bg)'
            }}>
              <button
                type="button"
                onClick={() => setAssignUser(null)}
                className="btn-secondary"
                disabled={assignSaving}
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSavePermissions}
                className="btn-primary"
                disabled={assignSaving}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Check size={16} /> {assignSaving ? '保存中...' : '保存授权配置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Create User */}
      {showCreateUserModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(3px)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            width: '460px',
            maxWidth: '90vw',
            overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{ fontSize: '18px', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={20} style={{ color: 'var(--primary-color, #38bdf8)' }} />
                新建平台账号
              </h2>
              <button
                onClick={() => setShowCreateUserModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} style={{ padding: '24px' }}>
              {createError && (
                <div style={{
                  padding: '10px 14px',
                  backgroundColor: 'rgba(220, 38, 38, 0.15)',
                  border: '1px solid #dc2626',
                  borderRadius: '6px',
                  color: '#fca5a5',
                  fontSize: '13px',
                  marginBottom: '16px'
                }}>
                  {createError}
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: 'var(--text-main)' }}>
                  用户名
                </label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="例如: tester_zhang"
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: 'var(--text-main)' }}>
                  初始登录密码
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="至少 6 位字符"
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    fontSize: '14px'
                  }}
                />
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: 'var(--text-main)' }}>
                  系统角色
                </label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as UserRole)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    fontSize: '14px'
                  }}
                >
                  <option value="tester">测试员 (Tester) - 适用普通业务人员，受权限与审批管控</option>
                  <option value="admin">管理员 (Admin) - 拥有所有规格访问权与审批管理权</option>
                </select>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setShowCreateUserModal(false)}
                  className="btn-secondary"
                  disabled={createSaving}
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={createSaving}
                >
                  {createSaving ? '创建中...' : '确认创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Review Approval Modal */}
      {reviewItem && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(3px)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            width: '500px',
            maxWidth: '90vw',
            overflow: 'hidden',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
          }}>
            <div style={{
              padding: '18px 24px',
              borderBottom: '1px solid var(--border-color)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h2 style={{ fontSize: '18px', margin: 0, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {reviewAction === 'APPROVE' ? (
                  <CheckCircle size={20} style={{ color: '#34d399' }} />
                ) : (
                  <XCircle size={20} style={{ color: '#f87171' }} />
                )}
                {reviewAction === 'APPROVE' ? '审批通过申请' : '驳回申请'}
              </h2>
              <button
                onClick={() => setReviewItem(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '24px' }}>
              <div style={{
                backgroundColor: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle, #334155)',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '20px',
                fontSize: '13px'
              }}>
                <div style={{ marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted, #94a3b8)' }}>申请人: </span>
                  <strong style={{ color: 'var(--text-main)' }}>{reviewItem.username}</strong>
                </div>
                <div style={{ marginBottom: '6px' }}>
                  <span style={{ color: 'var(--text-muted, #94a3b8)' }}>申请目标: </span>
                  <strong style={{ color: 'var(--primary-color, #38bdf8)' }}>{reviewItem.title}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted, #94a3b8)' }}>申请事由: </span>
                  <span style={{ color: 'var(--text-muted, #cbd5e1)' }}>{reviewItem.reason}</span>
                </div>
              </div>

              <div style={{ marginBottom: '24px' }}>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '6px', color: 'var(--text-main)' }}>
                  审批批注说明 (可选)
                </label>
                <textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="请输入审核批注..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-subtle)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-main)',
                    fontSize: '13px',
                    resize: 'vertical'
                  }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button
                  type="button"
                  onClick={() => setReviewItem(null)}
                  className="btn-secondary"
                  disabled={reviewSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleSubmitReview}
                  className={reviewAction === 'APPROVE' ? 'btn-primary' : 'btn-danger'}
                  disabled={reviewSaving}
                  style={{
                    backgroundColor: reviewAction === 'APPROVE' ? '#059669' : '#dc2626',
                    borderColor: reviewAction === 'APPROVE' ? '#059669' : '#dc2626'
                  }}
                >
                  {reviewSaving ? '处理中...' : reviewAction === 'APPROVE' ? '确认通过授权' : '确认驳回申请'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingUserToggle)}
        tone={pendingUserToggle?.enabled ? 'danger' : 'primary'}
        eyebrow="用户账号状态变动"
        title={
          pendingUserToggle
            ? pendingUserToggle.enabled
              ? `确认停用用户 "${pendingUserToggle.username}"？`
              : `确认启用用户 "${pendingUserToggle.username}"？`
            : ''
        }
        description={
          pendingUserToggle?.enabled
            ? '停用后该用户将无法登录控制台或新建/使用任何测试舱会话，已有连线也会受阻。'
            : '启用后该用户恢复登录控制台权限，并根据其授权策略自由创建测试舱会话。'
        }
        subject={pendingUserToggle ? `账号: ${pendingUserToggle.username} (${pendingUserToggle.role === 'admin' ? '系统管理员' : '测试人员'})` : undefined}
        confirmLabel={pendingUserToggle?.enabled ? '确认停用账号' : '确认启用账号'}
        loading={userToggleSaving}
        error={userToggleError}
        onConfirm={handleConfirmUserToggle}
        onCancel={() => {
          if (userToggleSaving) return;
          setPendingUserToggle(null);
          setUserToggleError('');
        }}
      />
    </div>
  );
};
