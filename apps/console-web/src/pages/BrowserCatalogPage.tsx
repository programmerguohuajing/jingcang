import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { BrowserItem, CreateSessionRequest } from '@jingcang/contracts';
import { SessionCreateModal } from './SessionCreateModal';
import { BrowserInstallModal } from './BrowserInstallModal';
import { BrowserAccessApprovalModal } from './BrowserAccessApprovalModal';
import { Play, CheckCircle2, RefreshCw, Layers, Server, Plus, Box, Power, PowerOff, KeyRound } from 'lucide-react';
import { ConfirmDialog } from '../components/ConfirmDialog';

interface BrowserCatalogPageProps {
  isAdmin: boolean;
}

interface VendorMeta {
  key: string;
  name: string;
  enName: string;
  icon: string;
  badge: string;
  badgeBg: string;
  badgeColor: string;
  description: string;
}

const VENDOR_CONFIGS: Record<string, VendorMeta> = {
  chrome: {
    key: 'chrome',
    name: 'Google Chrome',
    enName: 'Blink · V8 Engine',
    icon: '🌐',
    badge: 'Google',
    badgeBg: 'rgba(59, 130, 246, 0.15)',
    badgeColor: '#60a5fa',
    description: '全球使用率最高的现代化浏览器，Blink 排版内核与 V8 高性能引擎'
  },
  edge: {
    key: 'edge',
    name: 'Microsoft Edge',
    enName: 'Chromium · Edge Core',
    icon: '🌊',
    badge: 'Microsoft',
    badgeBg: 'rgba(14, 165, 233, 0.15)',
    badgeColor: '#38bdf8',
    description: '微软基于 Chromium 内核深度定制的现代化桌面浏览器，深度集成 Windows 办公生态'
  },
  firefox: {
    key: 'firefox',
    name: 'Mozilla Firefox',
    enName: 'Gecko · Quantum Engine',
    icon: '🦊',
    badge: 'Mozilla',
    badgeBg: 'rgba(249, 115, 22, 0.15)',
    badgeColor: '#fb923c',
    description: '自主研发的独立 Gecko / Quantum 排版引擎，支持全方位跨内核兼容性复查与隐私标准'
  },
  chromium: {
    key: 'chromium',
    name: 'Chromium',
    enName: 'Open Source Baseline',
    icon: '⚛️',
    badge: '开源社区',
    badgeBg: 'rgba(168, 85, 247, 0.15)',
    badgeColor: '#c084fc',
    description: '标准 Web 规范开源基准实现，无商业插件干扰的纯粹渲染环境'
  }
};

const VENDOR_ORDER = ['chrome', 'edge', 'firefox', 'chromium'];

export const BrowserCatalogPage: React.FC<BrowserCatalogPageProps> = ({ isAdmin }) => {
  const [browsers, setBrowsers] = useState<BrowserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [updatingBrowserId, setUpdatingBrowserId] = useState<string | null>(null);
  const [selectedBrowser, setSelectedBrowser] = useState<BrowserItem | null>(null);
  const [approvalTargetBrowser, setApprovalTargetBrowser] = useState<BrowserItem | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [pendingBrowserToggle, setPendingBrowserToggle] = useState<BrowserItem | null>(null);
  const [toggleError, setToggleError] = useState('');
  const [activeVendorTab, setActiveVendorTab] = useState<string>('all');
  const navigate = useNavigate();

  const loadBrowsers = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getBrowsers(isAdmin);
      setBrowsers(data);
    } catch (err: any) {
      setError(err.message || '加载浏览器舱位失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBrowsers();
  }, [isAdmin]);

  const handleToggleBrowser = async (browser: BrowserItem) => {
    const nextEnabled = !browser.enabled;
    setUpdatingBrowserId(browser.id);
    setError('');
    setNotice('');

    try {
      const updated = await api.updateBrowserCatalog(browser.id, { enabled: nextEnabled });
      setBrowsers((current) => current.map((item) => item.id === updated.id ? updated : item));
      setNotice(`${updated.displayName} 已${updated.enabled ? '启用' : '禁用'}`);
      setPendingBrowserToggle(null);
      if (!updated.enabled && selectedBrowser?.id === updated.id) {
        setSelectedBrowser(null);
      }
    } catch (err: any) {
      setToggleError(err.message || `${nextEnabled ? '启用' : '禁用'}浏览器舱位失败`);
    } finally {
      setUpdatingBrowserId(null);
    }
  };

  const handleStartSession = async (request: CreateSessionRequest) => {
    const session = await api.createSession(request);
    setSelectedBrowser(null);
    if (session.status === 'READY' || session.status === 'STARTING') {
      navigate(`/viewer/${session.id}`);
    } else {
      navigate('/sessions');
    }
  };

  // Group browsers by vendor
  const groupedVendors = useMemo(() => {
    const groups = new Map<string, { meta: VendorMeta; items: BrowserItem[] }>();

    // Initialize ordered vendors
    for (const vKey of VENDOR_ORDER) {
      groups.set(vKey, { meta: VENDOR_CONFIGS[vKey], items: [] });
    }

    // Populate browsers
    for (const b of browsers) {
      const vKey = (b.browserName || '').toLowerCase();
      if (!groups.has(vKey)) {
        groups.set(vKey, {
          meta: {
            key: vKey,
            name: b.browserName.toUpperCase(),
            enName: 'Custom Engine',
            icon: '💻',
            badge: '定制',
            badgeBg: 'rgba(148, 163, 184, 0.15)',
            badgeColor: '#94a3b8',
            description: '其他厂商或独立定制的浏览器测试环境'
          },
          items: []
        });
      }
      groups.get(vKey)!.items.push(b);
    }

    // Filter out vendors with 0 browsers unless expected
    return Array.from(groups.values()).filter((g) => g.items.length > 0);
  }, [browsers]);

  const visibleVendors = useMemo(() => {
    if (activeVendorTab === 'all') return groupedVendors;
    return groupedVendors.filter((g) => g.meta.key === activeVendorTab);
  }, [groupedVendors, activeVendorTab]);

  return (
    <div style={{ padding: '32px 24px', maxWidth: '1240px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h1 style={{ fontSize: '24px', margin: 0, color: 'var(--text-main, #f8fafc)' }}>浏览器舱位矩阵</h1>
            <span style={{
              fontSize: '12px',
              backgroundColor: 'var(--bg-subtle, #1e293b)',
              color: 'var(--primary-color, #38bdf8)',
              border: '1px solid var(--border-color, #334155)',
              padding: '2px 10px',
              borderRadius: '999px',
              fontWeight: 500
            }}>
              {groupedVendors.length} 个内核厂商 · {browsers.length} 个版本规格
            </span>
          </div>
          <p style={{ color: 'var(--text-muted, #94a3b8)', fontSize: '14px', marginTop: '6px' }}>
            已按浏览器厂商与内核引擎独立分组。选择目标版本可一键启动完全隔离的沙盒测试舱。
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={loadBrowsers} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <RefreshCw size={16} /> 刷新舱位
          </button>
          <button
            onClick={() => setShowInstallModal(true)}
            className="btn-primary add-browser-version-button"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={16} /> 增加浏览器版本
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'rgba(220, 38, 38, 0.1)',
          border: '1px solid #dc2626',
          color: '#ef4444',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          {error}
        </div>
      )}

      {notice && (
        <div style={{
          backgroundColor: 'rgba(5, 150, 105, 0.12)',
          border: '1px solid #059669',
          color: '#10b981',
          padding: '12px 16px',
          borderRadius: '8px',
          marginBottom: '20px'
        }}>
          {notice}
        </div>
      )}

      {/* Vendor Filter Tabs */}
      {!loading && groupedVendors.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
          overflowX: 'auto',
          paddingBottom: '8px',
          marginBottom: '28px',
          borderBottom: '1px solid var(--border-color, #1e293b)'
        }}>
          <button
            onClick={() => setActiveVendorTab('all')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '8px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              border: activeVendorTab === 'all' ? '1px solid var(--primary-color, #0284c7)' : '1px solid transparent',
              backgroundColor: activeVendorTab === 'all' ? 'var(--bg-surface, #1e293b)' : 'transparent',
              color: activeVendorTab === 'all' ? 'var(--primary-color, #38bdf8)' : 'var(--text-muted, #94a3b8)',
              transition: 'all 0.15s ease'
            }}
          >
            <Layers size={15} />
            <span>全部厂商</span>
            <span style={{
              fontSize: '11px',
              padding: '1px 6px',
              borderRadius: '999px',
              backgroundColor: activeVendorTab === 'all' ? 'var(--primary-light-bg, rgba(56, 189, 248, 0.2))' : 'var(--bg-subtle, #1e293b)',
              color: activeVendorTab === 'all' ? 'var(--primary-color, #38bdf8)' : 'var(--text-subtle, #64748b)'
            }}>
              {browsers.length}
            </span>
          </button>

          {groupedVendors.map((group) => {
            const isActive = activeVendorTab === group.meta.key;
            return (
              <button
                key={group.meta.key}
                onClick={() => setActiveVendorTab(group.meta.key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: isActive ? `1px solid ${group.meta.badgeColor}` : '1px solid transparent',
                  backgroundColor: isActive ? 'var(--bg-surface, #1e293b)' : 'transparent',
                  color: isActive ? 'var(--text-main, #f8fafc)' : 'var(--text-muted, #94a3b8)',
                  transition: 'all 0.15s ease'
                }}
              >
                <span>{group.meta.icon}</span>
                <span>{group.meta.name}</span>
                <span style={{
                  fontSize: '11px',
                  padding: '1px 6px',
                  borderRadius: '999px',
                  backgroundColor: isActive ? group.meta.badgeBg : 'var(--bg-subtle, #1e293b)',
                  color: isActive ? group.meta.badgeColor : 'var(--text-subtle, #64748b)'
                }}>
                  {group.items.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted, #94a3b8)' }}>
          正在加载多厂商浏览器舱位列表...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '36px' }}>
          {visibleVendors.length === 0 && (
            <div className="browser-catalog-empty">
              <Box size={28} />
              <strong>当前筛选下暂无浏览器舱位</strong>
              <span>可以增加一个官方 Selenium 浏览器版本并自动接入。</span>
              {isAdmin && (
                <button className="btn-primary add-browser-version-button" onClick={() => setShowInstallModal(true)}>
                  <Plus size={16} /> 增加浏览器版本
                </button>
              )}
            </div>
          )}
          {visibleVendors.map((group) => (
            <section
              key={group.meta.key}
              style={{
                backgroundColor: 'var(--bg-surface, rgba(15, 23, 42, 0.4))',
                border: '1px solid var(--border-color, #1e293b)',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: 'var(--card-shadow, 0 4px 20px rgba(0, 0, 0, 0.2))'
              }}
            >
              {/* Group Header */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
                paddingBottom: '16px',
                borderBottom: '1px solid var(--border-subtle, #1e293b)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    fontSize: '24px',
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--bg-subtle, #0f172a)',
                    border: '1px solid var(--border-color, #334155)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {group.meta.icon}
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h2 style={{ fontSize: '18px', margin: 0, color: 'var(--text-main, #f8fafc)', fontWeight: 600 }}>
                        {group.meta.name}
                      </h2>
                      <span style={{
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: group.meta.badgeBg,
                        color: group.meta.badgeColor,
                        fontWeight: 500
                      }}>
                        {group.meta.badge}
                      </span>
                    </div>
                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted, #94a3b8)' }}>
                      {group.meta.description}
                    </p>
                  </div>
                </div>

                <div style={{
                  fontSize: '12px',
                  color: 'var(--text-muted, #94a3b8)',
                  backgroundColor: 'var(--bg-subtle, #0f172a)',
                  border: '1px solid var(--border-color, #334155)',
                  padding: '4px 10px',
                  borderRadius: '6px'
                }}>
                  收录 <strong>{group.items.length}</strong> 个版本舱位
                </div>
              </div>

              {/* Cards Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '18px'
              }}>
                {group.items.map((b) => (
                  <div
                    key={b.id}
                    className="card"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      backgroundColor: 'var(--bg-surface)',
                      border: b.enabled ? (b.isDefault ? '1px solid #059669' : '1px solid var(--border-color)') : '1px solid #dc2626',
                      borderRadius: '10px',
                      padding: '20px',
                      opacity: b.enabled ? 1 : 0.72,
                      transition: 'transform 0.15s ease, border-color 0.15s ease, opacity 0.15s ease'
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '12px' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <h3 style={{ margin: 0, fontSize: '16px', color: 'var(--text-main)', fontWeight: 600, wordBreak: 'break-word' }}>
                            {b.displayName || `${group.meta.name} (${b.version})`}
                          </h3>
                          <div style={{ fontSize: '12px', color: 'var(--text-subtle, #64748b)', marginTop: '2px' }}>
                            标识 ID: <code>{b.id}</code>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}>
                          {b.isPermitted === false && (
                            <span
                              className="badge"
                              style={{
                                backgroundColor: 'rgba(245, 158, 11, 0.15)',
                                color: '#fbbf24',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              需申请授权
                            </span>
                          )}
                          <span className={`badge ${b.enabled ? 'badge-ready' : 'badge-failed'}`} style={{ whiteSpace: 'nowrap' }}>
                            {b.enabled ? '可用' : '未启用'}
                          </span>
                        </div>
                      </div>

                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '12px',
                        backgroundColor: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                        padding: '6px 10px',
                        borderRadius: '6px'
                      }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>运行版本:</span>
                        <strong style={{ fontSize: '13px', color: 'var(--primary-color)' }}>v{b.version}</strong>
                        <span style={{
                          fontSize: '11px',
                          color: '#6366f1',
                          backgroundColor: 'rgba(99, 102, 241, 0.12)',
                          padding: '1px 6px',
                          borderRadius: '4px'
                        }}>
                          {b.channel || 'stable'}
                        </span>
                      </div>

                      <div style={{ fontSize: '12px', color: 'var(--text-subtle)', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>镜像:</span>
                        <code style={{ color: 'var(--code-text)', fontSize: '11px', wordBreak: 'break-all' }}>{b.image}</code>
                      </div>

                      {b.gridUrl && (
                        <div style={{ fontSize: '11px', color: 'var(--text-subtle)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Server size={12} style={{ color: 'var(--primary-color)' }} />
                          <span style={{ color: 'var(--text-muted)' }}>调度节点:</span>
                          <code style={{ color: 'var(--primary-color)' }}>{b.gridUrl}</code>
                        </div>
                      )}

                      <div style={{
                        fontSize: '11px',
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--bg-subtle)',
                        border: '1px solid var(--border-subtle)',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <span>⚡</span>
                        <span>资源配置: 2 CPU · 3GB 内存 · 2GB 共享显存 (SHM)</span>
                      </div>
                    </div>

                    <div style={{
                      marginTop: '18px',
                      paddingTop: '14px',
                      borderTop: '1px solid var(--border-subtle)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '10px',
                      flexWrap: 'wrap'
                    }}>
                      {b.isDefault ? (
                        <span style={{ fontSize: '12px', color: '#059669', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <CheckCircle2 size={14} /> 推荐默认
                        </span>
                      ) : (
                        <span style={{ fontSize: '12px', color: 'var(--text-subtle, #64748b)' }}>
                          标准独立舱
                        </span>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setToggleError('');
                              setPendingBrowserToggle(b);
                            }}
                            disabled={updatingBrowserId === b.id}
                            className={`btn-secondary ${b.enabled ? 'btn-toggle-disable' : 'btn-toggle-enable'}`}
                            aria-label={`${b.enabled ? '禁用' : '启用'} ${b.displayName}`}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '5px',
                              padding: '6px 10px',
                              fontSize: '12px'
                            }}
                          >
                            {b.enabled ? <PowerOff size={14} /> : <Power size={14} />}
                            {updatingBrowserId === b.id ? '处理中...' : (b.enabled ? '禁用' : '启用')}
                          </button>
                        )}
                        {b.isPermitted === false ? (
                          <button
                            onClick={() => setApprovalTargetBrowser(b)}
                            disabled={!b.enabled}
                            className="btn-secondary"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 14px',
                              fontSize: '13px',
                              color: '#fbbf24',
                              borderColor: 'rgba(245, 158, 11, 0.5)'
                            }}
                          >
                            <KeyRound size={14} /> 申请权限
                          </button>
                        ) : (
                          <button
                            onClick={() => setSelectedBrowser(b)}
                            disabled={!b.enabled || updatingBrowserId === b.id}
                            className="btn-primary"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '6px 14px',
                              fontSize: '13px'
                            }}
                          >
                            <Play size={14} /> {b.enabled ? '启动测试舱' : '舱位已禁用'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedBrowser && (
        <SessionCreateModal
          browser={selectedBrowser}
          onClose={() => setSelectedBrowser(null)}
          onSubmit={handleStartSession}
        />
      )}

      {approvalTargetBrowser && (
        <BrowserAccessApprovalModal
          browser={approvalTargetBrowser}
          onClose={() => setApprovalTargetBrowser(null)}
          onSubmitted={() => {
            setApprovalTargetBrowser(null);
            setNotice('审批申请已提交！管理员审核通过后您即可直接启动此测试舱。');
            loadBrowsers();
          }}
        />
      )}

      {showInstallModal && (
        <BrowserInstallModal
          onClose={() => setShowInstallModal(false)}
          onInstalled={loadBrowsers}
        />
      )}

      <ConfirmDialog
        open={Boolean(pendingBrowserToggle)}
        tone={pendingBrowserToggle?.enabled ? 'warning' : 'primary'}
        eyebrow={pendingBrowserToggle?.enabled ? '舱位下线确认' : '舱位上线确认'}
        title={pendingBrowserToggle?.enabled ? '禁用这个浏览器舱位？' : '启用这个浏览器舱位？'}
        description={pendingBrowserToggle?.enabled
          ? '禁用后该版本将不再接受新的测试舱请求；已经启动的会话不会被强制结束。'
          : '启用后该版本会重新出现在可用舱位矩阵中，并可以接受新的测试任务。'}
        subject={pendingBrowserToggle
          ? `${pendingBrowserToggle.displayName} · ${pendingBrowserToggle.image}`
          : undefined}
        confirmLabel={pendingBrowserToggle?.enabled ? '确认禁用' : '确认启用'}
        loading={Boolean(pendingBrowserToggle && updatingBrowserId === pendingBrowserToggle.id)}
        error={toggleError}
        onConfirm={() => {
          if (pendingBrowserToggle) void handleToggleBrowser(pendingBrowserToggle);
        }}
        onCancel={() => {
          if (updatingBrowserId) return;
          setPendingBrowserToggle(null);
          setToggleError('');
        }}
      />
    </div>
  );
};
