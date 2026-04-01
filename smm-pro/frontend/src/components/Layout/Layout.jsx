import React from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore, useNotifStore } from '../../store';
import { useSocket } from '../../hooks/useSocket';
import { notifAPI } from '../../api';
import { useQuery } from '@tanstack/react-query';
import './Layout.css';

const NAV = [
  { to: '/dashboard',     icon: '◻', label: 'Dashboard' },
  { to: '/users',         icon: '◉', label: 'Akun & User' },
  { to: '/bulk-post',     icon: '✦', label: 'Bulk Post' },
  { to: '/scheduler',     icon: '◷', label: 'Scheduler' },
  { to: '/amplify',       icon: '↑', label: 'Amplifikasi' },
  { to: '/warmup',        icon: '◎', label: 'Warm Up' },
  { to: '/notifications', icon: '◈', label: 'Notifikasi' },
  { to: '/analytics',     icon: '▦', label: 'Analytics' },
];

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { unreadCount, setNotifications } = useNotifStore();
  const navigate = useNavigate();

  useSocket(user?._id);

  useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => notifAPI.getAll({ limit: 1 }).then(r => {
      setNotifications([], r.data.unreadCount || 0);
      return r.data;
    }),
    refetchInterval: 30000,
  });

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">SMM<span>Pro</span></div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
              <span className="nav-icon">{n.icon}</span>
              <span className="nav-label">{n.label}</span>
              {n.to === '/notifications' && unreadCount > 0 && (
                <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user?.name?.[0]?.toUpperCase() || 'U'}</div>
            <div className="user-meta">
              <div className="user-name">{user?.name || 'User'}</div>
              <div className="user-role">{user?.role || 'operator'}</div>
            </div>
          </div>
          <button className="logout-btn" onClick={() => { logout(); navigate('/login'); }}>Keluar</button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
