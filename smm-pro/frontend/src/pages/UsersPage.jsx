import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsAPI } from '../api';
import { PLATFORMS, Avatar } from '../utils';
import { useAuthStore } from '../store';
import toast from 'react-hot-toast';

export default function UsersPage() {
  const qc = useQueryClient();
  const { token } = useAuthStore();
  const [connecting, setConnecting] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const disconnect = useMutation({
    mutationFn: (id) => accountsAPI.disconnect(id),
    onSuccess: () => { toast.success('Akun diputus'); qc.invalidateQueries({ queryKey: ['accounts'] }); }
  });

  // Cek kalau baru connect dari OAuth
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'facebook') {
      toast.success('Facebook & Instagram berhasil terhubung!');
      qc.invalidateQueries({ queryKey: ['accounts'] });
      window.history.replaceState({}, '', '/users');
    }
    if (params.get('error')) {
      toast.error('Koneksi gagal, coba lagi');
      window.history.replaceState({}, '', '/users');
    }
  }, [qc]);

  const connectFacebook = async () => {
    try {
      setConnecting(true);
      const res = await fetch(`${process.env.REACT_APP_API_URL}/auth/facebook`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch (err) {
      toast.error('Gagal memulai koneksi');
    } finally {
      setConnecting(false);
    }
  };

  // Group akun berdasarkan platform
  const byPlatform = accounts.reduce((acc, a) => {
    if (!acc[a.platform]) acc[a.platform] = [];
    acc[a.platform].push(a);
    return acc;
  }, {});

  const mockAccounts = [
    { _id: '1', label: '@brand_official', platform: 'facebook', platformUsername: 'Brand Official', isActive: true },
    { _id: '2', label: '@brand_official', platform: 'instagram', platformUsername: 'brand_official', isActive: true },
    { _id: '3', label: '@promo_store', platform: 'facebook', platformUsername: 'Promo Store', isActive: true },
    { _id: '4', label: '@promo_store', platform: 'instagram', platformUsername: 'promo_store', isActive: true },
  ];

  const displayAccounts = accounts.length > 0 ? accounts : mockAccounts;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Akun & User</span>
        <div className="page-actions">
          <span style={{ fontSize: 12, color: '#888' }}>
            {displayAccounts.length} akun terhubung
          </span>
          <button
            className="btn-primary"
            onClick={connectFacebook}
            disabled={connecting}
            style={{ background: '#1877F2' }}
          >
            {connecting ? 'Menghubungkan...' : 'f+ Connect Facebook & Instagram'}
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Info Banner */}
        <div style={{
          background: '#E6F1FB', borderRadius: 10, padding: '12px 16px',
          marginBottom: 14, fontSize: 13, color: '#185FA5',
          display: 'flex', alignItems: 'center', gap: 10
        }}>
          <span>ℹ</span>
          <span>Klik <b>"Connect Facebook & Instagram"</b> untuk menghubungkan semua Facebook Pages dan akun Instagram bisnis kamu sekaligus.</span>
        </div>

        {/* Akun per Platform */}
        {Object.entries(PLATFORMS).map(([key, p]) => {
          const platformAccounts = displayAccounts.filter(a => a.platform === key);
          if (platformAccounts.length === 0) return null;
          return (
            <div key={key} className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: p.bg, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 13, fontWeight: 700, color: p.text
                }}>{p.short}</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{p.label}</div>
                <div style={{ marginLeft: 'auto', fontSize: 12, color: '#aaa' }}>
                  {platformAccounts.length} akun
                </div>
              </div>
              {platformAccounts.map((acc, i) => (
                <div key={acc._id || i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)'
                }}>
                  <Avatar name={acc.platformUsername || acc.label} size={28} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{acc.label}</div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>@{acc.platformUsername}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div style={{
                      width: 7, height: 7, borderRadius: '50%',
                      background: acc.isActive ? '#1D9E75' : '#E24B4A'
                    }} />
                    <span style={{ fontSize: 11, color: '#888' }}>
                      {acc.isActive ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <button
                    onClick={() => disconnect.mutate(acc._id)}
                    style={{
                      fontSize: 11, padding: '3px 8px', borderRadius: 6,
                      border: '0.5px solid rgba(0,0,0,0.1)',
                      background: 'none', cursor: 'pointer', color: '#E24B4A'
                    }}
                  >Putus</button>
                </div>
              ))}
            </div>
          );
        })}

        {/* Kalau belum ada akun terkoneksi */}
        {displayAccounts.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Belum ada akun terhubung</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              Mulai dengan menghubungkan akun Facebook & Instagram kamu
            </div>
            <button
              className="btn-primary"
              onClick={connectFacebook}
              style={{ background: '#1877F2' }}
            >
              f+ Connect Facebook & Instagram
            </button>
          </div>
        )}

        {/* Platform belum tersedia */}
        <div className="card" style={{ background: '#f5f4f2' }}>
          <div className="card-title">Platform Lainnya (Segera)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {['youtube', 'twitter', 'tiktok'].map(p => (
              <div key={p} style={{
                padding: '10px', borderRadius: 10,
                background: PLATFORMS[p].bg, textAlign: 'center', opacity: 0.6
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: PLATFORMS[p].text }}>
                  {PLATFORMS[p].label}
                </div>
                <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>Coming soon</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
