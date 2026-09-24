import React, { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  BrowserInstallJob,
  BrowserInstallRequest,
  BrowserVendor
} from '@jingcang/contracts';
import { api } from '../api/client';
import {
  Box,
  Check,
  CheckCircle2,
  CloudDownload,
  LoaderCircle,
  Rocket,
  ServerCog,
  X,
  XCircle
} from 'lucide-react';

interface BrowserInstallModalProps {
  onClose: () => void;
  onInstalled: () => void;
}

const VENDORS: Array<{
  value: BrowserVendor;
  name: string;
  mark: string;
  repository: string;
  color: string;
}> = [
  { value: 'chrome', name: 'Chrome', mark: 'CH', repository: 'selenium/standalone-chrome', color: '#4ade80' },
  { value: 'edge', name: 'Edge', mark: 'ED', repository: 'selenium/standalone-edge', color: '#38bdf8' },
  { value: 'firefox', name: 'Firefox', mark: 'FF', repository: 'selenium/standalone-firefox', color: '#fb923c' },
  { value: 'chromium', name: 'Chromium', mark: 'CR', repository: 'selenium/standalone-chromium', color: '#c084fc' }
];

const STEPS = [
  { status: 'PENDING', label: '任务校验', icon: Box },
  { status: 'PULLING', label: '下载镜像', icon: CloudDownload },
  { status: 'STARTING', label: '启动节点', icon: ServerCog },
  { status: 'READY', label: '接入矩阵', icon: Rocket }
] as const;

export const BrowserInstallModal: React.FC<BrowserInstallModalProps> = ({ onClose, onInstalled }) => {
  const [browserName, setBrowserName] = useState<BrowserVendor>('chrome');
  const [version, setVersion] = useState('');
  const [useOffline, setUseOffline] = useState(true);
  const [allowRemote, setAllowRemote] = useState(true);
  const [job, setJob] = useState<BrowserInstallJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [pollAttempt, setPollAttempt] = useState(0);
  const notifiedReadyRef = useRef(false);

  const vendor = VENDORS.find((item) => item.value === browserName)!;
  const image = useMemo(
    () => version.trim() ? `${vendor.repository}:<自动匹配 ${version.trim()}>` : `${vendor.repository}:<版本号>`,
    [vendor.repository, version]
  );
  const active = Boolean(job && !['READY', 'FAILED'].includes(job.status));

  useEffect(() => {
    if (!job || ['READY', 'FAILED'].includes(job.status)) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api.getBrowserInstall(job.id);
        if (!cancelled) {
          setError('');
          setJob(next);
        }
      } catch (pollError: any) {
        if (!cancelled) {
          setError(pollError.message || '获取安装进度失败，正在自动重试');
          setPollAttempt((attempt) => attempt + 1);
        }
      }
    }, 1500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [job, pollAttempt]);

  useEffect(() => {
    if (job?.status === 'READY' && !notifiedReadyRef.current) {
      notifiedReadyRef.current = true;
      onInstalled();
    }
  }, [job?.status, onInstalled]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setPollAttempt(0);

    const request: BrowserInstallRequest = {
      browserName,
      version: version.trim(),
      useOffline,
      allowRemote
    };
    if (!request.version) {
      setError('请输入要接入的浏览器版本');
      return;
    }

    setSubmitting(true);
    notifiedReadyRef.current = false;
    try {
      setJob(await api.installBrowser(request));
    } catch (submitError: any) {
      setError(submitError.message || '创建浏览器安装任务失败');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForRetry = () => {
    setJob(null);
    setError('');
    setPollAttempt(0);
    notifiedReadyRef.current = false;
  };

  useEffect(() => {
    const originalBodyOverflow = document.body.style.overflow;
    const originalHtmlOverflow = document.documentElement.style.overflow;
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !active && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.classList.remove('modal-open');
      document.body.style.overflow = originalBodyOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [active, submitting, onClose]);

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && !active && !submitting) {
      onClose();
    }
  };

  const currentStepIndex = job
    ? Math.max(0, STEPS.findIndex((step) => step.status === job.status))
    : -1;

  return (
    <div
      className="modal-overlay browser-install-overlay"
      role="presentation"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        className="browser-install-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-install-title"
      >
        <div className="browser-install-topline" />
        <header className="browser-install-header">
          <div className="browser-install-title-row">
            <div className="browser-install-kicker">
              <span className="browser-install-kicker-dot" /> INFRASTRUCTURE / NEW NODE
            </div>
            <button
              className="browser-install-close"
              type="button"
              aria-label="关闭"
              disabled={active || submitting}
              title={active ? '浏览器接入完成后即可关闭' : '关闭'}
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </div>
          <h2 id="browser-install-title">增加浏览器版本</h2>
          <p>选择厂商并输入镜像支持的版本标签，系统将自动下载、启动并注册为独立测试舱。</p>
        </header>

        {!job ? (
          <form onSubmit={handleSubmit} className="browser-install-form">
            <fieldset>
              <legend>01 / 选择浏览器厂商</legend>
              <div className="browser-vendor-grid">
                {VENDORS.map((item) => {
                  const selected = item.value === browserName;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`browser-vendor-option${selected ? ' is-selected' : ''}`}
                      style={{ '--vendor-color': item.color } as React.CSSProperties}
                      onClick={() => setBrowserName(item.value)}
                    >
                      <span className="browser-vendor-mark">{item.mark}</span>
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.repository.replace('selenium/', '')}</small>
                      </span>
                      <span className="browser-vendor-check">{selected && <Check size={12} />}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <fieldset>
              <legend>02 / 指定版本</legend>
              <label className="browser-version-label" htmlFor="browser-version">
                浏览器版本
              </label>
              <div className="browser-version-input-wrap">
                <span>v</span>
                <input
                  id="browser-version"
                  value={version}
                  onChange={(event) => setVersion(event.target.value)}
                  placeholder="例如 140、140.0、140.0.7339.207 或 latest"
                  maxLength={64}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <p className="browser-version-hint">
                输入浏览器版本即可，后端会自动匹配 Selenium 官方仓库中最新的稳定镜像标签；也支持完整镜像标签与 latest / beta / dev / nightly。
              </p>
            </fieldset>

            <fieldset>
              <legend>03 / 镜像来源与获取方式</legend>
              <div className="browser-source-options">
                <label className={`browser-source-checkbox ${useOffline ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={useOffline}
                    disabled={submitting}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (!next && !allowRemote) return;
                      setUseOffline(next);
                    }}
                  />
                  <div>
                    <strong>获取离线镜像（优先检索本地或离线安装包）</strong>
                    <small>优先匹配已导入的本地镜像或固定归档文件夹（如 /app/browser-images），命中后免下载快速接入。</small>
                  </div>
                </label>
                <label className={`browser-source-checkbox ${allowRemote ? 'checked' : ''}`}>
                  <input
                    type="checkbox"
                    checked={allowRemote}
                    disabled={submitting}
                    onChange={(e) => {
                      const next = e.target.checked;
                      if (!next && !useOffline) return;
                      setAllowRemote(next);
                    }}
                  />
                  <div>
                    <strong>根据版本号检索远程仓库（离线未命中时自动联网检索）</strong>
                    <small>当离线包中未包含输入版本时，自动向官方/私有镜像仓库按版本号检索最新稳定镜像标签并下载。</small>
                  </div>
                </label>
              </div>
            </fieldset>

            <div className="browser-image-preview">
              <div>
                <span>{useOffline && allowRemote ? '解析策略：优先本地/离线 ➔ 自动回退远程仓库检索' : useOffline ? '解析策略：纯离线镜像导入（仅本地/固定归档目录）' : '解析策略：在线模式（直接通过远程仓库检索版本）'}</span>
                <code>{image}</code>
              </div>
              <span className="browser-image-platform">LINUX / AMD64</span>
            </div>

            {error && <div className="browser-install-error"><XCircle size={16} /> {error}</div>}

            <div className="browser-install-note">
              首次下载通常需要数分钟并占用磁盘空间。节点健康检查通过后才会出现在舱位矩阵中。
            </div>

            <footer className="browser-install-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>取消</button>
              <button type="submit" className="btn-primary browser-install-submit" disabled={submitting || !version.trim()}>
                {submitting ? <LoaderCircle size={16} className="spin-icon" /> : <CloudDownload size={16} />}
                {submitting ? '正在创建任务' : '下载并接入系统'}
              </button>
            </footer>
          </form>
        ) : (
          <div className="browser-install-progress">
            <div className="browser-install-target">
              <div className="browser-install-target-mark" style={{ borderColor: vendor.color, color: vendor.color }}>
                {vendor.mark}
              </div>
              <div>
                <span>{vendor.name} · VERSION {job.version}</span>
                <code>{job.image}</code>
              </div>
              <span className={`browser-install-state state-${job.status.toLowerCase()}`}>
                {job.status === 'READY' ? '已接入' : job.status === 'FAILED' ? '失败' : '执行中'}
              </span>
            </div>

            <div className="browser-install-stepper">
              {STEPS.map((step, index) => {
                const StepIcon = step.icon;
                const complete = job.status === 'READY' || index < currentStepIndex;
                const current = job.status !== 'FAILED' && index === currentStepIndex;
                const failed = job.status === 'FAILED' && index === currentStepIndex;
                return (
                  <React.Fragment key={step.status}>
                    <div className={`browser-install-step${complete ? ' is-complete' : ''}${current ? ' is-current' : ''}${failed ? ' is-failed' : ''}`}>
                      <span className="browser-install-step-icon">
                        {complete ? <Check size={15} /> : failed ? <X size={15} /> : <StepIcon size={15} />}
                      </span>
                      <span>{step.label}</span>
                    </div>
                    {index < STEPS.length - 1 && <span className={`browser-install-step-line${complete ? ' is-complete' : ''}`} />}
                  </React.Fragment>
                );
              })}
            </div>

            <div className={`browser-install-status-panel${job.status === 'FAILED' ? ' is-failed' : ''}${job.status === 'READY' ? ' is-ready' : ''}`}>
              {job.status === 'FAILED'
                ? <XCircle size={22} />
                : job.status === 'READY'
                  ? <CheckCircle2 size={22} />
                  : <LoaderCircle size={22} className="spin-icon" />}
              <div>
                <strong>{job.statusMessage}</strong>
                <span>{job.errorMessage || (job.status === 'READY' ? '新版本现在可以创建测试舱。' : '请保持此窗口打开，系统会自动刷新任务状态。')}</span>
              </div>
            </div>

            {error && <div className="browser-install-error"><XCircle size={16} /> {error}</div>}

            <footer className="browser-install-actions">
              {job.status === 'FAILED' && (
                <button type="button" className="btn-secondary" onClick={resetForRetry}>修改后重试</button>
              )}
              <button
                type="button"
                className={job.status === 'READY' ? 'btn-primary' : 'btn-secondary'}
                disabled={active}
                onClick={onClose}
              >
                {job.status === 'READY' ? '返回舱位矩阵' : job.status === 'FAILED' ? '关闭' : '接入进行中'}
              </button>
            </footer>
          </div>
        )}
      </div>
    </div>
  );
};
