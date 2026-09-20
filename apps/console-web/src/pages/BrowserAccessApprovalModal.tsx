import React, { useState } from 'react';
import { api } from '../api/client';
import { BrowserItem } from '@jingcang/contracts';
import { KeyRound, X, Check, AlertCircle } from 'lucide-react';

interface BrowserAccessApprovalModalProps {
  browser: BrowserItem;
  onClose: () => void;
  onSubmitted: () => void;
}

export const BrowserAccessApprovalModal: React.FC<BrowserAccessApprovalModalProps> = ({
  browser,
  onClose,
  onSubmitted
}) => {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('请填写申请使用理由');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      await api.submitApprovalRequest({
        type: 'BROWSER_ACCESS',
        targetId: browser.id,
        title: `申请使用浏览器 [${browser.displayName || browser.browserName} v${browser.version}]`,
        reason: reason.trim()
      });
      onSubmitted();
    } catch (err: any) {
      setError(err.message || '提交审批申请失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
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
        backgroundColor: 'var(--bg-surface, #1e293b)',
        border: '1px solid var(--border-color, #334155)',
        borderRadius: '12px',
        width: '480px',
        maxWidth: '90vw',
        overflow: 'hidden',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)'
      }}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--border-color, #334155)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h2 style={{ fontSize: '18px', margin: 0, color: 'var(--text-main, #f8fafc)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyRound size={20} style={{ color: '#f59e0b' }} />
            申请浏览器使用权限
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted, #94a3b8)', cursor: 'pointer' }}
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: '24px' }}>
          {error && (
            <div style={{
              padding: '10px 14px',
              backgroundColor: 'rgba(220, 38, 38, 0.15)',
              border: '1px solid #dc2626',
              borderRadius: '6px',
              color: '#fca5a5',
              fontSize: '13px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Browser target info box */}
          <div style={{
            backgroundColor: 'var(--bg-subtle, #0f172a)',
            border: '1px solid var(--border-subtle, #334155)',
            borderRadius: '8px',
            padding: '14px',
            marginBottom: '18px',
            fontSize: '13px'
          }}>
            <div style={{ color: 'var(--text-muted, #94a3b8)', marginBottom: '4px' }}>目标规格:</div>
            <div style={{ fontSize: '15px', fontWeight: 'bold', color: 'var(--text-main, #f8fafc)' }}>
              {browser.displayName || `${browser.browserName} (${browser.version})`}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--primary-color, #38bdf8)', marginTop: '4px' }}>
              版本: v{browser.version} · 标识: <code>{browser.id}</code>
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--text-main, #f8fafc)' }}>
              申请事由 / 测试业务需求 <span style={{ color: '#f87171' }}>*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="请详细说明您需要启动此浏览器规格的测试场景、项目名称或兼容性复现要求..."
              rows={4}
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: '6px',
                backgroundColor: 'var(--bg-subtle, #0f172a)',
                border: '1px solid var(--border-color, #334155)',
                color: 'var(--text-main, #f8fafc)',
                fontSize: '13px',
                resize: 'vertical'
              }}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
              disabled={submitting}
            >
              取消
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={submitting}
              style={{
                backgroundColor: '#d97706',
                borderColor: '#d97706',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <Check size={16} /> {submitting ? '提交中...' : '提交审批申请'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
