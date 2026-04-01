import axios from 'axios';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000/api',
  timeout: 30000,
});

// Attach token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('smm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('smm_token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

// ─── Auth ────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
  me: () => api.get('/auth/me'),
};

// ─── Accounts ────────────────────────────────────────────────────────────────
export const accountsAPI = {
  getAll: () => api.get('/accounts'),
  getByUser: (userId) => api.get(`/accounts/user/${userId}`),
  create: (data) => api.post('/accounts', data),
  updateWarmup: (id, data) => api.patch(`/accounts/${id}/warmup`, data),
  disconnect: (id) => api.delete(`/accounts/${id}`),
};

// ─── Posts ───────────────────────────────────────────────────────────────────
export const postsAPI = {
  getAll: (params) => api.get('/posts', { params }),
  getOne: (id) => api.get(`/posts/${id}`),
  create: (formData) => api.post('/posts', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  delete: (id) => api.delete(`/posts/${id}`),
};

// ─── Schedule ────────────────────────────────────────────────────────────────
export const scheduleAPI = {
  getUpcoming: (params) => api.get('/schedule', { params }),
  reschedule: (id, scheduledAt) => api.patch(`/schedule/${id}`, { scheduledAt }),
};

// ─── Notifications ───────────────────────────────────────────────────────────
export const notifAPI = {
  getAll: (params) => api.get('/notifications', { params }),
  markRead: (id) => api.patch(`/notifications/${id}/read`),
  markAllRead: () => api.patch('/notifications/mark-all-read'),
};

// ─── Analytics ───────────────────────────────────────────────────────────────
export const analyticsAPI = {
  getSummary: () => api.get('/analytics/summary'),
  getAccount: (id, days) => api.get(`/analytics/account/${id}`, { params: { days } }),
};

// ─── Amplify ─────────────────────────────────────────────────────────────────
export const amplifyAPI = {
  getAll: () => api.get('/amplify'),
  create: (data) => api.post('/amplify', data),
};

// ─── Warmup ──────────────────────────────────────────────────────────────────
export const warmupAPI = {
  getStats: () => api.get('/warmup/stats'),
  getLogs: () => api.get('/warmup/logs'),
};

export default api;
