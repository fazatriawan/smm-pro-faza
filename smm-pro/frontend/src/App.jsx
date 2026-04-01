import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './store';
import { authAPI } from './api';
import Layout from './components/Layout/Layout';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import BulkPostPage from './pages/BulkPostPage';
import SchedulerPage from './pages/SchedulerPage';
import AmplifyPage from './pages/AmplifyPage';
import WarmUpPage from './pages/WarmUpPage';
import NotificationsPage from './pages/NotificationsPage';
import AnalyticsPage from './pages/AnalyticsPage';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30000 } } });

function AuthGate({ children }) {
  const { token, user, setAuth, logout } = useAuthStore();
  useEffect(() => {
    if (token && !user) {
      authAPI.me().then(r => setAuth(r.data, token)).catch(() => logout());
    }
  }, [token, user, setAuth, logout]);
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster position="top-right" toastOptions={{ style: { fontSize: 13, borderRadius: 8 } }} />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<AuthGate><Layout /></AuthGate>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard"      element={<DashboardPage />} />
            <Route path="users"          element={<UsersPage />} />
            <Route path="bulk-post"      element={<BulkPostPage />} />
            <Route path="scheduler"      element={<SchedulerPage />} />
            <Route path="amplify"        element={<AmplifyPage />} />
            <Route path="warmup"         element={<WarmUpPage />} />
            <Route path="notifications"  element={<NotificationsPage />} />
            <Route path="analytics"      element={<AnalyticsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
