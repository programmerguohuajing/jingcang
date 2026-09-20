import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { SessionResponse } from '@jingcang/contracts';
import { ExternalLink, Square, RefreshCw, Clock, Trash2, CheckSquare } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';

type PendingSessionAction = {
  type: 'terminate' | 'delete' | 'batch-delete';
  session?: SessionResponse;
  selectedIds?: string[];
};

export const getStatusBadge = (status: string, failureCode?: string | null) => {
  if (status === 'TERMINATED' && failureCode === 'IDLE_TIMEOUT') {
    return <span className="badge badge-terminated">空闲回收</span>;
  }

  const map: Record<string, { label: string; className: string }> = {
    READY: { label: '运行中', className: 'badge-ready' },
    STARTING: { label: '启动中', className: 'badge-starting' },
    PROVISIONING: { label: '准备中', className: 'badge-provisioning' },
    QUEUED: { label: '排队中', className: 'badge-queued' },
    TERMINATING: { label: '正在结束', className: 'badge-terminating' },
    TERMINATED: { label: '已结束', className: 'badge-terminated' },
    EXPIRED: { label: '已过期', className: 'badge-expired' },
    FAILED: { label: '启动失败', className: 'badge-failed' },
    REQUESTED: { label: '已请求', className: 'badge-queued' },
    LOST: { label: '失联异常', className: 'badge-failed' },
    ORPHANED: { label: '孤立异常', className: 'badge-failed' }
  };

  const item = map[status] || { label: status, className: 'badge-terminated' };
  return (
    <span className={`badge ${item.className}`}>
      {item.label}
    </span>
  );
};

export const SessionListPage: React.FC = () => {
  const [sessions, setSessions] = useState<SessionResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingSessionAction | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const navigate = useNavigate();

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = await api.getSessions();
      setSessions(res.items);
      setTotal(res.total);
      // Remove any selected IDs that no longer exist
      setSelectedIds((prev) => prev.filter((id) => res.items.some((item) => item.id === id)));
    } catch (err: any) {
      setError(err.message || '加载测试舱列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 15000);
    return () => clearInterval(interval);
  }, []);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === sessions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(sessions.map((s) => s.id));
    }
  };

  const requestSessionAction = (type: 'terminate' | 'delete', session: SessionResponse) => {
    setConfirmError('');
    setPendingAction({ type, session });
  };

  const requestBatchDelete = () => {
    if (selectedIds.length === 0) return;
    setConfirmError('');
    setPendingAction({ type: 'batch-delete', selectedIds: [...selectedIds] });
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setConfirmLoading(true);
    setConfirmError('');
    if (action.type === 'batch-delete') setBatchDeleting(true);
    try {
      if (action.type === 'terminate' && action.session) {
        await api.terminateSession(action.session.id);
      } else if (action.type === 'delete' && action.session) {
        await api.deleteSession(action.session.id);
        setSelectedIds((prev) => prev.filter((item) => item !== action.session!.id));
      } else if (action.type === 'batch-delete' && action.selectedIds) {
        try {
          await api.batchDeleteSessions(action.selectedIds);
        } catch {
          await Promise.all(action.selectedIds.map((id) => api.deleteSession(id)));
        }
        setSelectedIds([]);
      }
      setPendingAction(null);
      await loadSessions();
    } catch (err: any) {
      const fallback = action.type === 'terminate'
        ? '结束测试舱失败'
        : action.type === 'delete'
          ? '删除记录失败'
          : '批量删除失败，请稍后重试';
      setConfirmError(err.message || fallback);
    } finally {
      setBatchDeleting(false);
      setConfirmLoading(false);
    }
  };

  const isAllSelected = sessions.length > 0 && selectedIds.length === sessions.length;
  const isPartiallySelected = selectedIds.length > 0 && selectedIds.length < sessions.length;

  return (
    <div style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', margin: 0, color: '#f8fafc' }}>测试舱运行记录 (Session List)</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
            共 {total} 条记录 · 正在运行与排队中的测试舱
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {selectedIds.length > 0 && (
            <button
              onClick={requestBatchDelete}
              disabled={batchDeleting}
              className="btn-danger"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px' }}
            >
              <Trash2 size={15} />
              {batchDeleting ? '正在删除...' : `批量删除 (${selectedIds.length})`}
            </button>
          )}
          <button onClick={loadSessions} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={16} /> 刷新
          </button>
        </div>
      </div>

      {error && (
        <div style={{ backgroundColor: 'rgba(220, 38, 38, 0.2)', border: '1px solid #dc2626', color: '#f87171', padding: '12px', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {/* Batch Selection Banner */}
      {selectedIds.length > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          backgroundColor: 'var(--primary-light-bg, rgba(56, 189, 248, 0.12))',
          border: '1px solid var(--primary-color, #0284c7)',
          padding: '10px 16px',
          borderRadius: '8px',
          marginBottom: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <CheckSquare size={18} color="var(--primary-color, #38bdf8)" />
            <span style={{ color: 'var(--text-main, #f8fafc)', fontSize: '14px' }}>
              已勾选 <strong style={{ color: 'var(--primary-color, #38bdf8)' }}>{selectedIds.length}</strong> 项测试舱记录
            </span>
            <button
              onClick={() => setSelectedIds([])}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted, #94a3b8)',
                cursor: 'pointer',
                fontSize: '13px',
                textDecoration: 'underline',
                padding: '0 4px'
              }}
            >
              取消全选
            </button>
          </div>
          <button
            onClick={requestBatchDelete}
            disabled={batchDeleting}
            className="btn-danger"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px' }}
          >
            <Trash2 size={15} />
            {batchDeleting ? '正在删除...' : `彻底删除已选 (${selectedIds.length})`}
          </button>
        </div>
      )}

      {loading && sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted, #94a3b8)' }}>正在读取列表...</div>
      ) : sessions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted, #94a3b8)' }}>
          暂无任何测试舱记录。点击“浏览器舱位”开启第一个兼容性测试舱！
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--table-header-bg, #0f172a)', borderBottom: '1px solid var(--border-color, #334155)', color: 'var(--text-muted, #cbd5e1)' }}>
                <th style={{ padding: '12px 14px', width: '44px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = isPartiallySelected;
                    }}
                    onChange={toggleSelectAll}
                    style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#2563eb' }}
                    title={isAllSelected ? '取消全选' : '全选当前页'}
                  />
                </th>
                <th style={{ padding: '12px 16px' }}>ID / 名称</th>
                <th style={{ padding: '12px 16px' }}>浏览器</th>
                <th style={{ padding: '12px 16px' }}>状态</th>
                <th style={{ padding: '12px 16px' }}>目标 URL</th>
                <th style={{ padding: '12px 16px' }}>创建人</th>
                <th style={{ padding: '12px 16px' }}>到期时间</th>
                <th style={{ padding: '12px 16px', textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const isActive = s.status === 'READY' || s.status === 'STARTING';
                const isSelected = selectedIds.includes(s.id);
                return (
                  <tr
                    key={s.id}
                    style={{
                      borderBottom: '1px solid var(--border-subtle, #1e293b)',
                      backgroundColor: isSelected ? 'var(--primary-light-bg, rgba(59, 130, 246, 0.08))' : 'transparent',
                      transition: 'background-color 0.15s ease'
                    }}
                  >
                    <td style={{ padding: '14px 14px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(s.id)}
                        style={{ cursor: 'pointer', width: '16px', height: '16px', accentColor: '#2563eb' }}
                      />
                    </td>
                    <td style={{ padding: '14px 16px', fontWeight: 'bold' }}>
                      <span style={{ color: 'var(--text-main, #f8fafc)' }}>{s.id}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ color: 'var(--primary-color, #38bdf8)' }}>{s.browserName} v{s.browserVersion}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {getStatusBadge(s.status, s.failureCode)}
                    </td>
                    <td style={{ padding: '14px 16px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <code style={{ color: 'var(--code-text, #a7f3d0)' }}>{s.startUrl}</code>
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-muted, #cbd5e1)' }}>
                      {s.username}
                    </td>
                    <td style={{ padding: '14px 16px', color: 'var(--text-subtle, #94a3b8)', fontSize: '12px' }}>
                      {new Date(s.expiresAt).toLocaleTimeString()}
                    </td>
                    <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                        {isActive ? (
                          <>
                            <button
                              onClick={() => navigate(`/viewer/${s.id}`)}
                              className="btn-primary"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', fontSize: '12px' }}
                            >
                              <ExternalLink size={14} /> 进入操作
                            </button>
                            <button
                              onClick={() => requestSessionAction('terminate', s)}
                              className="btn-danger"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '12px' }}
                            >
                              <Square size={14} /> 结束
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => requestSessionAction('delete', s)}
                            className="btn-secondary"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '12px', color: '#f87171' }}
                            title="从列表中彻底删除该历史记录"
                          >
                            <Trash2 size={14} /> 删除记录
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(pendingAction)}
        tone="danger"
        eyebrow={pendingAction?.type === 'terminate' ? '资源回收确认' : '不可撤销操作'}
        title={pendingAction?.type === 'terminate'
          ? '立即结束这个测试舱？'
          : pendingAction?.type === 'batch-delete'
            ? `永久删除选中的 ${pendingAction.selectedIds?.length || 0} 条记录？`
            : '永久删除这条测试记录？'}
        description={pendingAction?.type === 'terminate'
          ? '测试舱将立即断开，底层浏览器资源会被释放，舱内尚未保存的临时数据也会丢失。'
          : pendingAction?.type === 'batch-delete'
            ? '所选测试记录及其关联数据、录像与其他产物将被同步清理，操作完成后无法恢复。'
            : '该历史记录及其关联产物将从系统中永久删除，操作完成后无法恢复。'}
        subject={pendingAction?.session
          ? `${pendingAction.session.browserName} v${pendingAction.session.browserVersion} · ${pendingAction.session.id}`
          : pendingAction?.type === 'batch-delete'
            ? `已选择 ${pendingAction.selectedIds?.length || 0} 条测试舱记录`
            : undefined}
        confirmLabel={pendingAction?.type === 'terminate'
          ? '确认结束测试舱'
          : pendingAction?.type === 'batch-delete'
            ? `确认删除 ${pendingAction.selectedIds?.length || 0} 条记录`
            : '确认永久删除'}
        loading={confirmLoading}
        error={confirmError}
        onConfirm={handleConfirmAction}
        onCancel={() => {
          if (confirmLoading) return;
          setPendingAction(null);
          setConfirmError('');
        }}
      />
    </div>
  );
};
