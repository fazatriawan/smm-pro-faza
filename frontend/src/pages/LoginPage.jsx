import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../api';
import { useAuthStore } from '../store';
import { Button, Input, Spinner } from '../components/ui';
import { Sparkles, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--color-background)',
      fontFamily: "'DM Sans', sans-serif",
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Background decoration */}
      <div style={{
        position: 'absolute',
        top: '-20%',
        left: '-10%',
        width: '50%',
        height: '60%',
        background: 'radial-gradient(circle, var(--color-primary-light) 0%, transparent 70%)',
        opacity: 0.5,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-20%',
        right: '-10%',
        width: '50%',
        height: '60%',
        background: 'radial-gradient(circle, var(--color-primary-light) 0%, transparent 70%)',
        opacity: 0.3,
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative',
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-xl)',
        padding: '40px 44px',
        width: 400,
        maxWidth: '90vw',
        boxShadow: 'var(--shadow-xl)',
        animation: 'fadeInScale 300ms ease-out',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 24,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 'var(--radius-md)',
            background: 'var(--color-primary)',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Sparkles size={18} />
          </div>
          <div style={{ fontSize: 'var(--font-h2)', fontWeight: 700, letterSpacing: '-0.5px' }}>
            SMM<span style={{ color: 'var(--color-primary)' }}>Pro</span>
          </div>
        </div>

        <div style={{ fontSize: 'var(--font-small)', color: 'var(--color-text-secondary)', marginBottom: 28 }}>
          Masuk ke dashboard pengelola media sosial kamu
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Input
            label="Email"
            type="email"
            required
            placeholder="admin@brand.com"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          />
          <div style={{ position: 'relative' }}>
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              required
              placeholder="••••••••"
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              inputStyle={{ paddingRight: 40 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: 10,
                top: 30,
                background: 'none',
                border: 'none',
                color: 'var(--color-text-tertiary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: 4,
              }}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <Button
            type="submit"
            loading={loading}
            size="lg"
            style={{ marginTop: 8, width: '100%' }}
          >
            {loading ? 'Masuk...' : 'Masuk'}
          </Button>
        </form>

        <div style={{
          marginTop: 24,
          textAlign: 'center',
          fontSize: 'var(--font-xs)',
          color: 'var(--color-text-tertiary)',
        }}>
          © {new Date().getFullYear()} SMM Pro. All rights reserved.
        </div>
      </div>
    </div>
  );
}
