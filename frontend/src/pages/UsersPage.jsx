import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountsAPI } from '../api';
import { PLATFORMS, Avatar } from '../utils';
import { useAuthStore } from '../store';
import { Button, AccountStatusBadge, EmptyState } from '../components/ui';
import {
  RefreshCw, Search, Trash2, ChevronDown, ChevronRight,
  Link2, Check, Globe, Video, MessageCircle, Hash, AlertTriangle,
  MonitorSmartphone, X, Eye, EyeOff, Camera
} from 'lucide-react';
import toast from 'react-hot-toast';

const PLATFORMS_EXTENDED = {
  facebook:          { label: 'Facebook Pages',    short: 'FB', color: '#1877F2', bg: '#E6F1FB', text: '#185FA5', icon: Globe },
  facebook_personal: { label: 'Facebook Personal', short: 'FP', color: '#1877F2', bg: '#E6F1FB', text: '#185FA5', icon: Globe },
  instagram:         { label: 'Instagram',         short: 'IG', color: '#D4537E', bg: '#FBEAF0', text: '#A02060', icon: MessageCircle },
  threads:           { label: 'Threads',           short: 'TH', color: '#000000', bg: '#f0efec', text: '#333',    icon: Hash },
  youtube:           { label: 'YouTube',           short: 'YT', color: '#FF0000', bg: '#FAECE7', text: '#CC0000', icon: Video },
  twitter:           { label: 'X/Twitter',         short: 'X',  color: '#888780', bg: '#F1EFE8', text: '#555',    icon: MessageCircle },
  tiktok:            { label: 'TikTok',            short: 'TT', color: '#639922', bg: '#EAF3DE', text: '#3B6D11', icon: Hash },
};

const CONNECT_BUTTONS = [
  { key: 'facebook',          label: 'Facebook & IG',  bg: '#1877F2', color: '#fff' },
  { key: 'facebook_personal', label: 'FB Personal',    bg: '#E6F1FB', color: '#1877F2' },
  { key: 'instagram',         label: 'Instagram',      bg: '#D4537E', color: '#fff' },
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

  // Automation account modal
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [automationForm, setAutomationForm] = useState({
    platform: 'instagram',
    label: '',
    platformUsername: '',
    password: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [addingAutomation, setAddingAutomation] = useState(false);

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
      instagram: 'Instagram berhasil terhubung!',
      tiktok: 'TikTok berhasil terhubung!',
      personal: 'Facebook Personal berhasil terhubung!',
    };
    const errorMessages = {
      instagram_no_pages: 'Tidak ada Facebook Pages. Buat Page dan hubungkan ke Instagram Business Account.',
      instagram_no_business_account: 'Instagram Business Account tidak ditemukan. Pastikan akun Instagram sudah Business/Creator dan di-link ke Facebook Page.',
      instagram_oauth_failed: 'Koneksi Instagram gagal. Coba lagi atau gunakan Desktop App Automation.',
    };
    if (connected && labels[connected]) {
      toast.success(labels[connected]);
      qc.invalidateQueries({ queryKey: ['accounts'] });
      window.history.replaceState({}, '', '/users');
    }
    const errorParam = params.get('error');
    if (errorParam) {
      toast.error(errorMessages[errorParam] || 'Koneksi gagal, coba lagi');
      window.history.replaceState({}, '', '/users');
    }
  }, [qc]);

  const OAUTH_ENDPOINTS = {
    facebook: '/auth/facebook',
    facebook_personal: '/auth/facebook/personal',
    instagram: '/auth/instagram',
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

  const addAutomationAccount = async () => {
    const { platform, label, platformUsername, password } = automationForm;
    if (!label.trim() || !platformUsername.trim() || !password.trim()) {
      toast.error('Semua field wajib diisi');
      return;
    }
    setAddingAutomation(true);
    try {
      await accountsAPI.createAutomation({
        label: label.trim(),
        platform,
        platformUsername: platformUsername.trim(),
        password,
      });
      toast.success(`Akun ${platform} automation berhasil ditambahkan!`);
      setShowAutomationModal(false);
      setAutomationForm({ platform: 'instagram', label: '', platformUsername: '', password: '' });
      qc.invalidateQueries({ queryKey: ['accounts'] });
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Gagal menambahkan akun automation');
    } finally {
      setAddingAutomation(false);
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
            {/* Instagram Direct / Automation Button */}
            <button
              onClick={() => setShowAutomationModal(true)}
              style={{
                padding: '7px 12px', cursor: 'pointer', fontSize: 'var(--font-caption)',
                fontWeight: 500, background: '#FBEAF0', color: '#A02060',
                border: '1.5px solid #D4537E', borderRadius: 'var(--radius-sm)',
                whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              <Camera size={14} />
              Instagram (Direct)
            </button>
          </div>
        </div>

        {/* Automation Account Modal */}
        {showAutomationModal && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }} onClick={() => setShowAutomationModal(false)}>
            <div style={{
              background: 'var(--color-surface)', borderRadius: 16, maxWidth: 480, width: '100%',
              padding: 24, boxShadow: 'var(--shadow-xl)',
            }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Camera size={18} style={{ color: '#D4537E' }} />
                  Connect Instagram (Direct)
                </div>
                <button onClick={() => setShowAutomationModal(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}>
                  <X size={18} />
                </button>
              </div>

              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                <strong>Cara ini sama seperti SocialPilot &quot;Via Instagram&quot;.</strong>
                Hubungkan akun Instagram Business/Creator secara langsung dengan username dan password.
                <strong>Tidak memerlukan Facebook Page.</strong> Posting dilakukan via Desktop App automation.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>Platform</label>
                  <select
                    value={automationForm.platform}
                    onChange={e => setAutomationForm(prev => ({ ...prev, platform: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                      color: 'var(--color-text-primary)', fontSize: 13,
                    }}
                  >
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                    <option value="twitter">X/Twitter</option>
                    <option value="youtube">YouTube</option>
                    <option value="tiktok">TikTok</option>
                    <option value="threads">Threads</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>Label Akun *</label>
                  <input
                    type="text"
                    placeholder="contoh: @brand_official"
                    value={automationForm.label}
                    onChange={e => setAutomationForm(prev => ({ ...prev, label: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                      color: 'var(--color-text-primary)', fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>Username *</label>
                  <input
                    type="text"
                    placeholder="username Instagram tanpa @"
                    value={automationForm.platformUsername}
                    onChange={e => setAutomationForm(prev => ({ ...prev, platformUsername: e.target.value }))}
                    style={{
                      width: '100%', padding: '8px 10px', borderRadius: 8,
                      border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                      color: 'var(--color-text-primary)', fontSize: 13,
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4, display: 'block' }}>Password *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Password akun Instagram"
                      value={automationForm.password}
                      onChange={e => setAutomationForm(prev => ({ ...prev, password: e.target.value }))}
                      style={{
                        width: '100%', padding: '8px 10px', paddingRight: 36, borderRadius: 8,
                        border: '1.5px solid var(--color-border)', background: 'var(--color-surface)',
                        color: 'var(--color-text-primary)', fontSize: 13,
                      }}
                    />
                    <button
                      onClick={() => setShowPassword(!showPassword)}
                      style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center',
                      }}
                    >
                      {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>

                <div style={{
                  background: 'var(--color-warning-light)',
                  border: '1px solid var(--color-warning)',
                  borderRadius: 8, padding: '10px 12px',
                  fontSize: 12, color: 'var(--color-warning-dark)',
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                }}>
                  <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <strong>Perhatian:</strong> Password akan dienkripsi sebelum disimpan.
                    Posting ke akun ini memerlukan Desktop App yang sedang berjalan.
                    <a href="/bulk-post-guide" target="_blank" style={{ color: 'var(--color-warning-dark)', textDecoration: 'underline' }}>Baca panduan</a>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <Button
                    variant="secondary"
                    size="md"
                    style={{ flex: 1 }}
                    onClick={() => setShowAutomationModal(false)}
                  >
                    Batal
                  </Button>
                  <Button
                    variant="primary"
                    size="md"
                    style={{ flex: 1 }}
                    loading={addingAutomation}
                    onClick={addAutomationAccount}
                  >
                    Simpan Akun
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

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
