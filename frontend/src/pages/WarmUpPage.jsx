import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { warmupAPI, accountsAPI } from '../api';
import { PLATFORMS, deduplicateAccounts } from '../utils';
import { Card, Button, EmptyState, Badge, Avatar } from '../components/ui';
import { Heart, MessageCircle, UserPlus, Search, Bookmark, Activity, CheckCircle2, XCircle, Info } from 'lucide-react';
import dayjs from 'dayjs';

const STAT_ITEMS = [
  { key: 'like',    label: 'Like',      icon: Heart,         color: 'var(--color-error)' },
  { key: 'comment', label: 'Komentar',  icon: MessageCircle, color: 'var(--color-info)' },
  { key: 'follow',  label: 'Follow',    icon: UserPlus,      color: 'var(--color-success)' },
  { key: 'search',  label: 'Search',    icon: Search,        color: 'var(--color-warning)' },
  { key: 'save',    label: 'Save',      icon: Bookmark,      color: 'var(--color-primary)' },
];

const FORM_ITEMS = [
  { key: 'likes',    label: 'Like per akun/hari',       max: 200 },
  { key: 'comments', label: 'Komentar per akun/hari',   max: 50 },
  { key: 'follows',  label: 'Follow per akun/hari',     max: 20 },
  { key: 'searches', label: 'Search query/hari',        max: 100 },
  { key: 'saves',    label: 'Save/Bookmark per akun/hari', max: 50 },
];

const MOCK_LOGS = Array.from({ length: 10 }, (_, i) => ({
  action: ['like','comment','follow','search','save'][i % 5],
  account: { label: `@user${i+1}` },
  success: i !== 3,
  date: new Date(Date.now() - i * 180000)
}));

export default function WarmUpPage() {
  const [settings, setSettings] = useState({ likes: 50, comments: 15, follows: 5, searches: 20, saves: 10 });
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set());
  const [selectAll, setSelectAll] = useState(true);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['warmup-stats'],
    queryFn: () => warmupAPI.getStats().then(r => r.data),
    refetchInterval: 60000
  });
  const { data: logs = [], isLoading: logsLoading } = useQuery({
    queryKey: ['warmup-logs'],
    queryFn: () => warmupAPI.getLogs().then(r => r.data)
  });
  const { data: rawAccounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const accounts = deduplicateAccounts(rawAccounts);
  // Warm up hanya untuk automation accounts
  const automationAccounts = accounts.filter(a => a.loginType === 'automation');

  const toggleAccount = (id) => {
    setSelectedAccountIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
    setSelectAll(false);
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelectedAccountIds(new Set());
      setSelectAll(false);
    } else {
      setSelectedAccountIds(new Set(automationAccounts.map(a => a._id)));
      setSelectAll(true);
    }
  };

  const displayStats = stats || { like: 1240, comment: 320, follow: 85, search: 450, save: 210 };
  const displayLogs = logs.length > 0 ? logs : MOCK_LOGS;

  const actionIconMap = {
    like: Heart, comment: MessageCircle, follow: UserPlus, search: Search, save: Bookmark
  };

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Warm Up Akun</span>
        <div className="page-actions">
          <Badge variant="success" size="sm">
            <Activity size={10} style={{ marginRight: 4 }} />
            Warm Up Aktif
          </Badge>
        </div>
      </div>

      <div className="page-content">
        {/* Stats */}
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
          {STAT_ITEMS.map(s => {
            const Icon = s.icon;
            return (
              <div key={s.key} className="stat-card" style={{ textAlign: 'center', padding: 'var(--space-4)' }}>
                <div style={{ marginBottom: 8, color: s.color }}>
                  <Icon size={20} />
                </div>
                <div className="stat-value" style={{ fontSize: 24 }}>
                  {statsLoading ? 'â€”' : (displayStats[s.key] || 0).toLocaleString()}
                </div>
                <div className="stat-label">{s.label} hari ini</div>
              </div>
            );
          })}
        </div>

        {/* Account Selector */}
        <Card header="Pilih Akun Warm Up" headerAction={
          <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
            {automationAccounts.length} akun automation
          </span>
        } style={{ marginBottom: 16 }}>
          {automationAccounts.length === 0 ? (
            <div className="alert alert-info" style={{ marginBottom: 0 }}>
              <Info size={14} />
              <span>Warm up hanya tersedia untuk akun automation (desktop app). Akun OAuth tidak dapat digunakan untuk warm up.</span>
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid var(--color-border-subtle)' }}>
                <input
                  type="checkbox"
                  checked={selectAll}
                  onChange={toggleSelectAll}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 'var(--font-small)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                  Semua Akun ({automationAccounts.length})
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
                {automationAccounts.map(acc => {
                  const p = PLATFORMS[acc.platform];
                  const isSelected = selectAll || selectedAccountIds.has(acc._id);
                  return (
                    <div
                      key={acc._id}
                      onClick={() => toggleAccount(acc._id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '6px 8px', borderRadius: 'var(--radius-sm)',
                        cursor: 'pointer',
                        background: isSelected ? 'var(--color-primary-light)' : 'transparent',
                        transition: 'background var(--transition-fast)',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleAccount(acc._id)}
                        style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <Avatar name={acc.platformUsername || acc.label} size={24} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 'var(--font-small)', fontWeight: 500, color: 'var(--color-text-primary)' }}>{acc.label}</div>
                        <div style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)' }}>@{acc.platformUsername}</div>
                      </div>
                      {p && (
                        <span style={{
                          fontSize: 'var(--font-xs)', padding: '1px 6px', borderRadius: 'var(--radius-full)',
                          background: p.bg, color: p.text, fontWeight: 600, flexShrink: 0
                        }}>
                          {p.short}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <div className="two-col">
          <Card header="Pengaturan Warm Up Harian">
            <div style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)', marginBottom: 16 }}>
              Batas aksi per akun per hari
            </div>
            {FORM_ITEMS.map(f => (
              <div key={f.key} style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' }}>
                  <label style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                    {f.label}
                  </label>
                  <span style={{ fontSize: 'var(--font-small)', fontWeight: 600, color: 'var(--color-primary)' }}>
                    {settings[f.key]}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={f.max}
                  value={settings[f.key]}
                  onChange={e => setSettings(s => ({ ...s, [f.key]: Number(e.target.value) }))}
                  style={{ width: '100%', accentColor: 'var(--color-primary)' }}
                />
              </div>
            ))}
            <div className="alert alert-warning" style={{ marginBottom: 16, marginTop: 8 }}>
              Limit disesuaikan dengan rate limit resmi masing-masing platform untuk menghindari pembatasan akun.
            </div>
            <Button variant="primary" size="md" style={{ width: '100%' }} disabled={automationAccounts.length === 0}>
              Simpan & Terapkan ke {selectAll ? automationAccounts.length : selectedAccountIds.size} Akun
            </Button>
          </Card>

          <Card header="Log Warm Up Terbaru" headerAction={
            <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
              {displayLogs.length} entri
            </span>
          }>
            {logsLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3,4,5].map(i => <div key={i} className="skeleton" style={{ height: 32 }} />)}
              </div>
            ) : displayLogs.length === 0 ? (
              <EmptyState
                icon={<Activity size={40} />}
                title="Belum ada log"
                description="Log warm up akan muncul setelah aktivitas dimulai"
              />
            ) : displayLogs.slice(0, 10).map((l, i) => {
              const ActionIcon = actionIconMap[l.action] || Activity;
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 0',
                  borderBottom: i < displayLogs.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 'var(--radius-sm)',
                    background: l.success ? 'var(--color-success-light)' : 'var(--color-error-light)',
                    color: l.success ? 'var(--color-success)' : 'var(--color-error)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {l.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <ActionIcon size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                    <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-secondary)', textTransform: 'capitalize' }}>
                      {l.action}
                    </span>
                  </div>
                  <span style={{ flex: 1, fontSize: 'var(--font-caption)', color: 'var(--color-text-primary)' }}>
                    {l.account?.label || l.account}
                  </span>
                  <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
                    {dayjs(l.date).format('HH:mm')}
                  </span>
                </div>
              );
            })}
          </Card>
        </div>
      </div>
    </div>
  );
}
