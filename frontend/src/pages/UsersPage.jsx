import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsAPI } from '../api';
import { PLATFORMS, Avatar } from '../utils';
import { useAuthStore } from '../store';
import { Button, AccountStatusBadge, EmptyState } from '../components/ui';
import {
  RefreshCw, Search, Trash2, ChevronDown, ChevronRight,
  Link2, Check, Globe, Video, MessageCircle, Hash, AlertTriangle
} from 'lucide-react';
import toast from 'react-hot-toast';

const PLATFORMS_EXTENDED = {
  facebook:          { label: 'Facebook Pages',    short: 'FB', color: '#1877F2', bg: '#E6F1FB', text: '#185FA5', icon: Globe },
  facebook_personal: { label: 'Facebook Personal', short: 'FP', color: '#1877F2', bg: '#E6F1FB', text: '#185FA5', icon: Globe },
  instagram:         { label: 'Instagram',         short: 'IG', color: '#D4537E', bg: '#FBEAF0', text: '#A02060', icon: MessageCircle },
  threads:           { label: 'Threads',           short: 'TH', color: '#000000', bg: '#f0efec', text: '#333',    icon: Hash },
  youtube:           { label: 'YouTube',           short: 'YT', color: '#FF0000', bg: '#FAECE7', text: '#CC0000', icon: Video },
  twitter:           { label: 'X/Twitter',         short: 'X',  color: '#888780', bg: '#F1EFE8', text: '#555',    icon: Twitter },
  tiktok:            { label: 'TikTok',            short: 'TT', color: '#639922', bg: '#EAF3DE', text: '#3B6D11', icon: Hash },
};

const CONNECT_BUTTONS = [
  { key: 'facebook',          label: 'Facebook & IG',  bg: '#1877F2', color: '#fff' },
  { key: 'facebook_personal', label: 'FB Personal',    bg: '#E6F1FB', color: '#1877F2' },
  { key: 'youtube',           label: 'YouTube',        bg: '#FF0000', color: '#fff' },
  { key: 'twitter',           label: 'Twitter/X',      bg: '#111',    color: '#fff' },
  { key: 'threads',           label: 'Threads',        bg: '#111',    color: '#fff' },
  { key: 'tiktok',            label: 'TikTok',         bg: '#111',    color: '#fff' },
];

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
    refetchInterval: 30000
  });

  const disconnect = useMutation({
    mutationFn: (id) => accountsAPI.disconnect(id),
    onSuccess: () => { toast.success('Akun diputus'); qc.invalidateQueries({ queryKey: ['accounts'] }); },
    onError: (err) => { toast.error(err?.response?.data?.message || 'Gagal memutuskan akun'); }
  });

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

  React.useEffect(() => {
    const interval = setInterval(() => refetchAccounts(), 60000);
    return () => clearInterval(interval);
  }, [refetchAccounts]);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    const labels = {
      threads: 'Threads berhasil terhubung!',
      twitter: 'Twitter/X berhasil terhubung!',
      youtube: 'YouTube berhasil terhubung!',
      facebook: 'Facebook & Instagram berhasil terhubung!',
      tiktok: 'TikTok berhasil terhubung!',
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
    facebook: '/auth/facebook',
    facebook_personal: '/auth/facebook/personal',
    youtube: '/auth/youtube',
    twitter: '/auth/twitter',
    threads: '/auth/threads',
    tiktok: '/auth/tiktok',
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
    try { setConnecting(true); window.location.href = await fetchOAuthUrl(platform); }
    catch { toast.error('Gagal memulai koneksi'); }
    finally { setConnecting(false); }
  };

  const copyToClipboard = async (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
      document.body.appendChild(el);
      el.focus(); el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
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
    } catch {
      toast.error('Gagal menyalin link');
    } finally {
      setConnecting(false);
    }
  };

  const togglePlatformCollapse = (platform) => {
    setCollapsedPlatforms(prev => ({ ...prev, [platform]: !prev[platform] }));
  };
  const collapseAll = () => setCollapsedPlatforms(Object.fromEntries(Object.keys(collapsedPlatforms).map(k => [k, true])));
  const expandAll = () => setCollapsedPlatforms(Object.fromEntries(Object.keys(collapsedPlatforms).map(k => [k, false])));

  const problematicAccounts = accounts.filter(a =>
    !a.isActive || a.tokenError ||
    (a.tokenExpiresAt && new Date(a.tokenExpiresAt) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
  );

  const byPlatform = accounts.reduce((acc, a) => {
    if (!acc[a.platform]) acc[a.platform] = [];
    const key = a.platformUserId || a._id;
    const idx = acc[a.platform].findIndex(x => (x.platformUserId || x._id) === key);
    if (idx === -1) acc[a.platform].push(a);
    else if (a.loginType === 'oauth' && acc[a.platform][idx].loginType !== 'oauth') acc[a.platform][idx] = a;
    return acc;
  }, {});

  const statusCounts = {
    connected: accounts.filter(a => a.connectionStatus === 'connected').length,
    disconnected: accounts.filter(a => a.connectionStatus === 'disconnected').length,
    expired: accounts.filter(a => a.connectionStatus === 'expired').length,
    unknown: accounts.filter(a => !a.connectionStatus || a.connectionStatus === 'unknown').length,
  };

  const statusItems = [
    { key: 'connected',    label: 'Terhubung',  variant: 'success' },
    { key: 'disconnected', label: 'Terputus',   variant: 'error' },
    { key: 'expired',      label: 'Expired',    variant: 'warning' },
    { key: 'unknown',      label: 'Belum dicek', variant: 'default' },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Akun & User</span>
        <div className="page-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
            {accounts.length} akun terhubung
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={verifyAll}
            loading={isVerifyingAll}
            disabled={accounts.length === 0}
            iconLeft={<RefreshCw size={13} />}
          >
            Cek Status
          </Button>
          {lastVerified && (
            <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)' }}>
              Terakhir: {lastVerified.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </div>

      <div className="page-content">
        {/* Problematic accounts alert */}
        {problematicAccounts.length > 0 && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={16} />
            <div style={{ flex: 1 }}>
              <strong>{problematicAccounts.length} akun bermasalah</strong>
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                style={{ marginLeft: 8, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: 'var(--font-caption)' }}
              >
                {showNotifications ? 'Sembunyikan' : 'Detail'}
              </button>
              {showNotifications && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {problematicAccounts.map(a => (
                    <div key={a._id} style={{ fontSize: 'var(--font-caption)', opacity: 0.9 }}>
                      <strong>{a.label}</strong> —
                      {!a.isActive ? ' Perlu hubungkan ulang' : a.tokenError ? ' ' + a.tokenError.slice(0, 60) : ' Token expired dalam 3 hari'}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Connect buttons */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">Hubungkan Akun Baru</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CONNECT_BUTTONS.map(({ key, label, bg, color }) => (
              <div key={key} style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <button
                  onClick={() => connectPlatform(key)}
                  disabled={connecting}
                  style={{
                    padding: '7px 12px', cursor: 'pointer', fontSize: 'var(--font-caption)',
                    fontWeight: 500, background: bg, color, border: 'none', whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </button>
                <button
                  onClick={() => copyOAuthLink(key)}
                  disabled={connecting}
                  title="Copy link untuk dibuka di Chrome profile lain"
                  style={{
                    padding: '7px 9px', cursor: 'pointer', fontSize: 'var(--font-xs)',
                    background: copiedPlatform === key ? 'var(--color-success)' : 'rgba(0,0,0,0.12)',
                    color: '#fff', border: 'none', borderLeft: '1px solid rgba(255,255,255,0.2)',
                    transition: 'background var(--transition-fast)',
                    display: 'flex', alignItems: 'center',
                  }}
                >
                  {copiedPlatform === key ? <Check size={12} /> : <Link2 size={12} />}
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Status summary */}
        {accounts.length > 0 && (
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16,
            padding: '10px 14px', background: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
          }}>
            {statusItems.map(s => (
              <div key={s.key} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '4px 10px', borderRadius: 'var(--radius-full)',
                background: `var(--color-${s.variant}-light)`,
                color: `var(--color-${s.variant}-dark)`,
                fontSize: 'var(--font-xs)', fontWeight: 600,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%',
                  background: `var(--color-${s.variant})`
                }} />
                {statusCounts[s.key]} {s.label}
              </div>
            ))}
          </div>
        )}

        {/* Collapse controls */}
        {accounts.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <Button variant="ghost" size="sm" onClick={collapseAll}>
              <ChevronRight size={13} style={{ marginRight: 4 }} /> Semua Ringkas
            </Button>
            <Button variant="ghost" size="sm" onClick={expandAll}>
              <ChevronDown size={13} style={{ marginRight: 4 }} /> Semua Buka
            </Button>
          </div>
        )}

        {/* Platform Cards */}
        {Object.entries(PLATFORMS_EXTENDED).map(([key, p]) => {
          const platformAccounts = byPlatform[key] || [];
          if (platformAccounts.length === 0) return null;
          const isCollapsed = collapsedPlatforms[key] !== false;
          const Icon = p.icon;
          return (
            <div key={key} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div
                onClick={() => togglePlatformCollapse(key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
                  borderBottom: isCollapsed ? 'none' : '1px solid var(--color-border-subtle)',
                }}
              >
                <div style={{
                  width: 32, height: 32, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                  background: p.bg, display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 12, fontWeight: 700, color: p.text
                }}>
                  {Icon ? <Icon size={16} /> : p.short}
                </div>
                <div style={{ fontSize: 'var(--font-body)', fontWeight: 500 }}>{p.label}</div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
                    {platformAccounts.length} akun
                  </span>
                  <ChevronDown size={14} style={{
                    color: 'var(--color-text-tertiary)',
                    transition: 'transform var(--transition-fast)',
                    transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                  }} />
                </div>
              </div>

              {!isCollapsed && (
                <div style={{ padding: '4px 16px 10px' }}>
                  {platformAccounts.map((acc, i) => (
                    <div key={acc._id || i} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 0',
                      borderBottom: i < platformAccounts.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                    }}>
                      <Avatar name={acc.platformUsername || acc.label} size={28} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--font-small)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                          {acc.label}
                        </div>
                        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)' }}>
                          @{acc.platformUsername}
                        </div>
                      </div>
                      <AccountStatusBadge status={acc.connectionStatus} />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => verifyAccount(acc._id)}
                        loading={verifyingId === acc._id}
                        disabled={verifyingId === acc._id}
                        iconLeft={<Search size={12} />}
                        style={{ padding: '4px 8px', fontSize: 'var(--font-xs)' }}
                      >
                        Cek
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => disconnect.mutate(acc._id)}
                        iconLeft={<Trash2 size={12} />}
                        style={{ padding: '4px 8px', fontSize: 'var(--font-xs)', color: 'var(--color-error)' }}
                      >
                        Putus
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {accounts.length === 0 && (
          <EmptyState
            icon={<Link2 size={48} />}
            title="Belum ada akun terhubung"
            description="Mulai dengan menghubungkan akun Facebook & Instagram kamu"
            action={
              <Button onClick={() => connectPlatform('facebook')}>
                Connect Facebook & Instagram
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
