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
  const [verifyingId, setVerifyingId] = useState(null);
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);
  const [lastVerified, setLastVerified] = useState(null);

  const { data: accounts = [], refetch: refetchAccounts } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data),
    refetchInterval: 30000 // Auto-refresh setiap 30 detik
  });

  const disconnect = useMutation({
    mutationFn: (id) => accountsAPI.disconnect(id),
    onSuccess: () => { toast.success('Akun diputus'); qc.invalidateQueries({ queryKey: ['accounts'] }); }
  });

  // Verify single account
  const verifyAccount = async (id) => {
    setVerifyingId(id);
    try {
      const res = await accountsAPI.verify(id);
      toast.success(`${res.data.status === 'connected' ? '✅' : '⚠️'} ${res.data.message}`);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setLastVerified(new Date());
    } catch (err) {
      toast.error('Gagal memverifikasi akun');
    } finally {
      setVerifyingId(null);
    }
  };

  // Verify all accounts
  const verifyAll = async () => {
    setIsVerifyingAll(true);
    try {
      const res = await accountsAPI.verifyAll();
      toast.success(`✅ ${res.data.connected} connected · ⚠️ ${res.data.expired} expired · ❌ ${res.data.disconnected} disconnected`);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      setLastVerified(new Date());
    } catch (err) {
      toast.error('Gagal memverifikasi akun');
    } finally {
      setIsVerifyingAll(false);
    }
  };

  // Auto-refresh status every 60 seconds when on page
  React.useEffect(() => {
    const interval = setInterval(() => {
      refetchAccounts();
    }, 60000);
    return () => clearInterval(interval);
  }, [refetchAccounts]);

  // Status badge renderer
  const getStatusBadge = (acc) => {
    const status = acc.connectionStatus || 'unknown';
    const statusConfig = {
      connected: { color: '#1D9E75', bg: '#EAF3DE', label: 'Terhubung', icon: '✓' },
      disconnected: { color: '#E24B4A', bg: '#FCEBEB', label: 'Terputus', icon: '✗' },
      expired: { color: '#EF9F27', bg: '#FAEEDA', label: 'Expired', icon: '⚠' },
      unknown: { color: '#888', bg: '#f0f0f0', label: 'Belum dicek', icon: '?' },
    };
    const cfg = statusConfig[status] || statusConfig.unknown;
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '2px 8px', borderRadius: 10,
        background: cfg.bg, color: cfg.color,
        fontSize: 10, fontWeight: 600
      }}>
        <span>{cfg.icon}</span>
        <span>{cfg.label}</span>
      </div>
    );
  };

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

  const copyToClipboard = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      if (!ok) throw new Error('execCommand failed');
    }
  };

  const copyOAuthLink = async (platform) => {
    try {
      setConnecting(true);
      const url = await fetchOAuthUrl(platform);
      await copyToClipboard(url);
      setCopiedPlatform(platform);
      toast.success('Link disalin! Buka di Chrome profile yang sesuai.');
      setTimeout(() => setCopiedPlatform(null), 3000);
    } catch (err) {
      console.error('[copyOAuthLink]', err);
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: '#888' }}>
              {accounts.length} akun terhubung
            </span>
            <button
              onClick={verifyAll}
              disabled={isVerifyingAll || accounts.length === 0}
              style={{
                padding: '6px 12px', borderRadius: 8, border: '1.5px solid #E0E0E0',
                background: '#fff', cursor: isVerifyingAll ? 'not-allowed' : 'pointer',
                fontSize: 12, fontWeight: 500, color: '#534AB7',
                display: 'flex', alignItems: 'center', gap: 4
              }}
            >
              {isVerifyingAll ? '⟳' : '🔄'} {isVerifyingAll ? 'Memeriksa...' : 'Cek Status'}
            </button>
            {lastVerified && (
              <span style={{ fontSize: 10, color: '#aaa' }}>
                Terakhir: {lastVerified.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
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

        {/* Status Summary */}
        {accounts.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12,
            padding: '10px 14px', background: '#f8f8f6', borderRadius: 10,
            border: '1px solid rgba(0,0,0,0.06)'
          }}>
            {[
              { label: 'Terhubung', count: accounts.filter(a => a.connectionStatus === 'connected').length, color: '#1D9E75', bg: '#EAF3DE' },
              { label: 'Terputus', count: accounts.filter(a => a.connectionStatus === 'disconnected').length, color: '#E24B4A', bg: '#FCEBEB' },
              { label: 'Expired', count: accounts.filter(a => a.connectionStatus === 'expired').length, color: '#EF9F27', bg: '#FAEEDA' },
              { label: 'Belum dicek', count: accounts.filter(a => !a.connectionStatus || a.connectionStatus === 'unknown').length, color: '#888', bg: '#f0f0f0' },
            ].map(s => (
              <div key={s.label} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', borderRadius: 8,
                background: s.bg, color: s.color,
                fontSize: 11, fontWeight: 600
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: s.color
                }} />
                {s.count} {s.label}
              </div>
            ))}
          </div>
        )}

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
                      {/* Status Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {getStatusBadge(acc)}
                      </div>
                      {/* Verify button */}
                      <button
                        onClick={() => verifyAccount(acc._id)}
                        disabled={verifyingId === acc._id}
                        title="Cek status koneksi"
                        style={{
                          fontSize: 11, padding: '3px 8px', borderRadius: 6,
                          border: '0.5px solid rgba(0,0,0,0.1)', background: 'none',
                          cursor: verifyingId === acc._id ? 'not-allowed' : 'pointer',
                          color: '#7F77DD'
                        }}
                      >
                        {verifyingId === acc._id ? '⟳' : '🔍'}
                      </button>
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
