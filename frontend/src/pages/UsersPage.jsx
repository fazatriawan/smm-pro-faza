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
  const [copiedPlatform, setCopiedPlatform] = useState(null);
  const [collapsedPlatforms, setCollapsedPlatforms] = useState({
    facebook: true, facebook_personal: true, instagram: true,
    threads: true, youtube: true, twitter: true, tiktok: true,
  });
  const [showNotifications, setShowNotifications] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const disconnect = useMutation({
    mutationFn: (id) => accountsAPI.disconnect(id),
    onSuccess: () => { toast.success('Akun diputus'); qc.invalidateQueries({ queryKey: ['accounts'] }); }
  });

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const labels = {
      threads:  'Threads berhasil terhubung!',
      twitter:  'Twitter/X berhasil terhubung!',
      youtube:  'YouTube berhasil terhubung!',
      facebook: 'Facebook & Instagram berhasil terhubung!',
      tiktok:   'TikTok berhasil terhubung!',
      personal: 'Facebook Personal berhasil terhubung!',
    };
    if (connected && labels[connected]) {
      toast.success(labels[connected]);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      window.history.replaceState({}, '', '/users');
    }
    if (params.get('error')) {
      toast.error('Koneksi gagal, coba lagi');
      window.history.replaceState({}, '', '/users');
    }
  }, [qc]);

  const OAUTH_ENDPOINTS = {
    facebook:          '/auth/facebook',
    facebook_personal: '/auth/facebook/personal',
    youtube:           '/auth/youtube',
    twitter:           '/auth/twitter',
    threads:           '/auth/threads',
    tiktok:            '/auth/tiktok',
  };

  const fetchOAuthUrl = async (platform) => {
    const res = await fetch(`${process.env.REACT_APP_API_URL}${OAUTH_ENDPOINTS[platform]}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!data.url) throw new Error('URL tidak tersedia');
    return data.url;
  };

  const connectPlatform = async (platform) => {
    try {
      setConnecting(true);
      const url = await fetchOAuthUrl(platform);
      window.location.href = url;
    } catch {
      toast.error('Gagal memulai koneksi');
    } finally {
      setConnecting(false);
    }
  };

  const copyOAuthLink = async (platform) => {
    try {
      setConnecting(true);
      const url = await fetchOAuthUrl(platform);
      await navigator.clipboard.writeText(url);
      setCopiedPlatform(platform);
      toast.success('Link disalin! Buka di Chrome profile yang sesuai.');
      setTimeout(() => setCopiedPlatform(null), 3000);
    } catch {
      toast.error('Gagal menyalin link');
    } finally {
      setConnecting(false);
    }
  };

  const togglePlatformCollapse = (platform) => {
    setCollapsedPlatforms(prev => ({ ...prev, [platform]: !prev[platform] }));
  };

  const collapseAll = () => {
    setCollapsedPlatforms(Object.fromEntries(
      Object.keys(collapsedPlatforms).map(k => [k, true])
    ));
  };

  const expandAll = () => {
    setCollapsedPlatforms(Object.fromEntries(
      Object.keys(collapsedPlatforms).map(k => [k, false])
    ));
  };

  const PLATFORMS_EXTENDED = {
    facebook:          { label: 'Facebook Pages',    short: 'FB', color: '#1877F2', bg: '#E6F1FB', text: '#185FA5' },
    facebook_personal: { label: 'Facebook Personal', short: 'FP', color: '#1877F2', bg: '#E6F1FB', text: '#185FA5' },
    instagram:         { label: 'Instagram',         short: 'IG', color: '#D4537E', bg: '#FBEAF0', text: '#A02060' },
    threads:           { label: 'Threads',           short: 'TH', color: '#000000', bg: '#f0efec', text: '#333' },
    youtube:           { label: 'YouTube',           short: 'YT', color: '#FF0000', bg: '#FAECE7', text: '#CC0000' },
    twitter:           { label: 'X/Twitter',         short: 'X',  color: '#888780', bg: '#F1EFE8', text: '#555' },
    tiktok:            { label: 'TikTok',            short: 'TT', color: '#639922', bg: '#EAF3DE', text: '#3B6D11' },
  };

  const CONNECT_BUTTONS = [
    { key: 'facebook',          label: 'f+ Facebook & IG',  bg: '#1877F2', color: '#fff',    border: 'none' },
    { key: 'facebook_personal', label: 'f Personal',        bg: '#E6F1FB', color: '#1877F2', border: '1px solid #1877F2' },
    { key: 'youtube',           label: '▶ YouTube',         bg: '#FF0000', color: '#fff',    border: 'none' },
    { key: 'twitter',           label: '𝕏 Twitter',         bg: '#000',    color: '#fff',    border: 'none' },
    { key: 'threads',           label: '@ Threads',         bg: '#000',    color: '#fff',    border: 'none' },
    { key: 'tiktok',            label: '♪ TikTok',          bg: '#000',    color: '#fff',    border: 'none' },
  ];

  const problematicAccounts = accounts.filter(a =>
    !a.isActive ||
    a.tokenError ||
    (a.tokenExpiresAt && new Date(a.tokenExpiresAt) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
  );

  const byPlatform = accounts.reduce((acc, a) => {
    if (!acc[a.platform]) acc[a.platform] = [];
    acc[a.platform].push(a);
    return acc;
  }, {});

  const hasAnyAccount = accounts.length > 0;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Akun & User</span>
        <div className="page-actions">
          <span style={{ fontSize: 12, color: '#888' }}>
            {accounts.length} akun terhubung
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CONNECT_BUTTONS.map(({ key, label, bg, color, border }) => (
              <div key={key} style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: border || 'none' }}>
                <button
                  onClick={() => connectPlatform(key)}
                  disabled={connecting}
                  style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 500, background: bg, color, border: 'none' }}
                >
                  {label}
                </button>
                <button
                  onClick={() => copyOAuthLink(key)}
                  disabled={connecting}
                  title="Copy link untuk dibuka di Chrome profile lain"
                  style={{
                    padding: '8px 10px', cursor: 'pointer', fontSize: 12,
                    background: copiedPlatform === key ? '#1D9E75' : 'rgba(0,0,0,0.15)',
                    color: '#fff', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.2)',
                    transition: 'background 0.2s'
                  }}
                >
                  {copiedPlatform === key ? '✓' : '🔗'}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="page-content">
        {/* Notifikasi akun bermasalah */}
        {problematicAccounts.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div
              onClick={() => setShowNotifications(!showNotifications)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 14px', borderRadius: 20, cursor: 'pointer',
                background: '#FCEBEB', border: '1px solid #E24B4A', userSelect: 'none'
              }}
            >
              <span style={{ fontSize: 16 }}>🔔</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#A32D2D' }}>
                {problematicAccounts.length} akun bermasalah
              </span>
              <span style={{ fontSize: 11, color: '#E24B4A' }}>{showNotifications ? '▲' : '▼'}</span>
            </div>
            {showNotifications && (
              <div style={{ marginTop: 8, background: '#FCEBEB', border: '1px solid #E24B4A', borderRadius: 10, padding: '12px 16px' }}>
                {problematicAccounts.map(a => (
                  <div key={a._id} style={{ fontSize: 12, color: '#A32D2D', marginBottom: 6, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span>•</span>
                    <div>
                      <span style={{ fontWeight: 600 }}>{a.label}</span>
                      <span style={{ marginLeft: 6 }}>
                        {!a.isActive ? '— Perlu hubungkan ulang' :
                         a.tokenError ? '— ' + a.tokenError.slice(0, 60) :
                         '— Token expired dalam 3 hari'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Info Banner */}
        <div style={{ background: '#E6F1FB', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 13, color: '#185FA5', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span>ℹ</span>
          <span>Klik <b>"f+ Facebook & IG"</b> untuk menghubungkan semua Facebook Pages dan Instagram bisnis sekaligus.</span>
        </div>

        {/* Collapse controls */}
        {hasAnyAccount && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button
              onClick={collapseAll}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.15)', background: 'none', cursor: 'pointer', color: '#555' }}
            >
              ▸ Semua Ringkas
            </button>
            <button
              onClick={expandAll}
              style={{ fontSize: 12, padding: '4px 10px', borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.15)', background: 'none', cursor: 'pointer', color: '#555' }}
            >
              ▾ Semua Buka
            </button>
          </div>
        )}

        {/* Akun per Platform */}
        {Object.entries(PLATFORMS_EXTENDED).map(([key, p]) => {
          const platformAccounts = byPlatform[key] || [];
          if (platformAccounts.length === 0) return null;
          const isCollapsed = collapsedPlatforms[key] !== false;
          return (
            <div key={key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                onClick={() => togglePlatformCollapse(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px', cursor: 'pointer', userSelect: 'none',
                  borderBottom: isCollapsed ? 'none' : '0.5px solid rgba(0,0,0,0.06)',
                }}
              >
                <div style={{
                  width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                  background: p.bg, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 12, fontWeight: 700, color: p.text
                }}>{p.short}</div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{p.label}</div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#aaa' }}>{platformAccounts.length} akun</span>
                  <span style={{ fontSize: 11, color: '#bbb', transition: 'transform 0.15s', display: 'inline-block', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▾</span>
                </div>
              </div>
              {!isCollapsed && (
                <div style={{ padding: '4px 16px 10px' }}>
                  {platformAccounts.map((acc, i) => (
                    <div key={acc._id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < platformAccounts.length - 1 ? '0.5px solid rgba(0,0,0,0.05)' : 'none' }}>
                      <Avatar name={acc.platformUsername || acc.label} size={28} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{acc.label}</div>
                        <div style={{ fontSize: 11, color: '#aaa' }}>@{acc.platformUsername}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: acc.isActive ? '#1D9E75' : '#E24B4A' }} />
                        <span style={{ fontSize: 11, color: '#888' }}>{acc.isActive ? 'Aktif' : 'Nonaktif'}</span>
                      </div>
                      <button
                        onClick={() => disconnect.mutate(acc._id)}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '0.5px solid rgba(0,0,0,0.1)', background: 'none', cursor: 'pointer', color: '#E24B4A' }}
                      >Putus</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {accounts.length === 0 && (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🔗</div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 6 }}>Belum ada akun terhubung</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              Mulai dengan menghubungkan akun Facebook & Instagram kamu
            </div>
            <button className="btn-primary" onClick={() => connectPlatform('facebook')} style={{ background: '#1877F2' }}>
              f+ Connect Facebook & Instagram
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
