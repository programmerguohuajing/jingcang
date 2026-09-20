import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { Monitor, Compass, ShieldAlert, LogOut, Terminal } from 'lucide-react';
import { Logo } from './Logo';

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
      backgroundColor: '#1e293b',
      borderBottom: '1px solid #334155',
      padding: '0 24px',
      height: '64px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between'
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
              color: location.pathname === '/browsers' ? '#38bdf8' : '#94a3b8',
              backgroundColor: location.pathname === '/browsers' ? '#0f172a' : 'transparent',
              fontWeight: 500
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
              color: location.pathname === '/sessions' ? '#38bdf8' : '#94a3b8',
              backgroundColor: location.pathname === '/sessions' ? '#0f172a' : 'transparent',
              fontWeight: 500
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
                color: location.pathname === '/admin' ? '#38bdf8' : '#94a3b8',
                backgroundColor: location.pathname === '/admin' ? '#0f172a' : 'transparent',
                fontWeight: 500
              }}
            >
              <ShieldAlert size={18} />
              管理后台
            </Link>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <span style={{ fontSize: '14px', color: '#cbd5e1' }}>
          👤 {user.username} <span style={{ fontSize: '12px', color: '#64748b' }}>({user.role})</span>
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
