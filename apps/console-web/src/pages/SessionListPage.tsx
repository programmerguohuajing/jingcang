import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { SessionResponse } from '@jingcang/contracts';
import { ExternalLink, Square, RefreshCw, Clock, Trash2 } from 'lucide-react';

export const getStatusBadge = (status: string) => {
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
  const navigate = useNavigate();

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = await api.getSessions();
      setSessions(res.items);
      setTotal(res.total);
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

  const handleTerminate = async (id: string) => {
    if (window.confirm('确认结束此测试舱？')) {
      try {
        await api.terminateSession(id);
        loadSessions();
      } catch (err: any) {
        alert(err.message || '结束失败');
      }
    }
  };

  const handleDeleteRecord = async (id: string) => {
    if (window.confirm('确认彻底删除该历史测试舱记录？')) {
      try {
        await api.deleteSession(id);
        await loadSessions();
      } catch (err: any) {
        alert(err.message || '删除记录失败');
      }
    }
  };

  return (
    <div style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', margin: 0, color: '#f8fafc' }}>测试舱运行记录 (Session List)</h1>
          <p style={{ color: '#94a3b8', fontSize: '14px', marginTop: '4px' }}>
            共 {total} 条记录 · 正在运行与排队中的测试舱
          </p>
        </div>
        <button onClick={loadSessions} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      {error && (
        <div style={{ backgroundColor: 'rgba(220, 38, 38, 0.2)', border: '1px solid #dc2626', color: '#f87171', padding: '12px', borderRadius: '8px', marginBottom: '20px' }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#94a3b8' }}>正在读取列表...</div>
      ) : sessions.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
          暂无任何测试舱记录。点击“浏览器舱位”开启第一个兼容性测试舱！
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #334155', color: '#cbd5e1' }}>
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
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #1e293b' }}>
                    <td style={{ padding: '14px 16px', fontWeight: 'bold' }}>
                      <span style={{ color: '#f8fafc' }}>{s.id}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      <span style={{ color: '#38bdf8' }}>{s.browserName} v{s.browserVersion}</span>
                    </td>
                    <td style={{ padding: '14px 16px' }}>
                      {getStatusBadge(s.status)}
                    </td>
                    <td style={{ padding: '14px 16px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <code style={{ color: '#a7f3d0' }}>{s.startUrl}</code>
                    </td>
                    <td style={{ padding: '14px 16px', color: '#cbd5e1' }}>
                      {s.username}
                    </td>
                    <td style={{ padding: '14px 16px', color: '#94a3b8', fontSize: '12px' }}>
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
                              onClick={() => handleTerminate(s.id)}
                              className="btn-danger"
                              style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 8px', fontSize: '12px' }}
                            >
                              <Square size={14} /> 结束
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleDeleteRecord(s.id)}
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
    </div>
  );
};
