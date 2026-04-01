import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../api';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authAPI.login(form);
      setAuth(res.data.user, res.data.token);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f4f2', fontFamily: "'DM Sans', sans-serif"
    }}>
      <div style={{
        background: '#fff', border: '0.5px solid rgba(0,0,0,0.1)',
        borderRadius: 16, padding: '36px 40px', width: 380,
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>
          SMM<span style={{ color: '#7F77DD' }}>Pro</span>
        </div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 28 }}>
          Masuk ke dashboard pengelola media sosial kamu
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Email</label>
            <input type="email" required placeholder="admin@brand.com"
              value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Password</label>
            <input type="password" required placeholder="••••••••"
              value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
          </div>
          <button type="submit" disabled={loading} style={{
            marginTop: 8, padding: '10px', background: '#7F77DD', color: '#fff',
            border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 500,
            cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Masuk...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  );
}
