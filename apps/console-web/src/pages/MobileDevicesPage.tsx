import React, { useCallback, useEffect, useState } from 'react';

type Device = { id: string; kind: string; state: string; model?: string; osVersion?: string; booted?: boolean };
type Payload = { success: boolean; data?: { status: string; devices: Device[] }; error?: { message: string } };

export const MobileDevicesPage: React.FC = () => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/mobile/devices', { credentials: 'same-origin' });
      const body = await res.json() as Payload;
      if (!res.ok || !body.success || !body.data) throw new Error(body.error?.message || '设备查询失败');
      setDevices(body.data.devices);
      setStatus(body.data.status);
      setError('');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : '未知错误');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 12000);
    return () => clearInterval(timer);
  }, [refresh]);
  return (
    <main style={{ maxWidth: 1100, margin: '32px auto', padding: '0 24px', color: 'var(--text-main)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div><h1>移动设备池</h1><p style={{ color: 'var(--text-muted)' }}>Android 优先 · Agent 设备发现与在线状态</p></div>
        <button className="btn-secondary" onClick={() => void refresh()}>刷新设备</button>
      </div>
      <section style={{ padding: 20, border: '1px solid var(--nav-border)', borderRadius: 12, marginTop: 20 }}>
        <p>Android Agent：<strong>{status === 'online' ? '在线' : status === 'loading' ? '检测中' : status === 'not-configured' ? '未配置' : '离线或连接失败'}</strong></p>
        {error && <p role="alert">{error}</p>}
        {devices.length === 0 && <p style={{ color: 'var(--text-muted)' }}>暂无已发现设备。请检查 Windows Agent 与 ADB。</p>}
        {devices.map(device => (
          <div key={device.id} style={{ padding: 18, border: '1px solid var(--nav-border)', borderRadius: 10, margin: '12px 0' }}>
            <h3 style={{ margin: '0 0 8px' }}>{device.model || device.id}</h3>
            <p style={{ margin: 0 }}>类型：{device.kind === 'android-emulator' ? 'Android 模拟器' : 'Android 真机'} · 系统：{device.osVersion || '未知'} · 状态：{device.state} · {device.booted ? '启动完成' : '待就绪'}</p>
            <small style={{ color: 'var(--text-muted)' }}>设备 ID：{device.id}</small>
          </div>
        ))}
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>当前为设备发现验证阶段。云手机启动、画面与触控操作将在后续阶段开放。</p>
      </section>
    </main>
  );
};
