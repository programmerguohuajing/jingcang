import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import RFB from '@novnc/novnc';
import { api } from '../api/client';
import { SessionResponse } from '@jingcang/contracts';
import { Maximize2, Clock, Square, AlertTriangle, RefreshCw, Monitor, Scaling, Calculator } from 'lucide-react';
import { getStatusBadge } from './SessionListPage';
import { LogoIcon } from '../components/Logo';
import { ConfirmDialog } from '../components/ConfirmDialog';

// Numeric keypad mapping tables
// Maps Numpad digits to standard ASCII keysyms (0x30 - 0x39) so that remote X11/VNC
// reliably inputs digits into the browser regardless of container X11 NumLock quirks.
const NUMPAD_DIGIT_MAP: Record<string, { keysym: number; code: string }> = {
  Numpad0: { keysym: 0x30, code: 'Digit0' },
  Numpad1: { keysym: 0x31, code: 'Digit1' },
  Numpad2: { keysym: 0x32, code: 'Digit2' },
  Numpad3: { keysym: 0x33, code: 'Digit3' },
  Numpad4: { keysym: 0x34, code: 'Digit4' },
  Numpad5: { keysym: 0x35, code: 'Digit5' },
  Numpad6: { keysym: 0x36, code: 'Digit6' },
  Numpad7: { keysym: 0x37, code: 'Digit7' },
  Numpad8: { keysym: 0x38, code: 'Digit8' },
  Numpad9: { keysym: 0x39, code: 'Digit9' },
  NumpadDecimal: { keysym: 0x2e, code: 'Period' },
  NumpadComma: { keysym: 0x2c, code: 'Comma' },
};

const NUMPAD_ACTION_MAP: Record<string, { keysym: number; code: string }> = {
  NumpadAdd: { keysym: 0xffab, code: 'NumpadAdd' },
  NumpadSubtract: { keysym: 0xffad, code: 'NumpadSubtract' },
  NumpadMultiply: { keysym: 0xffaa, code: 'NumpadMultiply' },
  NumpadDivide: { keysym: 0xffaf, code: 'NumpadDivide' },
  NumpadEnter: { keysym: 0xff0d, code: 'Enter' },
  NumpadEqual: { keysym: 0x3d, code: 'Equal' },
};

const NUMPAD_NAV_MAP: Record<string, { keysym: number; code: string }> = {
  Numpad0: { keysym: 0xff63, code: 'Insert' },
  Numpad1: { keysym: 0xff57, code: 'End' },
  Numpad2: { keysym: 0xff54, code: 'ArrowDown' },
  Numpad3: { keysym: 0xff56, code: 'PageDown' },
  Numpad4: { keysym: 0xff51, code: 'ArrowLeft' },
  Numpad5: { keysym: 0xff9d, code: 'Clear' },
  Numpad6: { keysym: 0xff53, code: 'ArrowRight' },
  Numpad7: { keysym: 0xff50, code: 'Home' },
  Numpad8: { keysym: 0xff52, code: 'ArrowUp' },
  Numpad9: { keysym: 0xff55, code: 'PageUp' },
  NumpadDecimal: { keysym: 0xffff, code: 'Delete' },
};

export const ViewerPage: React.FC = () => {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [session, setSession] = useState<SessionResponse | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [connectFailed, setConnectFailed] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [reconnectCounter, setReconnectCounter] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [scaleMode, setScaleMode] = useState<'fit' | 'original'>('fit');
  const [numpadMode, setNumpadMode] = useState<'digit' | 'nav'>('digit');
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [endConfirmLoading, setEndConfirmLoading] = useState(false);
  const [endConfirmError, setEndConfirmError] = useState('');
  const numpadModeRef = useRef<'digit' | 'nav'>('digit');
  numpadModeRef.current = numpadMode;
  const viewerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);

  useEffect(() => {
    const handlePhysicalNumLock = (e: KeyboardEvent) => {
      if (e.code === 'NumLock') {
        setNumpadMode((prev) => (prev === 'digit' ? 'nav' : 'digit'));
      }
    };
    window.addEventListener('keydown', handlePhysicalNumLock);
    return () => {
      window.removeEventListener('keydown', handlePhysicalNumLock);
    };
  }, []);

  useEffect(() => {
    if (rfbRef.current) {
      rfbRef.current.scaleViewport = scaleMode === 'fit';
    }
  }, [scaleMode]);
  const retryCountRef = useRef(0);

  const MAX_RETRIES = 5;

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;
    const loadInitial = async () => {
      try {
        const [s, tRes] = await Promise.all([
          api.getSession(sessionId),
          api.getViewerToken(sessionId)
        ]);
        if (cancelled) return;
        setSession(s);
        setToken(tRes.token);
        setError('');
      } catch (err: any) {
        if (!cancelled) setError(err.message || '获取测试舱遥控连线失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const pollSession = async () => {
      try {
        const s = await api.getSession(sessionId);
        if (!cancelled) setSession(s);
      } catch (err: any) {
        if (!cancelled) setError(err.message || '读取测试舱状态失败');
      }
    };

    loadInitial();
    const interval = window.setInterval(pollSession, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!session?.expiresAt) {
      setRemainingSeconds(0);
      return;
    }

    const updateRemaining = () => {
      const expires = new Date(session.expiresAt).getTime();
      setRemainingSeconds(Math.max(0, Math.floor((expires - Date.now()) / 1000)));
    };

    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [session?.expiresAt]);

  const isEnded = !session || ['TERMINATED', 'EXPIRED', 'FAILED'].includes(session.status);

  useEffect(() => {
    if (!sessionId || !token || !viewerRef.current || isEnded) return;

    let rfbInstance: RFB | null = null;
    let retryTimeout: any = null;
    retryCountRef.current = 0;
    setRetryCount(0);
    setConnectFailed(false);

    const initConnection = (currentToken: string) => {
      if (!viewerRef.current || isEnded) return;

      if (rfbInstance) {
        try { rfbInstance.disconnect(); } catch (_) {}
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/viewer/${encodeURIComponent(sessionId)}/websockify`;

      rfbInstance = new RFB(viewerRef.current, wsUrl, {
        wsProtocols: ['binary', `jingcang.viewer.${currentToken}`],
        credentials: { password: 'secret' }
      } as any);
      rfbInstance.scaleViewport = scaleMode === 'fit';
      rfbInstance.resizeSession = false;
      rfbInstance.focusOnClick = true;
      rfbInstance.background = '#000';
      rfbRef.current = rfbInstance;

      // Enhance keyboard handling to guarantee Numpad numeric & navigation input
      const kb = (rfbInstance as any)._keyboard;
      if (kb) {
        const origOnKeyEvent = kb.onkeyevent;
        kb.onkeyevent = (
          keysym: number,
          code: string,
          down: boolean,
          numlock: boolean | null,
          capslock: boolean | null
        ) => {
          let targetKeysym = keysym;
          let targetCode = code;

          if (code in NUMPAD_ACTION_MAP) {
            targetKeysym = NUMPAD_ACTION_MAP[code].keysym;
            targetCode = NUMPAD_ACTION_MAP[code].code;
          } else if (code in NUMPAD_DIGIT_MAP) {
            const isDigit = numpadModeRef.current === 'digit' || numlock === true || numlock === null;
            if (isDigit) {
              targetKeysym = NUMPAD_DIGIT_MAP[code].keysym;
              targetCode = NUMPAD_DIGIT_MAP[code].code;
            } else if (code in NUMPAD_NAV_MAP) {
              targetKeysym = NUMPAD_NAV_MAP[code].keysym;
              targetCode = NUMPAD_NAV_MAP[code].code;
            }
          }

          origOnKeyEvent.call(kb, targetKeysym, targetCode, down, numlock, capslock);
        };
      }

      // Also wrap sendKey as a defensive fallback
      const origSendKey = rfbInstance.sendKey.bind(rfbInstance);
      rfbInstance.sendKey = (keysym: number, code: string, down?: boolean) => {
        let targetKeysym = keysym;
        let targetCode = code;

        if (code in NUMPAD_ACTION_MAP) {
          targetKeysym = NUMPAD_ACTION_MAP[code].keysym;
          targetCode = NUMPAD_ACTION_MAP[code].code;
        } else if (code in NUMPAD_DIGIT_MAP) {
          if (numpadModeRef.current === 'digit') {
            targetKeysym = NUMPAD_DIGIT_MAP[code].keysym;
            targetCode = NUMPAD_DIGIT_MAP[code].code;
          } else if (code in NUMPAD_NAV_MAP) {
            targetKeysym = NUMPAD_NAV_MAP[code].keysym;
            targetCode = NUMPAD_NAV_MAP[code].code;
          }
        }

        return origSendKey(targetKeysym, targetCode, down);
      };

      rfbInstance.addEventListener('credentialsrequired', () => {
        try {
          (rfbInstance as any)?.sendCredentials({ password: 'secret' });
        } catch (authErr) {
          console.warn('Failed to send VNC credentials:', authErr);
        }
      });

      rfbInstance.addEventListener('securityfailure', (e: any) => {
        console.warn('VNC security failure:', e?.detail);
        setConnectFailed(true);
        setConnectionError('桌面安全认证失败 (VNC 密码错误或未授权)');
      });

      rfbInstance.addEventListener('connect', () => {
        setConnectionError('');
        setConnectFailed(false);
        retryCountRef.current = 0;
        setRetryCount(0);
      });

      rfbInstance.addEventListener('disconnect', (event: Event) => {
        const detail = (event as CustomEvent<{ clean?: boolean }>).detail;
        if (!detail?.clean && !isEnded) {
          const currentRetry = retryCountRef.current;
          if (currentRetry >= MAX_RETRIES) {
            setConnectFailed(true);
            setConnectionError('测试舱画面建立超时（已自动重试 5 次）。底层容器桌面服务可能未就绪或未启动。');
            return;
          }

          const nextRetry = currentRetry + 1;
          retryCountRef.current = nextRetry;
          setRetryCount(nextRetry);
          setConnectionError(`测试舱画面连线初始化中，正在尝试建立通信 (第 ${nextRetry}/${MAX_RETRIES} 次)…`);

          retryTimeout = setTimeout(() => {
            api.getViewerToken(sessionId)
              .then((res) => initConnection(res.token))
              .catch((err: any) => {
                setConnectFailed(true);
                setConnectionError(err.message || '远程桌面未开启或容器还在启动中');
              });
          }, 3000);
        }
      });
    };

    initConnection(token);

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      if (rfbInstance) {
        try { rfbInstance.disconnect(); } catch (_) {}
      }
      if (rfbRef.current === rfbInstance) rfbRef.current = null;
    };
  }, [sessionId, token, isEnded, reconnectCounter]);

  const handleManualReconnect = () => {
    if (!sessionId) return;
    setConnectFailed(false);
    setConnectionError('正在重新建立画面连线…');
    retryCountRef.current = 0;
    setRetryCount(0);
    api.getViewerToken(sessionId)
      .then((res) => {
        setToken(res.token);
        setReconnectCounter((prev) => prev + 1);
      })
      .catch((err: any) => {
        setConnectFailed(true);
        setConnectionError(err.message || '获取遥控连线凭证失败');
      });
  };

  const handleExtendTime = async () => {
    if (!sessionId) return;
    try {
      const updated = await api.extendSession(sessionId, 30);
      setSession(updated);
    } catch (err: any) {
      alert(err.message || '延长测试舱时间失败');
    }
  };

  const handleEndSession = () => {
    if (!sessionId || isEnded) return;
    setEndConfirmError('');
    setEndConfirmOpen(true);
  };

  const confirmEndSession = async () => {
    if (!sessionId) return;
    setEndConfirmLoading(true);
    setEndConfirmError('');
    try {
      await api.terminateSession(sessionId);
      setEndConfirmOpen(false);
      navigate('/sessions');
    } catch (err: any) {
      setEndConfirmError(err.message || '结束测试舱失败');
    } finally {
      setEndConfirmLoading(false);
    }
  };

  const handleToggleFullscreen = () => {
    if (!viewerRef.current) return;
    if (!document.fullscreenElement) {
      viewerRef.current.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '100px 0', color: '#94a3b8' }}>
        正在连线到远程测试舱 noVNC 画面...
      </div>
    );
  }

  if (error || !session) {
    return (
      <div style={{ padding: '40px', maxWidth: '600px', margin: '0 auto', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
        <h2 style={{ color: '#f87171' }}>无法连接测试舱画面</h2>
        <p style={{ color: '#94a3b8' }}>{error || '测试舱不存在或已被关闭'}</p>
        <button onClick={() => navigate('/browsers')} className="btn-primary" style={{ marginTop: '16px' }}>
          返回舱位列表
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)', backgroundColor: 'var(--bg-app)' }}>
      <div style={{
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border-color)',
        padding: '8px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontWeight: 'bold', fontSize: '16px', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <LogoIcon size={18} /> {session.browserName.toUpperCase()} v{session.browserVersion}
          </span>
          {getStatusBadge(session.status)}
          {session.screen ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              backgroundColor: 'var(--bg-subtle)',
              color: '#38bdf8',
              padding: '3px 8px',
              borderRadius: '6px',
              fontSize: '12px',
              fontWeight: 500
            }}>
              <Monitor size={14} />
              <span>{session.screen.width} × {session.screen.height}</span>
            </div>
          ) : null}
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            启动目标: <code style={{ color: '#38bdf8' }}>{session.startUrl}</code>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            backgroundColor: remainingSeconds < 300 ? 'rgba(220, 38, 38, 0.2)' : 'var(--bg-subtle)',
            color: remainingSeconds < 300 ? '#f87171' : 'var(--text-main)',
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '14px'
          }}>
            <Clock size={16} />
            剩余: <strong>{formatTime(remainingSeconds)}</strong>
          </div>

          <button
            onClick={() => setScaleMode((m) => (m === 'fit' ? 'original' : 'fit'))}
            className="btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              backgroundColor: scaleMode === 'original' ? '#0284c7' : 'var(--bg-subtle)',
              borderColor: scaleMode === 'original' ? '#38bdf8' : 'var(--border-color)',
              color: 'var(--text-main)'
            }}
            title={scaleMode === 'fit' ? '当前为窗口缩放适配，点击切换为 1:1 原始尺寸' : '当前为 1:1 原始像素，点击切换为窗口缩放适配'}
          >
            <Scaling size={14} />
            <span>{scaleMode === 'fit' ? '适应窗口' : '1:1 原始'}</span>
          </button>

          <button
            onClick={() => setNumpadMode((m) => (m === 'digit' ? 'nav' : 'digit'))}
            className="btn-secondary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              backgroundColor: numpadMode === 'digit' ? 'rgba(22, 101, 52, 0.4)' : 'var(--bg-subtle)',
              borderColor: numpadMode === 'digit' ? '#22c55e' : 'var(--border-color)',
              color: numpadMode === 'digit' ? '#4ade80' : 'var(--text-muted)'
            }}
            title={
              numpadMode === 'digit'
                ? '小键盘已启用数字模式（敲击右侧小键盘 0-9 输入数字）。点击可切换为导航模式，或按键盘 NumLock 键切换。'
                : '小键盘当前为光标导航模式（Home/End/PgUp/PgDn/方向键）。点击可切换为数字输入模式，或按键盘 NumLock 键切换。'
            }
          >
            <Calculator size={14} />
            <span>{numpadMode === 'digit' ? '小键盘: 数字' : '小键盘: 导航'}</span>
          </button>

          <button onClick={handleExtendTime} disabled={isEnded} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>
            +30 分钟
          </button>
          <button onClick={handleToggleFullscreen} className="btn-secondary" style={{ padding: '4px 10px' }} title="全屏画面">
            <Maximize2 size={16} />
          </button>
          <button onClick={handleEndSession} disabled={isEnded} className="btn-danger" style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 12px' }}>
            <Square size={14} /> 结束测试舱
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', width: '100%', height: '100%', overflow: scaleMode === 'original' ? 'auto' : 'hidden' }}>
        {isEnded ? (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100
          }}>
            <AlertTriangle size={48} color="#f87171" style={{ marginBottom: '16px' }} />
            <h2 style={{ color: '#f8fafc', margin: 0 }}>测试舱已关闭 ({session.status})</h2>
            <p style={{ color: '#94a3b8', marginTop: '8px' }}>底层容器资源已自动回收并释放</p>
            <button onClick={() => navigate('/browsers')} className="btn-primary" style={{ marginTop: '20px' }}>
              重新创建测试舱
            </button>
          </div>
        ) : connectFailed ? (
          <div style={{
            position: 'absolute',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.96)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '24px',
            textAlign: 'center'
          }}>
            <AlertTriangle size={48} color="#f87171" style={{ marginBottom: '16px' }} />
            <h2 style={{ color: '#f8fafc', margin: '0 0 8px 0', fontSize: '20px' }}>测试舱画面连接失败</h2>
            <p style={{ color: '#94a3b8', margin: '0 0 24px 0', maxWidth: '480px', fontSize: '14px', lineHeight: 1.6 }}>
              {connectionError || '底层桌面画面服务未能在预期时间内就绪或通信受阻。'}
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={handleManualReconnect}
                className="btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <RefreshCw size={14} /> 重新尝试连线
              </button>
              <button
                onClick={() => navigate('/sessions')}
                className="btn-secondary"
              >
                返回舱位列表
              </button>
            </div>
          </div>
        ) : (
          <>
            <div ref={viewerRef} style={{ width: '100%', height: '100%', overflow: scaleMode === 'original' ? 'auto' : 'hidden', backgroundColor: '#000' }} />
            {connectionError && (
              <div style={{
                position: 'absolute',
                left: '50%',
                bottom: '24px',
                transform: 'translateX(-50%)',
                backgroundColor: 'rgba(15, 23, 42, 0.92)',
                border: '1px solid #334155',
                color: '#e2e8f0',
                padding: '10px 18px',
                borderRadius: '8px',
                fontSize: '13px',
                zIndex: 20,
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.5)'
              }}>
                <RefreshCw size={14} className="spin-icon" style={{ color: '#38bdf8' }} />
                <span>{connectionError}</span>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={endConfirmOpen}
        tone="danger"
        eyebrow="实时会话终止确认"
        title="立即结束当前测试舱？"
        description="远程画面将立即断开，底层浏览器容器会被回收，当前测试舱内尚未保存的临时数据将永久丢失。"
        subject={session ? `${session.browserName} v${session.browserVersion} · ${session.id}` : sessionId}
        confirmLabel="确认结束并释放资源"
        loading={endConfirmLoading}
        error={endConfirmError}
        onConfirm={confirmEndSession}
        onCancel={() => {
          if (endConfirmLoading) return;
          setEndConfirmOpen(false);
          setEndConfirmError('');
        }}
      />
    </div>
  );
};
