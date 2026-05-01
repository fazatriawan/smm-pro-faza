import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsAPI, postsAPI, scheduleAPI, accountsAPI } from '../api';
import { PlatformPill, StatusBadge, formatNumber } from '../utils';
import { EmptyState, StatCard } from '../components/ui';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Users, FileText, Heart, TrendingUp, AlertTriangle, Calendar, ArrowRight } from 'lucide-react';
import dayjs from 'dayjs';

export default function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => analyticsAPI.getSummary().then(r => r.data)
  });
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI ? accountsAPI.getAll().then(r => r.data) : Promise.resolve([])
  });

  const problematicAccounts = accounts.filter(a =>
    !a.isActive || a.tokenError ||
    (a.tokenExpiresAt && new Date(a.tokenExpiresAt) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
  );

  const { data: postsData, isLoading: postsLoading } = useQuery({
    queryKey: ['posts-recent'],
    queryFn: () => postsAPI.getAll({ limit: 5 }).then(r => r.data)
  });
  const { data: scheduled, isLoading: scheduledLoading } = useQuery({
    queryKey: ['scheduled-today'],
    queryFn: () => scheduleAPI.getUpcoming({}).then(r => r.data)
  });

  const totalEngagements = summary?.totalEngagements || 0;
  const totalFollowers = summary?.totalFollowers || 0;
  const totalPosts = postsData?.total || 0;

  const platformData = summary?.perPlatform
    ? Object.entries(summary.perPlatform).map(([name, data]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value: data.reduce((s, a) => s + (a.engagements || 0), 0)
      }))
    : [];

  const weekPosts = Array.from({ length: 7 }, (_, i) => ({
    day: dayjs().subtract(6 - i, 'day').format('ddd'),
    posts: (postsData?.posts || []).filter(p =>
      dayjs(p.createdAt).format('YYYY-MM-DD') === dayjs().subtract(6 - i, 'day').format('YYYY-MM-DD')
    ).length
  }));

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <div className="page-actions">
          <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
            {dayjs().format('dddd, D MMMM YYYY')}
          </span>
        </div>
      </div>

      <div className="page-content">
        {/* Problematic Accounts Alert */}
        {problematicAccounts.length > 0 && (
          <div className="alert alert-error" style={{ marginBottom: 16 }}>
            <AlertTriangle size={18} />
            <div style={{ flex: 1 }}>
              <strong>{problematicAccounts.length} akun bermasalah</strong>
              <span style={{ marginLeft: 8, opacity: 0.85 }}>
                {problematicAccounts.map(a => a.label).join(', ')}
              </span>
            </div>
            <a href="/users" className="btn-primary" style={{ fontSize: 'var(--font-xs)', padding: '5px 12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              Perbaiki <ArrowRight size={12} />
            </a>
          </div>
        )}

        {/* Stats */}
        <div className="stat-grid">
          <StatCard
            label="Total Akun"
            value={summaryLoading ? '—' : summary?.accounts?.length || 0}
            sub="akun terhubung"
            icon={<Users size={16} />}
          />
          <StatCard
            label="Post Bulan Ini"
            value={postsLoading ? '—' : totalPosts}
            sub="total post"
            icon={<FileText size={16} />}
          />
          <StatCard
            label="Total Engagement"
            value={summaryLoading ? '—' : formatNumber(totalEngagements)}
            sub="semua platform"
            icon={<Heart size={16} />}
          />
          <StatCard
            label="Total Followers"
            value={summaryLoading ? '—' : formatNumber(totalFollowers)}
            sub="semua akun"
            icon={<TrendingUp size={16} />}
          />
        </div>

        {/* Charts */}
        <div className="two-col">
          <div className="card">
            <div className="card-title">Engagement per Platform</div>
            {platformData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={platformData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <Tooltip
                    formatter={(v) => formatNumber(v)}
                    contentStyle={{
                      background: 'var(--color-surface-elevated)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-caption)',
                      boxShadow: 'var(--shadow-dropdown)',
                    }}
                  />
                  <Bar dataKey="value" fill="var(--color-primary)" radius={[6, 6, 0, 0]} opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={<TrendingUp size={40} />}
                title="Belum ada data analytics"
                description="Hubungkan akun sosmed untuk melihat data engagement"
              />
            )}
          </div>

          <div className="card">
            <div className="card-title">Post Terkirim (7 hari)</div>
            {(postsData?.posts || []).length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={weekPosts} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-text-tertiary)' }} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--color-surface-elevated)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--font-caption)',
                      boxShadow: 'var(--shadow-dropdown)',
                    }}
                  />
                  <Line type="monotone" dataKey="posts" stroke="var(--color-primary)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--color-primary)', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={<FileText size={40} />}
                title="Belum ada post"
                description="Mulai buat post di menu Bulk Post"
              />
            )}
          </div>
        </div>

        {/* Scheduled Today */}
        <div className="card">
          <div className="card-title">Antrian Post Hari Ini</div>
          {(scheduled || []).length === 0 ? (
            <EmptyState
              icon={<Calendar size={40} />}
              title="Tidak ada post terjadwal hari ini"
              description="Jadwalkan post di menu Bulk Post"
            />
          ) : (scheduled || []).map((p, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'flex-start', gap: 12,
              padding: '10px 0',
              borderBottom: i < scheduled.length - 1 ? '1px solid var(--color-border-subtle)' : 'none'
            }}>
              <div style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)', minWidth: 55, flexShrink: 0 }}>
                {dayjs(p.scheduledAt).format('HH:mm')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 'var(--font-small)', marginBottom: 4, color: 'var(--color-text-primary)' }}>
                  {p.caption}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {p.targetAccounts?.map((ta, j) => (
                    <PlatformPill key={j} platform={ta.account?.platform} size="sm" />
                  ))}
                </div>
              </div>
              <StatusBadge status={p.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
