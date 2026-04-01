import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsAPI, postsAPI, scheduleAPI } from '../api';
import { PlatformPill, StatusBadge, formatNumber } from '../utils';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import dayjs from 'dayjs';

export default function DashboardPage() {
  const { data: summary } = useQuery({ queryKey: ['analytics-summary'], queryFn: () => analyticsAPI.getSummary().then(r => r.data) });
  const { data: postsData } = useQuery({ queryKey: ['posts-recent'], queryFn: () => postsAPI.getAll({ limit: 5 }).then(r => r.data) });
  const { data: scheduled } = useQuery({ queryKey: ['scheduled-today'], queryFn: () => scheduleAPI.getUpcoming({}).then(r => r.data) });

  const platformData = [
    { name: 'YouTube',   value: 3200 },
    { name: 'Instagram', value: 4100 },
    { name: 'Facebook',  value: 1800 },
    { name: 'X/Twitter', value: 1400 },
    { name: 'TikTok',    value: 5900 },
  ];

  const weekData = [
    { day: 'Sen', posts: 32 }, { day: 'Sel', posts: 45 }, { day: 'Rab', posts: 28 },
    { day: 'Kam', posts: 51 }, { day: 'Jum', posts: 47 }, { day: 'Sab', posts: 38 }, { day: 'Min', posts: 53 },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Dashboard</span>
        <div className="page-actions">
          <span style={{ fontSize: 12, color: '#888' }}>{dayjs().format('dddd, D MMMM YYYY')}</span>
        </div>
      </div>
      <div className="page-content">
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-label">Total Akun</div>
            <div className="stat-value">125</div>
            <div className="stat-sub">25 user × 5 platform</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Post Hari Ini</div>
            <div className="stat-value">{postsData?.total || 0}</div>
            <div className="stat-sub">+12 dari kemarin</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Engagement</div>
            <div className="stat-value">{formatNumber(summary?.totalEngagements || 8400)}</div>
            <div className="stat-sub">+23% minggu ini</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Followers</div>
            <div className="stat-value">{formatNumber(summary?.totalFollowers || 284000)}</div>
            <div className="stat-sub">+2.1K minggu ini</div>
          </div>
        </div>

        <div className="two-col">
          <div className="card">
            <div className="card-title">Engagement per Platform</div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={platformData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatNumber(v)} />
                <Bar dataKey="value" fill="#AFA9EC" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div className="card-title">Post Terkirim (7 hari)</div>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={weekData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Line type="monotone" dataKey="posts" stroke="#7F77DD" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <div style={{ background: '#f0efec', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: '#888' }}>Reach Total</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>124K</div>
              </div>
              <div style={{ background: '#f0efec', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 10, color: '#888' }}>Avg. Engagement</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>6.7%</div>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Antrian Post Hari Ini</div>
          {(scheduled || [
            { scheduledAt: '2026-04-01T08:00', caption: 'Konten motivasi pagi hari...', targetAccounts: [{account:{platform:'instagram'}},{account:{platform:'facebook'}},{account:{platform:'twitter'}}], status:'completed' },
            { scheduledAt: '2026-04-01T12:00', caption: 'Promo produk tengah hari + link bio', targetAccounts: [{account:{platform:'youtube'}},{account:{platform:'instagram'}}], status:'completed' },
            { scheduledAt: '2026-04-01T18:00', caption: 'Video review produk terbaru', targetAccounts: [{account:{platform:'youtube'}},{account:{platform:'tiktok'}}], status:'scheduled' },
            { scheduledAt: '2026-04-01T21:00', caption: 'Recap harian + polling audiens', targetAccounts: [{account:{platform:'instagram'}},{account:{platform:'twitter'}}], status:'scheduled' },
          ]).map((p, i) => (
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
