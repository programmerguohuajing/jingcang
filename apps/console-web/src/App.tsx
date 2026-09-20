import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { LoginPage } from './pages/LoginPage';
import { BrowserCatalogPage } from './pages/BrowserCatalogPage';
import { ViewerPage } from './pages/ViewerPage';
import { SessionListPage } from './pages/SessionListPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { api } from './api/client';
import { ThemeProvider } from './context/ThemeContext';

export const App: React.FC = () => {
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMe()
      .then((u) => setUser(u))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--text-muted, #94a3b8)' }}>正在加载镜舱 (JingCang)...</div>;
  }

  return (
    <ThemeProvider>
      <BrowserRouter>
      {user && <Navbar user={user} onLogout={() => setUser(null)} />}
      <Routes>
        <Route
          path="/login"
          element={user ? <Navigate to="/browsers" replace /> : <LoginPage onLoginSuccess={setUser} />}
        />
        <Route
          path="/browsers"
          element={user ? <BrowserCatalogPage isAdmin={user.role === 'admin'} /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/viewer/:sessionId"
          element={user ? <ViewerPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/sessions"
          element={user ? <SessionListPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/admin"
          element={user && user.role === 'admin' ? <AdminDashboardPage /> : <Navigate to="/browsers" replace />}
        />
        <Route path="*" element={<Navigate to={user ? "/browsers" : "/login"} replace />} />
      </Routes>
    </BrowserRouter>
  </ThemeProvider>
  );
};
