import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { analyticsAPI } from '../api';
import { PLATFORMS, formatNumber } from '../utils';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';

const TABS = ['Overview', 'Per Platform', 'Konten Terbaik'];
const PIE_COLORS = ['#D85A30', '#D4537E', '#378ADD', '#888780', '#639922'];

const followerData = [
  { date: '1 Mar', followers: 260000 }, { date: '8 Mar', followers: 265000 },
  { date: '15 Mar', followers: 271000 }, { date: '22 Mar', followers: 278000 },
  { date: '29 Mar', followers: 284000 },
];
const engagementData = [
  { date: '1 Mar', rate: 5.8 }, { date: '8 Mar', rate: 6.1 },
  { date: '15 Mar', rate: 6.4 }, { date: '22 Mar', rate: 6.2 }, { date: '29 Mar', rate: 6.7 },
];
const platformShare = [
  { name: 'TikTok', value: 36 }, { name: 'Instagram', value: 28 },
  { name: 'YouTube', value: 18 }, { name: 'Facebook', value: 11 }, { name: 'X/Twitter', value: 7 }
];
const topContent = [
  { title: 'Review Produk Terbaru — Unboxing', platform: 'tiktok', views: '890K', eng: '8.4%', date: '28 Mar' },
  { title: 'Tutorial step by step yang viral', platform: 'instagram', views: '450K', eng: '9.1%', date: '25 Mar' },
  { title: 'Vlog behind the scenes produksi', platform: 'youtube', views: '320K', eng: '6.2%', date: '22 Mar' },
  { title: 'Thread tips & tricks populer', platform: 'twitter', views: '240K', eng: '5.8%', date: '20 Mar' },
  { title: 'Facebook live sesi tanya jawab', platform: 'facebook', views: '180K', eng: '4.3%', date: '18 Mar' },
];

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState('Overview');
  const { data: summary } = useQuery({
    queryKey: ['analytics-summary'],
    queryFn: () => analyticsAPI.getSummary().then(r => r.data)
  });

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Analytics</span>
        <div className="page-actions">
          <select style={{ width: 'auto', padding: '6px 10px', fontSize: 12 }}>
            <option>30 hari terakhir</option>
            <option>7 hari terakhir</option>
            <option>90 hari terakhir</option>
          </select>
          <button className="btn-secondary" style={{ fontSize: 12 }}>⬇ Export PDF</button>
        </div>
      </div>
      <div className="page-content">
        <div className="tab-bar">
          {TABS.map(t => (
            <button key={t} className={`tab ${activeTab===t?'active':''}`} onClick={() => setActiveTab(t)}>{t}</button>
          ))}
        </div>

        {activeTab === 'Overview' && (
          <>
            <div className="stat-grid">
              <div className="stat-card"><div className="stat-label">Total Followers</div><div className="stat-value">{formatNumber(284000)}</div><div className="stat-sub">+2.1K minggu ini</div></div>
              <div className="stat-card"><div className="stat-label">Total Reach</div><div className="stat-value">{formatNumber(1200000)}</div><div className="stat-sub">bulan ini</div></div>
              <div className="stat-card"><div className="stat-label">Avg Engagement</div><div className="stat-value">6.7%</div><div className="stat-sub">+0.8% vs bulan lalu</div></div>
              <div className="stat-card"><div className="stat-label">Total Post</div><div className="stat-value">1,340</div><div className="stat-sub">30 hari terakhir</div></div>
            </div>
            <div className="two-col">
              <div className="card">
                <div className="card-title">Pertumbuhan Followers</div>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={followerData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                    <defs><linearGradient id="fg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7F77DD" stopOpacity={0.15}/><stop offset="95%" stopColor="#7F77DD" stopOpacity={0}/></linearGradient></defs>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => formatNumber(v)} />
                    <Tooltip formatter={v => formatNumber(v)} />
                    <Area type="monotone" dataKey="followers" stroke="#7F77DD" fill="url(#fg)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <div className="card-title">Distribusi per Platform</div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={platformShare} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${value}%`} labelLine={false}>
                      {platformShare.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                    </Pie>
                    <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <div className="card-title">Engagement Rate</div>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={engagementData} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1D9E75" stopOpacity={0.15}/><stop offset="95%" stopColor="#1D9E75" stopOpacity={0}/></linearGradient></defs>
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}%`} domain={[4, 10]} />
                  <Tooltip formatter={v => `${v}%`} />
                  <Area type="monotone" dataKey="rate" stroke="#1D9E75" fill="url(#eg)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {activeTab === 'Per Platform' && (
          <div className="three-col">
            {Object.entries(PLATFORMS).map(([key, p]) => (
              <div key={key} className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: p.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: p.text }}>{p.short}</div>
                  <div><div style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</div></div>
                </div>
                {[
                  { label: key==='youtube'?'Subscribers':'Followers', value: formatNumber(key==='youtube'?48200:key==='instagram'?92100:key==='facebook'?38700:key==='twitter'?30400:74500) },
                  { label: key==='youtube'?'Views':'Reach', value: formatNumber(key==='youtube'?320000:key==='instagram'?450000:key==='facebook'?180000:key==='twitter'?240000:890000) },
                  { label: 'Engagement', value: key==='instagram'?'8.1%':key==='tiktok'?'11.2%':key==='youtube'?'6.2%':key==='twitter'?'5.8%':'4.3%' },
                  { label: 'Post bulan ini', value: key==='youtube'?'12':key==='instagram'?'45':key==='tiktok'?'60':key==='facebook'?'30':'80' },
                ].map(m => (
                  <div key={m.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)', fontSize: 13 }}>
                    <span style={{ color: '#888' }}>{m.label}</span>
                    <span style={{ fontWeight: 500 }}>{m.value}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Konten Terbaik' && (
          <div className="card">
            <div className="card-title">Top Performing Content (30 hari)</div>
            {topContent.map((c, i) => {
              const p = PLATFORMS[c.platform];
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#ddd', minWidth: 24 }}>#{i+1}</div>
                  <div style={{ width: 28, height: 28, borderRadius: 6, background: p.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: p.text, flexShrink: 0 }}>{p.short}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{c.title}</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{c.date}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.views}</div>
                    <div style={{ fontSize: 11, color: '#1D9E75' }}>{c.eng} eng</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
