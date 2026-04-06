import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsAPI, postsAPI, scheduleAPI, accountsAPI } from '../api';
import { PlatformPill, StatusBadge, formatNumber } from '../utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import dayjs from 'dayjs';

export default function DashboardPage() {
  const { data: summary } = useQuery({ queryKey: ['analytics-summary'], queryFn: () => analyticsAPI.getSummary().then(r => r.data) });
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => accountsAPI ? accountsAPI.getAll().then(r => r.data) : Promise.resolve([]) });

  const problematicAccounts = accounts.filter(a =>
    !a.isActive ||
    a.tokenError ||
    (a.tokenExpiresAt && new Date(a.tokenExpiresAt) < new Date(Date.now() + 3 * 24 * 60 * 60 * 1000))
  );
  const { data: postsData } = useQuery({ queryKey: ['posts-recent'], queryFn: () => postsAPI.getAll({ limit: 5 }).then(r => r.data) });
  const { data: scheduled } = useQuery({ queryKey: ['scheduled-today'], queryFn: () => scheduleAPI.getUpcoming({}).then(r => r.data) });

  const totalAccounts = summary?.totalFollowers ? 1 : 0;
  const totalEngagements = summary?.totalEngagements || 0;
  const totalFollowers = summary?.totalFollowers || 0;
  const totalPosts = postsData?.total || 0;

  const platformData = summary?.perPlatform
    ? Object.entries(summary.perPlatform).map(([name, data]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value: data.reduce((s, a) => s + (a.engagements || 0), 0)
      }))
    : [];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <div className="page-actions">
          <span style={{ fontSize: 12, color: '#888' }}>{dayjs().format('dddd, D MMMM YYYY')}</span>
        </div>
      </div>
      <div className="page-content">
        {problematicAccounts.length > 0 && (
          <div style={{
            background: '#FCEBEB', border: '1px solid #E24B4A',
            borderRadius: 10, padding: '12px 16px', marginBottom: 16,
            display: 'flex', alignItems: 'center', gap: 12
          }}>
            <span style={{ fontSize: 20 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#A32D2D' }}>
                {problematicAccounts.length} akun bermasalah —
              </span>
              <span style={{ fontSize: 12, color: '#A32D2D', marginLeft: 6 }}>
                {problematicAccounts.map(a => a.label).join(', ')}
              </span>
            </div>
            <a href="/users" style={{
              fontSize: 12, padding: '4px 12px', borderRadius: 8,
              background: '#E24B4A', color: '#fff',
              textDecoration: 'none', fontWeight: 500, flexShrink: 0
            }}>
              Perbaiki →
            </a>
          </div>
        )}
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Total Akun</div>
            <div className="stat-value">{summary?.accounts?.length || 0}</div>
            <div className="stat-sub">akun terhubung</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Post Bulan Ini</div>
            <div className="stat-value">{totalPosts}</div>
            <div className="stat-sub">total post</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Engagement</div>
            <div className="stat-value">{formatNumber(totalEngagements)}</div>
            <div className="stat-sub">semua platform</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Followers</div>
            <div className="stat-value">{formatNumber(totalFollowers)}</div>
            <div className="stat-sub">semua akun</div>
          </div>
        </div>

        <div className="two-col">
          <div className="card">
            <div className="card-title">Engagement per Platform</div>
            {platformData.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={platformData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => formatNumber(v)} />
                  <Bar dataKey="value" fill="#AFA9EC" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
                <div>Belum ada data analytics</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Hubungkan akun sosmed untuk melihat data</div>
              </div>
            )}
          </div>
          <div className="card">
            <div className="card-title">Post Terkirim (7 hari)</div>
            {(postsData?.posts || []).length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart
                  data={Array.from({length: 7}, (_, i) => ({
                    day: dayjs().subtract(6-i, 'day').format('ddd'),
                    posts: (postsData?.posts || []).filter(p =>
                      dayjs(p.createdAt).format('YYYY-MM-DD') === dayjs().subtract(6-i, 'day').format('YYYY-MM-DD')
                    ).length
                  }))}
                  margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                >
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="posts" stroke="#7F77DD" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="empty-state">
                <div style={{ fontSize: 32, marginBottom: 8 }}>📝</div>
                <div>Belum ada post</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Mulai buat post di menu Bulk Post</div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-title">Antrian Post Hari Ini</div>
          {(scheduled || []).length === 0 ? (
            <div className="empty-state">
              <div style={{ fontSize: 32, marginBottom: 8 }}>📅</div>
              <div>Tidak ada post terjadwal hari ini</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>Jadwalkan post di menu Bulk Post</div>
            </div>
          ) : (scheduled || []).map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 12, color: '#888', minWidth: 55, flexShrink: 0 }}>
                {dayjs(p.scheduledAt).format('HH:mm')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, marginBottom: 4 }}>{p.caption}</div>
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
