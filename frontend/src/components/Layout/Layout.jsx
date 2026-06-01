import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore, useNotifStore } from '../../store';
import { useSocket } from '../../hooks/useSocket';
import { notifAPI } from '../../api';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, FileText, Calendar, TrendingUp, Flame, Bell, BarChart3, Sparkles, LogOut, Moon, Sun, ChevronLeft, ChevronRight, Link2
} from 'lucide-react';
import './Layout.css';

const NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/users',         icon: Users, label: 'Akun & User' },
  { to: '/bulk-post',     icon: FileText, label: 'Bulk Post' },
  { to: '/scheduler',     icon: Calendar, label: 'Scheduler' },
  { to: '/amplify',       icon: TrendingUp, label: 'Amplifikasi' },
  { to: '/warmup',        icon: Flame, label: 'Warm Up' },
  { to: '/post-browser',  icon: Link2, label: 'Browser Post' },
  { to: '/ig-scraper',    icon: Link2, label: 'Post Link Scraper' },
  { to: '/notifications', icon: Bell, label: 'Notifikasi' },
  { to: '/analytics',     icon: BarChart3, label: 'Analytics' },
  { to: '/ai',            icon: Sparkles, label: 'AI Tools' },
];

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('smm-theme') || 'system');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
    localStorage.setItem('smm-theme', theme);
  }, [theme]);
  return [theme, setTheme];
}

export default function Layout() {
  const { user, logout } = useAuthStore();
  const { unreadCount, setNotifications } = useNotifStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('smm-sidebar-collapsed') === 'true');
  const [theme, setTheme] = useTheme();

  useSocket(user?._id);

  useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => notifAPI.getAll({ limit: 1 }).then(r => {
      setNotifications([], r.data.unreadCount || 0);
      return r.data;
    }),
    refetchInterval: 30000,
  });

  useEffect(() => {
    localStorage.setItem('smm-sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : prev === 'light' ? 'system' : 'dark');
  };

  const themeIcon = theme === 'dark' ? <Moon size={14} /> : theme === 'light' ? <Sun size={14} /> : <Sun size={14} />;
  const themeLabel = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto';

  return (
    <div className="layout">
      <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <span className="logo-mark">SMM</span>
            {!collapsed && <span className="logo-suffix">Pro</span>}
          </div>
          <button
            className="sidebar-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(n => {
            const Icon = n.icon;
            const isActive = location.pathname === n.to || location.pathname.startsWith(n.to + '/');
            return (
              <NavLink
                key={n.to}
                to={n.to}
                className={`nav-item${isActive ? ' active' : ''}`}
                title={collapsed ? n.label : undefined}
              >
                <span className="nav-icon"><Icon size={18} strokeWidth={1.8} /></span>
                {!collapsed && <span className="nav-label">{n.label}</span>}
                {!collapsed && n.to === '/notifications' && unreadCount > 0 && (
                  <span className="nav-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
                )}
                {collapsed && n.to === '/notifications' && unreadCount > 0 && (
                  <span className="nav-badge-dot" />
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="theme-toggle" onClick={toggleTheme} title={`Theme: ${themeLabel}`}>
            {themeIcon}
            {!collapsed && <span className="theme-label">{themeLabel}</span>}
          </button>

          <div className="user-info">
            <div className="user-avatar">{user?.name?.[0]?.toUpperCase() || 'U'}</div>
            {!collapsed && (
              <div className="user-meta">
                <div className="user-name">{user?.name || 'User'}</div>
                <div className="user-role">{user?.role || 'operator'}</div>
              </div>
            )}
          </div>
          <button className="logout-btn" onClick={() => { logout(); navigate('/login'); }}>
            <LogOut size={14} strokeWidth={1.8} />
            {!collapsed && <span>Keluar</span>}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
