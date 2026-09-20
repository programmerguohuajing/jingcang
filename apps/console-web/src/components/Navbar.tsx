import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { Monitor, Compass, ShieldAlert, LogOut } from 'lucide-react';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

interface NavbarProps {
  user: { username: string; role: string } | null;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    try {
      await api.logout();
      onLogout();
      navigate('/login');
    } catch (err) {
      console.error(err);
    }
  };

  if (!user) return null;

  return (
    <nav style={{
      backgroundColor: 'var(--nav-bg, #1e293b)',
      borderBottom: '1px solid var(--nav-border, #334155)',
      padding: '0 24px',
      height: '64px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      transition: 'background-color 0.2s ease, border-color 0.2s ease'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <Link to="/browsers" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          <Logo size={32} />
        </Link>

        <div style={{ display: 'flex', gap: '8px' }}>
          <Link
            to="/browsers"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '6px',
              textDecoration: 'none',
              color: location.pathname === '/browsers' ? 'var(--primary-color, #0284c7)' : 'var(--text-muted, #94a3b8)',
              backgroundColor: location.pathname === '/browsers' ? 'var(--bg-subtle, #f1f5f9)' : 'transparent',
              fontWeight: 500,
              transition: 'all 0.15s ease'
            }}
          >
            <Compass size={18} />
            浏览器舱位
          </Link>

          <Link
            to="/sessions"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              borderRadius: '6px',
              textDecoration: 'none',
              color: location.pathname === '/sessions' ? 'var(--primary-color, #0284c7)' : 'var(--text-muted, #94a3b8)',
              backgroundColor: location.pathname === '/sessions' ? 'var(--bg-subtle, #f1f5f9)' : 'transparent',
              fontWeight: 500,
              transition: 'all 0.15s ease'
            }}
          >
            <Monitor size={18} />
            测试舱列表
          </Link>

          {user.role === 'admin' && (
            <Link
              to="/admin"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '6px',
                textDecoration: 'none',
                color: location.pathname === '/admin' ? 'var(--primary-color, #0284c7)' : 'var(--text-muted, #94a3b8)',
                backgroundColor: location.pathname === '/admin' ? 'var(--bg-subtle, #f1f5f9)' : 'transparent',
                fontWeight: 500,
                transition: 'all 0.15s ease'
              }}
            >
              <ShieldAlert size={18} />
              管理后台
            </Link>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <ThemeToggle />
        <span style={{ fontSize: '14px', color: 'var(--text-main, #cbd5e1)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          👤 {user.username} <span style={{ fontSize: '12px', color: 'var(--text-subtle, #64748b)' }}>({user.role})</span>
        </span>
        <button
          onClick={handleLogout}
          className="btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px' }}
        >
          <LogOut size={16} />
          退出
        </button>
      </div>
    </nav>
  );
};
