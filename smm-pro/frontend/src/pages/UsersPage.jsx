// UsersPage.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsAPI } from '../api';
import { PLATFORMS, PlatformPill, Avatar } from '../utils';
import toast from 'react-hot-toast';

export default function UsersPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ label: '', platform: 'instagram', platformUsername: '', accessToken: '', refreshToken: '' });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'], queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const addAccount = useMutation({
    mutationFn: (d) => accountsAPI.create(d),
    onSuccess: () => { toast.success('Akun ditambahkan!'); setShowAdd(false); qc.invalidateQueries({ queryKey: ['accounts'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Gagal')
  });

  const disconnect = useMutation({
    mutationFn: (id) => accountsAPI.disconnect(id),
    onSuccess: () => { toast.success('Akun diputus'); qc.invalidateQueries({ queryKey: ['accounts'] }); }
  });

  // Group by owner
  const byOwner = accounts.reduce((acc, a) => {
    const key = a.owner?._id || a.owner;
    if (!acc[key]) acc[key] = { name: a.owner?.name || 'Unknown', email: a.owner?.email, accounts: [] };
    acc[key].accounts.push(a);
    return acc;
  }, {});

  const mockOwners = Array.from({ length: 5 }, (_, i) => ({
    name: ['Brand Official', 'Promo Store', 'Konten Kita', 'Viral Content', 'Daily Post'][i],
    accounts: Object.entries(PLATFORMS).map(([k, v]) => ({ platform: k, label: `@user${i+1}_${k}`, isActive: true }))
  }));

  const owners = Object.values(byOwner).length > 0 ? Object.values(byOwner) : mockOwners;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Akun & User</span>
        <div className="page-actions">
          <span style={{ fontSize: 12, color: '#888' }}>{accounts.length || 125} akun terhubung</span>
          <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Tambah Akun</button>
        </div>
      </div>
      <div className="page-content">
        {showAdd && (
          <div className="card" style={{ border: '1.5px solid #7F77DD' }}>
            <div className="card-title">Tambah Akun Baru</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Label Akun</label>
                <input placeholder="@brand_official" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} /></div>
              <div><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Platform</label>
                <select value={form.platform} onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}>
                  {Object.entries(PLATFORMS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select></div>
              <div><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Username Platform</label>
                <input placeholder="username_di_platform" value={form.platformUsername} onChange={e => setForm(f => ({ ...f, platformUsername: e.target.value }))} /></div>
              <div><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Access Token</label>
                <input placeholder="OAuth Access Token" value={form.accessToken} onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))} /></div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" onClick={() => addAccount.mutate(form)}>Simpan</button>
              <button className="btn-secondary" onClick={() => setShowAdd(false)}>Batal</button>
            </div>
          </div>
        )}

        {owners.map((owner, i) => (
          <div key={i} className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <Avatar name={owner.name} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{owner.name}</div>
                {owner.email && <div style={{ fontSize: 12, color: '#aaa' }}>{owner.email}</div>}
              </div>
              <div style={{ marginLeft: 'auto', fontSize: 12, color: '#aaa' }}>{owner.accounts.length} platform</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
              {owner.accounts.map((acc, j) => {
                const p = PLATFORMS[acc.platform];
                return (
                  <div key={j} style={{ padding: '10px', background: p.bg, borderRadius: 10, position: 'relative' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: p.text, marginBottom: 2 }}>{p.short} {p.label}</div>
                    <div style={{ fontSize: 10, color: '#aaa' }}>{acc.label}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: acc.isActive ? '#1D9E75' : '#E24B4A' }} />
                      <span style={{ fontSize: 10, color: '#888' }}>{acc.isActive ? 'Aktif' : 'Nonaktif'}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
