import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ShieldCheck, Cpu, HardDrive, Trash2, Activity, FileText } from 'lucide-react';

export const AdminDashboardPage: React.FC = () => {
  const [status, setStatus] = useState<any>(null);
  const [audits, setAudits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleaning, setCleaning] = useState(false);

  const loadAdminData = async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([api.getAdminStatus(), api.getAuditEvents()]);
      setStatus(s);
      setAudits(a);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdminData();
  }, []);

  const handleManualCleanup = async () => {
    setCleaning(true);
    try {
      const res = await api.triggerCleanup();
      alert(`清理完成！已释放 ${res.expiredCount} 个到期会话，清除 ${res.cleanedArtifacts} 个废弃产物。`);
      loadAdminData();
    } catch (err: any) {
      alert(err.message || '清理失败');
    } finally {
      setCleaning(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted, #94a3b8)' }}>正在读取管理数据...</div>;
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '24px', margin: 0, color: 'var(--text-main, #f8fafc)' }}>管理控制台 (Admin Dashboard)</h1>
          <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '14px', marginTop: '4px' }}>系统资源容量、到期/空闲会话回收、产物清理与安全审计</p>
        </div>
        <button
          onClick={handleManualCleanup}
          disabled={cleaning}
          className="btn-danger"
          style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <Trash2 size={16} /> {cleaning ? '清理中...' : '手动执行会话与产物清理'}
        </button>
      </div>

      {/* Capacity stat cards */}
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
            <HardDrive size={16} /> 产物保留策略
          </div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#059669', marginTop: '8px' }}>
            {status?.artifactRetentionDays || 7} 天 / {status?.artifactMaxTotalGb || 50} GB
          </div>
        </div>
      </div>

      {/* Audit Logs */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', backgroundColor: 'var(--table-header-bg, #0f172a)', borderBottom: '1px solid var(--border-color, #334155)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main, #f8fafc)' }}>
          <FileText size={18} /> 最近 100 条安全审计日志 (Audit Log)
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted, #94a3b8)', borderBottom: '1px solid var(--border-color, #334155)' }}>
              <th style={{ padding: '10px 16px' }}>时间</th>
              <th style={{ padding: '10px 16px' }}>事件类型</th>
              <th style={{ padding: '10px 16px' }}>操作用户</th>
              <th style={{ padding: '10px 16px' }}>目标测试舱</th>
              <th style={{ padding: '10px 16px' }}>IP</th>
            </tr>
          </thead>
          <tbody>
            {audits.map((a) => (
              <tr key={a.id} style={{ borderBottom: '1px solid var(--border-subtle, #1e293b)' }}>
                <td style={{ padding: '10px 16px', color: 'var(--text-subtle, #64748b)' }}>{new Date(a.created_at).toLocaleString()}</td>
                <td style={{ padding: '10px 16px', fontWeight: 'bold', color: 'var(--text-main, #f8fafc)' }}>{a.event_type}</td>
                <td style={{ padding: '10px 16px', color: 'var(--text-muted, #cbd5e1)' }}>{a.username || a.user_id || '系统/未登录'}</td>
                <td style={{ padding: '10px 16px', color: 'var(--primary-color, #38bdf8)' }}>{a.session_id || '-'}</td>
                <td style={{ padding: '10px 16px', color: 'var(--text-subtle, #64748b)' }}>{a.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
