import React, { useState, useMemo, useEffect } from 'react';
import { BrowserItem, CreateSessionRequest } from '@jingcang/contracts';
import { Play, AlertCircle, Sparkles, Sliders, Monitor } from 'lucide-react';

interface SessionCreateModalProps {
  browser: BrowserItem;
  onClose: () => void;
  onSubmit: (data: CreateSessionRequest) => Promise<void>;
}

export const SessionCreateModal: React.FC<SessionCreateModalProps> = ({
  browser,
  onClose,
  onSubmit
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const [startUrl, setStartUrl] = useState('http://host.docker.internal:3000');

  // Detect current hardware running environment screen resolution
  const hardwareScreen = useMemo(() => {
    if (typeof window === 'undefined' || !window.screen) {
      return { width: 1920, height: 1080, dpr: 1 };
    }
    return {
      width: window.screen.width || 1920,
      height: window.screen.height || 1080,
      dpr: window.devicePixelRatio || 1
    };
  }, []);

  const hwKey = `${hardwareScreen.width}x${hardwareScreen.height}`;
  const hwPhysicalWidth = Math.round(hardwareScreen.width * hardwareScreen.dpr);
  const hwPhysicalHeight = Math.round(hardwareScreen.height * hardwareScreen.dpr);
  const hwPhysicalKey = `${hwPhysicalWidth}x${hwPhysicalHeight}`;
  const hasDistinctPhysical = hardwareScreen.dpr > 1 && hwPhysicalKey !== hwKey;

  // Predefined standard presets
  const standardPresets = useMemo(() => [
    { value: '1920x1080', label: '1920 × 1080 (FHD 推荐)' },
    { value: '2560x1440', label: '2560 × 1440 (2K QHD)' },
    { value: '3840x2160', label: '3840 × 2160 (4K UHD)' },
    { value: '1440x900', label: '1440 × 900 (MacBook 常见)' },
    { value: '1366x768', label: '1366 × 768 (笔记本常见)' },
    { value: '1280x720', label: '1280 × 720 (HD 720P)' },
    { value: '390x844', label: '390 × 844 (iPhone 移动端)' },
    { value: '768x1024', label: '768 × 1024 (iPad 平板)' }
  ], []);

  // Default to hardware screen resolution if available, otherwise 1920x1080
  const initialResolutionKey = hwKey || '1920x1080';
  const [selectedResolutionKey, setSelectedResolutionKey] = useState(initialResolutionKey);
  const [width, setWidth] = useState(hardwareScreen.width || 1920);
  const [height, setHeight] = useState(hardwareScreen.height || 1080);
  const [customWidth, setCustomWidth] = useState(hardwareScreen.width || 1920);
  const [customHeight, setCustomHeight] = useState(hardwareScreen.height || 1080);

  const [durationMinutes, setDurationMinutes] = useState(60);
  const [acceptInsecureCerts, setAcceptInsecureCerts] = useState(false);
  const [recordVideo, setRecordVideo] = useState(false);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isLocalhostInput = startUrl.includes('localhost') || startUrl.includes('127.0.0.1');

  const handleConvertLocalhost = () => {
    setStartUrl((prev) =>
      prev.replace('localhost', 'host.docker.internal').replace('127.0.0.1', 'host.docker.internal')
    );
  };

  const handleResolutionSelect = (val: string) => {
    setSelectedResolutionKey(val);
    if (val === 'custom') {
      setWidth(customWidth);
      setHeight(customHeight);
    } else {
      const [w, h] = val.split('x').map(Number);
      if (w && h) {
        setWidth(w);
        setHeight(h);
        setCustomWidth(w);
        setCustomHeight(h);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (width < 320 || width > 5120 || height < 240 || height > 3840) {
      setError('画面分辨率宽度须在 320 ~ 5120 像素之间，高度须在 240 ~ 3840 像素之间');
      return;
    }

    setLoading(true);

    try {
      await onSubmit({
        browserId: browser.id,
        startUrl,
        screen: { width, height, depth: 24, dpi: 96 },
        locale: 'zh-CN',
        timezone: 'Asia/Shanghai',
        durationMinutes,
        acceptInsecureCerts,
        recordVideo,
        name: name || `测试舱-${browser.displayName}-${browser.version}`
      });
    } catch (err: any) {
      setError(err.message || '启动测试舱失败');
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="modal-content"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '18px', color: 'var(--text-main)' }}>
            🚀 启动测试舱 — {browser.displayName} ({browser.version})
          </h2>
          <button onClick={onClose} className="btn-secondary" style={{ padding: '4px 10px' }}>✕</button>
        </div>

        {error && (
          <div style={{
            backgroundColor: 'rgba(220, 38, 38, 0.2)',
            border: '1px solid #dc2626',
            color: '#f87171',
            padding: '10px',
            borderRadius: '6px',
            fontSize: '13px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              启动网址 (Start URL)
            </label>
            <input
              type="text"
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              placeholder="http://host.docker.internal:3000 或 https://..."
            />
            {isLocalhostInput && (
              <div style={{
                marginTop: '6px',
                fontSize: '12px',
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                padding: '6px 10px',
                borderRadius: '4px'
              }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <AlertCircle size={14} /> 检测到 localhost/127.0.0.1，宿主机服务需通过 host.docker.internal 访问
                </span>
                <button
                  type="button"
                  onClick={handleConvertLocalhost}
                  style={{
                    fontSize: '11px',
                    padding: '2px 6px',
                    backgroundColor: '#d97706',
                    color: '#fff',
                    borderRadius: '4px'
                  }}
                >
                  一键转换
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <label style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                  画面分辨率
                </label>
                <span style={{ fontSize: '11px', color: '#38bdf8' }}>
                  {width} × {height}
                </span>
              </div>
              <select
                value={selectedResolutionKey}
                onChange={(e) => handleResolutionSelect(e.target.value)}
              >
                <optgroup label="💻 当前运行环境硬件分辨率">
                  <option value={hwKey}>
                    当前屏幕 ({hardwareScreen.width} × {hardwareScreen.height} · 匹配本机)
                  </option>
                  {hasDistinctPhysical && (
                    <option value={hwPhysicalKey}>
                      硬件原生点对点 ({hwPhysicalWidth} × {hwPhysicalHeight} · @{hardwareScreen.dpr}x)
                    </option>
                  )}
                </optgroup>

                <optgroup label="🖥️ 桌面常用预设">
                  {standardPresets
                    .filter((p) => p.value !== hwKey && p.value !== hwPhysicalKey)
                    .map((preset) => (
                      <option key={preset.value} value={preset.value}>
                        {preset.label}
                      </option>
                    ))}
                </optgroup>

                <optgroup label="⚙️ 高级自定义">
                  <option value="custom">自定义分辨率 (手动指定宽高)...</option>
                </optgroup>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                会话时长 (分钟)
              </label>
              <select
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
              >
                <option value={15}>15 分钟 (快速验证)</option>
                <option value={30}>30 分钟</option>
                <option value={60}>60 分钟 (默认)</option>
                <option value={120}>120 分钟 (最长)</option>
              </select>
            </div>
          </div>

          {selectedResolutionKey === 'custom' && (
            <div style={{
              padding: '12px 14px',
              backgroundColor: 'var(--bg-subtle)',
              borderRadius: '8px',
              border: '1px solid var(--primary-color)',
              boxShadow: 'var(--card-shadow)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: '13px', color: 'var(--text-main)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Sliders size={15} style={{ color: '#38bdf8' }} /> 自定义分辨率规格
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  支持范围: 320~5120 × 240~3840
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto', gap: '10px', alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                    宽度 (Width px)
                  </label>
                  <input
                    type="number"
                    min={320}
                    max={5120}
                    value={customWidth}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setCustomWidth(val);
                      setWidth(val);
                    }}
                    placeholder="例如 1920"
                    style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }}
                  />
                </div>

                <div style={{ color: 'var(--text-muted)', fontWeight: 'bold', paddingTop: '16px', fontSize: '16px' }}>
                  ×
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '2px' }}>
                    高度 (Height px)
                  </label>
                  <input
                    type="number"
                    min={240}
                    max={3840}
                    value={customHeight}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10) || 0;
                      setCustomHeight(val);
                      setHeight(val);
                    }}
                    placeholder="例如 1080"
                    style={{ width: '100%', padding: '6px 10px', fontSize: '13px' }}
                  />
                </div>

                <div style={{ paddingTop: '16px' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      setCustomWidth(hardwareScreen.width);
                      setCustomHeight(hardwareScreen.height);
                      setWidth(hardwareScreen.width);
                      setHeight(hardwareScreen.height);
                    }}
                    title="一键填入当前环境硬件分辨率"
                    style={{ fontSize: '12px', padding: '6px 10px', whiteSpace: 'nowrap' }}
                  >
                    填入本机
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>快速比例:</span>
                {[
                  { label: '16:9 高清', w: 1920, h: 1080 },
                  { label: '16:10 办公', w: 1920, h: 1200 },
                  { label: '4:3 经典', w: 1024, h: 768 },
                  { label: '21:9 超宽', w: 2560, h: 1080 },
                  { label: '32:9 带鱼屏', w: 3840, h: 1080 },
                  { label: '9:16 移动竖屏', w: 390, h: 844 }
                ].map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setCustomWidth(p.w);
                      setCustomHeight(p.h);
                      setWidth(p.w);
                      setHeight(p.h);
                    }}
                    style={{
                      fontSize: '11px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      backgroundColor: customWidth === p.w && customHeight === p.h ? 'var(--primary-color)' : 'var(--bg-app)',
                      color: customWidth === p.w && customHeight === p.h ? '#ffffff' : 'var(--text-muted)',
                      border: '1px solid var(--border-color)',
                      cursor: 'pointer'
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
              测试舱备注名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：首页跨浏览器兼容性复查"
            />
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '4px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={acceptInsecureCerts}
                onChange={(e) => setAcceptInsecureCerts(e.target.checked)}
                style={{ width: 'auto' }}
              />
              忽略 HTTPS 自签名证书错误
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={recordVideo}
                onChange={(e) => setRecordVideo(e.target.checked)}
                style={{ width: 'auto' }}
              />
              录制会话视频 (实验性)
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '16px' }}>
            <button type="button" onClick={onClose} className="btn-secondary">取消</button>
            <button type="submit" className="btn-primary" disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Play size={16} />
              {loading ? '正在准备测试舱...' : '立即启动'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
