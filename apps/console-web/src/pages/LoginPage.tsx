import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Lock, User } from 'lucide-react';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

interface LoginPageProps {
  onLoginSuccess: (user: { username: string; role: string }) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await api.login(username, password);
      onLoginSuccess(res.user);
      navigate('/browsers');
    } catch (err: any) {
      setError(err.message || '登录失败，请检查用户名和密码');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'var(--bg-app)',
      position: 'relative',
      padding: '20px',
      transition: 'background-color 0.2s ease'
    }}>
      <div style={{ position: 'absolute', top: '20px', right: '24px' }}>
        <ThemeToggle />
      </div>

      <div className="card" style={{ width: '100%', maxWidth: '400px' }}>
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <Logo variant="vertical" size={38} glow />
        </div>

        {error && (
          <div style={{
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            border: '1px solid #dc2626',
            color: '#ef4444',
            padding: '10px 14px',
            borderRadius: '6px',
            fontSize: '14px',
            marginBottom: '16px'
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: 'var(--text-muted)' }}>用户名</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="请输入用户名"
              />
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontSize: '14px', color: 'var(--text-muted)' }}>密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="请输入密码"
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading} style={{ marginTop: '8px', padding: '10px' }}>
            {loading ? '正在登录...' : '登 录'}
          </button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '12px', color: 'var(--text-subtle)' }}>
          完全本地化部署 · 无数据上云
        </div>
      </div>
    </div>
  );
};
