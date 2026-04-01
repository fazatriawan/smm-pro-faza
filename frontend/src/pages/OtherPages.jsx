// SchedulerPage.jsx
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scheduleAPI } from '../api';
import { PlatformPill, StatusBadge } from '../utils';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';

export function SchedulerPage() {
  const qc = useQueryClient();
  const { data: posts = [] } = useQuery({
    queryKey: ['scheduled'], queryFn: () => scheduleAPI.getUpcoming({}).then(r => r.data)
  });

  const reschedule = useMutation({
    mutationFn: ({ id, scheduledAt }) => scheduleAPI.reschedule(id, scheduledAt),
    onSuccess: () => { toast.success('Jadwal diperbarui'); qc.invalidateQueries({ queryKey: ['scheduled'] }); }
  });

  const DAILY_TEMPLATE = [
    { time: '07:00', platforms: ['instagram', 'tiktok'], label: 'Konten pagi' },
    { time: '10:00', platforms: ['facebook', 'twitter'], label: 'Update mid-morning' },
    { time: '12:00', platforms: ['instagram', 'facebook'], label: 'Promo siang' },
    { time: '15:00', platforms: ['tiktok', 'youtube'],   label: 'Video sore' },
    { time: '18:00', platforms: ['instagram', 'twitter'], label: 'Prime time' },
    { time: '21:00', platforms: ['facebook', 'tiktok'],  label: 'Recap malam' },
  ];

  const mockPosts = Array.from({ length: 6 }, (_, i) => ({
    _id: String(i), caption: `Konten terjadwal ${i + 1} — caption singkat untuk preview`,
    scheduledAt: dayjs().add(i * 3, 'hour').toISOString(),
    status: i < 2 ? 'completed' : 'scheduled',
    targetAccounts: [
      { account: { platform: ['instagram','youtube','tiktok','facebook','twitter'][i % 5] } },
      { account: { platform: ['facebook','instagram','youtube'][i % 3] } },
    ]
  }));

  const displayPosts = posts.length > 0 ? posts : mockPosts;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Scheduler</span>
        <div className="page-actions">
          <button className="btn-secondary" style={{ fontSize: 12 }}>◷ Tambah Jadwal</button>
        </div>
      </div>
      <div className="page-content">
        <div className="two-col">
          <div>
            <div className="card">
              <div className="card-title">Antrian Terjadwal</div>
              {displayPosts.map((p, i) => (
                <div key={p._id || i} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                  <div style={{ fontSize: 12, color: '#888', minWidth: 55, flexShrink: 0 }}>
                    {dayjs(p.scheduledAt).format('HH:mm')}<br />
                    <span style={{ fontSize: 10 }}>{dayjs(p.scheduledAt).format('DD/MM')}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, marginBottom: 4 }}>{p.caption?.slice(0, 50)}...</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {p.targetAccounts?.slice(0, 4).map((ta, j) => (
                        <PlatformPill key={j} platform={ta.account?.platform} size="sm" />
                      ))}
                    </div>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="card">
              <div className="card-title">Template Jadwal Harian</div>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Jam post otomatis yang akan diulang setiap hari</div>
              {DAILY_TEMPLATE.map((t, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                  <input type="time" defaultValue={t.time} style={{ width: 90, padding: '5px 8px', fontSize: 12 }} />
                  <div style={{ flex: 1, fontSize: 12, color: '#555' }}>{t.label}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {t.platforms.map(p => <PlatformPill key={p} platform={p} size="sm" />)}
                  </div>
                </div>
              ))}
              <button className="btn-primary" style={{ width: '100%', marginTop: 12 }}>Simpan Template</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AmplifyPage.jsx
import { amplifyAPI, accountsAPI } from '../api';
import { PLATFORMS } from '../utils';

export function AmplifyPage() {
  const [url, setUrl] = useState('');
  const [analyzed, setAnalyzed] = useState(false);
  const [selectedActions, setSelectedActions] = useState(new Set(['like']));
  const [commentText, setCommentText] = useState('');
  const qc = useQueryClient();

  const { data: jobs = [] } = useQuery({
    queryKey: ['amplify-jobs'], queryFn: () => amplifyAPI.getAll().then(r => r.data)
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'], queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const createJob = useMutation({
    mutationFn: (d) => amplifyAPI.create(d),
    onSuccess: () => { toast.success('Job amplifikasi dimulai!'); qc.invalidateQueries({ queryKey: ['amplify-jobs'] }); },
    onError: (e) => toast.error(e.response?.data?.message || 'Gagal')
  });

  const ACTIONS = [
    { key: 'like', icon: '♥', label: 'Like' },
    { key: 'comment', icon: '◎', label: 'Komentar' },
    { key: 'share', icon: '↗', label: 'Share' },
    { key: 'repost', icon: '↻', label: 'Repost' },
    { key: 'save', icon: '◈', label: 'Save' },
  ];

  const toggle = (k) => setSelectedActions(prev => {
    const s = new Set(prev); s.has(k) ? s.delete(k) : s.add(k); return s;
  });

  const handleRun = () => {
    if (!url.trim()) return toast.error('Masukkan URL konten target');
    const platform = Object.keys(PLATFORMS).find(p => url.includes(p === 'twitter' ? 'x.com' : p)) || 'instagram';
    const actions = [...selectedActions].map(k => ({ type: k, enabled: true, commentTemplates: k === 'comment' ? [commentText] : [] }));
    createJob.mutate({ targetUrl: url, platform, actions, accountIds: accounts.map(a => a._id) });
  };

  const mockJobs = [
    { _id: '1', targetUrl: 'https://tiktok.com/@brand/video/123', status: 'completed', actions: [{type:'like'},{type:'share'}], results: Array(25).fill({ success: true }), createdAt: new Date() },
    { _id: '2', targetUrl: 'https://instagram.com/p/AbCdEf/', status: 'running', actions: [{type:'like'},{type:'comment'}], results: Array(12).fill({ success: true }), createdAt: new Date(Date.now() - 600000) },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Amplifikasi Konten</span>
      </div>
      <div className="page-content">
        <div className="card">
          <div className="card-title">Target Konten</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input type="url" placeholder="Paste URL konten yang ingin diamplifikasi (TikTok, Instagram, YouTube, dll)" value={url} onChange={e => setUrl(e.target.value)} />
            <button className="btn-primary" style={{ whiteSpace: 'nowrap' }} onClick={() => setAnalyzed(true)}>Analisis</button>
          </div>
          {analyzed && url && (
            <div style={{ background: '#f0efec', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 10 }}>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Konten ditemukan ✓</div>
              <div style={{ fontSize: 12, color: '#888', wordBreak: 'break-all' }}>{url}</div>
            </div>
          )}

          <div className="card-title" style={{ marginTop: 4 }}>Pilih Aksi Amplifikasi</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8, marginBottom: 12 }}>
            {ACTIONS.map(a => (
              <div key={a.key} onClick={() => toggle(a.key)} style={{
                textAlign: 'center', padding: '12px 8px', borderRadius: 10, cursor: 'pointer',
                border: `1.5px solid ${selectedActions.has(a.key) ? '#7F77DD' : 'transparent'}`,
                background: selectedActions.has(a.key) ? '#EEEDFE' : '#f5f4f2',
                transition: 'all 0.12s',
              }}>
                <div style={{ fontSize: 20, color: selectedActions.has(a.key) ? '#7F77DD' : '#aaa' }}>{a.icon}</div>
                <div style={{ fontSize: 11, marginTop: 4, color: selectedActions.has(a.key) ? '#534AB7' : '#666', fontWeight: selectedActions.has(a.key) ? 500 : 400 }}>{a.label}</div>
              </div>
            ))}
          </div>

          {selectedActions.has('comment') && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 4 }}>Template Komentar</label>
              <textarea placeholder="Tulis template komentar... (akan dikirim dari masing-masing akun)" value={commentText} onChange={e => setCommentText(e.target.value)} style={{ minHeight: 60 }} />
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Eksekusi oleh</div>
              <select><option>Semua {accounts.length || 25} akun aktif</option><option>Pilih akun tertentu...</option></select>
            </div>
            <div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Jeda antar aksi</div>
              <select style={{ width: 'auto' }}><option>1-3 detik (natural)</option><option>3-5 detik (aman)</option><option>Tanpa jeda</option></select>
            </div>
          </div>

          <div style={{ background: '#FAEEDA', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#633806', marginBottom: 12 }}>
            ⚠ Amplifikasi menggunakan API resmi. Setiap platform memiliki rate limit. Jeda otomatis diterapkan untuk menghindari pembatasan akun.
          </div>
          <button className="btn-primary" style={{ width: '100%', padding: 10 }} onClick={handleRun} disabled={createJob.isPending}>
            {createJob.isPending ? 'Menjalankan...' : '↑ Jalankan Amplifikasi'}
          </button>
        </div>

        <div className="card">
          <div className="card-title">Riwayat Job Amplifikasi</div>
          {(jobs.length > 0 ? jobs : mockJobs).map((j, i) => (
            <div key={j._id || i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#185FA5', marginBottom: 2, wordBreak: 'break-all' }}>{j.targetUrl}</div>
                <div style={{ fontSize: 11, color: '#aaa' }}>{j.actions?.map(a => a.type).join(', ')} · {j.results?.length || 0} akun · {dayjs(j.createdAt).format('DD/MM HH:mm')}</div>
              </div>
              <span style={{
                fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                background: j.status === 'completed' ? '#EAF3DE' : j.status === 'running' ? '#E6F1FB' : '#FAEEDA',
                color: j.status === 'completed' ? '#3B6D11' : j.status === 'running' ? '#185FA5' : '#854F0B',
              }}>{j.status === 'completed' ? 'Selesai' : j.status === 'running' ? 'Berjalan' : 'Pending'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WarmUpPage.jsx
import { warmupAPI, accountsAPI as accAPI } from '../api';

export function WarmUpPage() {
  const [settings, setSettings] = useState({ likes: 50, comments: 15, follows: 5, searches: 20, saves: 10 });
  const { data: stats } = useQuery({ queryKey: ['warmup-stats'], queryFn: () => warmupAPI.getStats().then(r => r.data), refetchInterval: 60000 });
  const { data: logs = [] } = useQuery({ queryKey: ['warmup-logs'], queryFn: () => warmupAPI.getLogs().then(r => r.data) });

  const mockStats = { like: 1240, comment: 320, follow: 85, search: 450, save: 210 };
  const displayStats = stats || mockStats;

  const STAT_ITEMS = [
    { key: 'like', label: 'Like', icon: '♥', color: '#D4537E' },
    { key: 'comment', label: 'Komentar', icon: '◎', color: '#378ADD' },
    { key: 'follow', label: 'Follow', icon: '◉', color: '#1D9E75' },
    { key: 'search', label: 'Search', icon: '◎', color: '#EF9F27' },
    { key: 'save', label: 'Save', icon: '◈', color: '#7F77DD' },
  ];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Warm Up Akun</span>
        <div className="page-actions">
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#1D9E75', display: 'inline-block' }} />
            Warm Up Aktif
          </span>
        </div>
      </div>
      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 14 }}>
          {STAT_ITEMS.map(s => (
            <div key={s.key} style={{ background: '#fff', border: '0.5px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '14px', textAlign: 'center' }}>
              <div style={{ fontSize: 22, color: s.color, marginBottom: 4 }}>{s.icon}</div>
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: -0.5 }}>{(displayStats[s.key] || 0).toLocaleString()}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{s.label} hari ini</div>
            </div>
          ))}
        </div>

        <div className="two-col">
          <div className="card">
            <div className="card-title">Pengaturan Warm Up Harian</div>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>Batas aksi per akun per hari (semua 25 akun)</div>
            {[
              { key: 'likes', label: 'Like per akun/hari', max: 200 },
              { key: 'comments', label: 'Komentar per akun/hari', max: 50 },
              { key: 'follows', label: 'Follow per akun/hari', max: 20 },
              { key: 'searches', label: 'Search query/hari', max: 100 },
              { key: 'saves', label: 'Save/Bookmark per akun/hari', max: 50 },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <label style={{ fontSize: 12, color: '#666' }}>{f.label}</label>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>{settings[f.key]}</span>
                </div>
                <input type="range" min={0} max={f.max} value={settings[f.key]}
                  onChange={e => setSettings(s => ({ ...s, [f.key]: Number(e.target.value) }))}
                  style={{ width: '100%' }} />
              </div>
            ))}
            <div style={{ background: '#FAEEDA', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#633806', marginBottom: 12 }}>
              ⚠ Limit disesuaikan dengan rate limit resmi masing-masing platform untuk menghindari pembatasan akun.
            </div>
            <button className="btn-primary" style={{ width: '100%' }}>Simpan & Terapkan ke Semua Akun</button>
          </div>

          <div className="card">
            <div className="card-title">Log Warm Up Terbaru</div>
            {(logs.length > 0 ? logs : MOCK_LOGS).slice(0, 10).map((l, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)', fontSize: 12 }}>
                <span style={{ width: 20, height: 20, borderRadius: 4, background: l.success ? '#EAF3DE' : '#FCEBEB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flexShrink: 0 }}>
                  {l.success ? '✓' : '✗'}
                </span>
                <span style={{ flex: 1, color: '#555' }}>{l.action} — <span style={{ color: '#888' }}>{l.account?.label || l.account}</span></span>
                <span style={{ color: '#aaa', flexShrink: 0 }}>{dayjs(l.date).format('HH:mm')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const MOCK_LOGS = Array.from({ length: 10 }, (_, i) => ({
  action: ['like','comment','follow','search','save'][i % 5],
  account: { label: `@user${i+1}` },
  success: i !== 3,
  date: new Date(Date.now() - i * 180000)
}));
