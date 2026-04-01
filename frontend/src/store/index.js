import { create } from 'zustand';

export const useAuthStore = create((set) => ({
  user: null,
  token: localStorage.getItem('smm_token'),
  setAuth: (user, token) => {
    localStorage.setItem('smm_token', token);
    set({ user, token });
  },
  logout: () => {
    localStorage.removeItem('smm_token');
    set({ user: null, token: null });
  },
}));

export const useNotifStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  setNotifications: (notifications, unreadCount) => set({ notifications, unreadCount }),
  addNotification: (notif) => set((s) => ({
    notifications: [notif, ...s.notifications],
    unreadCount: s.unreadCount + 1,
  })),
  markRead: (id) => set((s) => ({
    notifications: s.notifications.map(n => n._id === id ? { ...n, isRead: true } : n),
    unreadCount: Math.max(0, s.unreadCount - 1),
  })),
  markAllRead: () => set((s) => ({
    notifications: s.notifications.map(n => ({ ...n, isRead: true })),
    unreadCount: 0,
  })),
}));

export const useAccountStore = create((set) => ({
  accounts: [],
  setAccounts: (accounts) => set({ accounts }),
  addAccount: (account) => set((s) => ({ accounts: [...s.accounts, account] })),
  removeAccount: (id) => set((s) => ({ accounts: s.accounts.filter(a => a._id !== id) })),
}));

export const useUIStore = create((set) => ({
  sidebarOpen: true,
  activeSection: 'dashboard',
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setActiveSection: (activeSection) => set({ activeSection }),
}));
