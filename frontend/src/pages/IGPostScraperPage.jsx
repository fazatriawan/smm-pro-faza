import React, { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountsAPI, scraperAPI } from '../api';
import { normalizeScraperLines } from '../utils/scraperUsername';
import { Link2, Upload, Trash2, Download, ExternalLink, Loader2, MessageCircle, Hash } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS_BADGE = {
  success:      { label: '✅ Postingan', cls: 'badge-success' },
  profile_only: { label: '👤 Link Profil', cls: 'badge-neutral' },
  private:      { label: '🔒 Private', cls: 'badge-warn' },
  not_found:    { label: '❌ Tidak ditemukan', cls: 'badge-error' },
  empty:        { label: '📭 Kosong', cls: 'badge-neutral' },
  error:        { label: '❌ Error', cls: 'badge-error' },
};

const PLATFORMS = {
  instagram: {
    key: 'instagram',
    label: 'Instagram',
    icon: MessageCircle,
    accountPlatform: 'instagram',
    run: (data) => scraperAPI.runInstagram(data),
    export: (results) => scraperAPI.exportInstagram(results),
    exportPrefix: 'hasil_instagram',
    profileExample: 'instagram.com/username',
  },
  threads: {
    key: 'threads',
    label: 'Threads',
    icon: Hash,
    accountPlatform: 'threads',
    run: (data) => scraperAPI.runThreads(data),
    export: (results) => scraperAPI.exportThreads(results),
    exportPrefix: 'hasil_threads',
    profileExample: 'threads.com/@username',
  },
};

function isClickable(r) {
  return r.status === 'success' || r.status === 'profile_only' || r.status === 'empty';
}

export default function IGPostScraperPage() {
  const [platform, setPlatform] = useState('instagram');
  const [profileOnly, setProfileOnly] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [usernamesText, setUsernamesText] = useState('');
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);
  const [running, setRunning] = useState(false);
  const fileRef = useRef(null);

  const cfg = PLATFORMS[platform];

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then((r) => r.data),
  });

  const platformAccounts = accounts.filter(
    (a) => a.platform === cfg.accountPlatform && a.isActive !== false && a.loginType !== 'automation'
  );

  const usernameCount = usernamesText.split('\n').map((l) => l.trim()).filter(Boolean).length;

  const switchPlatform = (next) => {
    if (next === platform || running) return;
    setPlatform(next);
    setProfileOnly(false);
    setAccountId('');
    setLogs([]);
    setResults([]);
    setSummary(null);
  };

  const appendLogs = (incoming) => {
    setLogs((prev) => [
      ...prev,
      ...incoming.map((l) => ({
        ...l,
        time: new Date().toLocaleTimeString('id-ID'),
      })),
    ]);
  };

  const runScraper = async () => {
    const raw = usernamesText.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!raw.length) {
      toast.error('Isi daftar username di kotak teks (satu per baris) — contoh abrorsoeka');
      return;
    }
    const usernames = normalizeScraperLines(raw, platform);
    if (!usernames.length) {
      toast.error('Username tidak valid. Gunakan nama akun saja, bukan link posting /p/ atau /reel/');
      return;
    }
    if (usernames.length < raw.length) {
      toast(`Dinormalisasi: ${usernames.length} username dari ${raw.length} baris`, { icon: 'ℹ️' });
    }

    if (platform === 'instagram' && !profileOnly && !accountId) {
      toast.error('Pilih akun Instagram terhubung (Business/Creator) untuk link postingan terbaru');
      return;
    }

    setRunning(true);
    setLogs([]);
    setResults([]);
    setSummary(null);

    try {
      const res = await cfg.run({
        usernames,
        profileOnly,
        accountId: accountId || undefined,
      });
      const data = res.data;
      if (data.logs?.length) appendLogs(data.logs);
      if (data.success) {
        setResults(data.results || []);
        setSummary(data.summary || null);
        toast.success(`Scraping ${cfg.label} selesai`);
      } else {
        toast.error(data.message || 'Scraping gagal');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Scraping gagal');
    } finally {
      setRunning(false);
    }
  };

  const exportCsv = async () => {
    if (!results.length) {
      toast.error('Tidak ada hasil untuk diekspor');
      return;
    }
    try {
      const res = await cfg.export(results);
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cfg.exportPrefix}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV diunduh');
    } catch {
      toast.error('Gagal export CSV');
    }
  };

  const loadTxtFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUsernamesText(String(reader.result || ''));
      toast.success(`File ${file.name} dimuat`);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Post Link Scraper</span>
      </div>

      <div className="page-content">
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginBottom: 16,
            flexWrap: 'wrap',
          }}
        >
          {Object.values(PLATFORMS).map((p) => {
            const Icon = p.icon;
            const active = platform === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => switchPlatform(p.key)}
                disabled={running}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  borderRadius: 8,
                  border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background: active ? 'var(--bg-card)' : 'var(--bg-secondary)',
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: active ? 600 : 400,
                  fontSize: 13,
                  cursor: running ? 'not-allowed' : 'pointer',
                }}
              >
                <Icon size={16} />
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="two-col" style={{ alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Link2 size={16} />
                {cfg.label} Post Scraper
              </div>

              {platform === 'instagram' && !profileOnly && (
                <div className="form-group">
                  <label>
                    Akun Instagram Anda (terhubung){' '}
                    <span style={{ color: 'var(--error)', fontWeight: 600 }}>*</span>
                  </label>
                  <select
                    className="input"
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    disabled={running}
                  >
                    <option value="">— Pilih akun Business/Creator —</option>
                    {platformAccounts.map((a) => (
                      <option key={a._id} value={a._id}>
                        {a.label || a.platformUsername}
                      </option>
                    ))}
                  </select>
                  <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                    Akun di atas = <b>akun Anda</b> (untuk akses API). Kotak bawah = <b>username orang lain</b> yang mau di-scrape (bisa beda dari akun Anda).
                  </p>
                </div>
              )}

              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={profileOnly}
                    onChange={(e) => setProfileOnly(e.target.checked)}
                    disabled={running}
                  />
                  <span>
                    Hanya link profil{' '}
                    <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>
                      (tanpa link postingan)
                    </span>
                  </span>
                </label>
                <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                  Username saja per baris (bukan URL posting). Contoh: <code>riskasiskasari</code>
                </p>
              </div>

              <div className="form-group">
                <label>
                  Daftar Username Target{' '}
                  <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>
                    (satu per baris, @ opsional)
                  </span>
                </label>
                <textarea
                  className="input"
                  rows={10}
                  placeholder={'Contoh — ganti dengan username asli:\nabrorsoeka\nriskasiskasari\nachlisyog'}
                  value={usernamesText}
                  onChange={(e) => setUsernamesText(e.target.value)}
                  disabled={running}
                  style={{ resize: 'vertical', fontFamily: 'inherit' }}
                />
                <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{usernameCount} username</span>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: 11, padding: '4px 10px' }}
                    onClick={() => fileRef.current?.click()}
                    disabled={running}
                  >
                    <Upload size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Dari File TXT
                  </button>
                  <input ref={fileRef} type="file" accept=".txt,.csv" hidden onChange={loadTxtFile} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ flex: 1 }}
                  onClick={runScraper}
                  disabled={running}
                >
                  {running ? (
                    <>
                      <Loader2 size={14} className="spin" style={{ marginRight: 6 }} />
                      Sedang berjalan...
                    </>
                  ) : (
                    '🚀 Mulai Scraping'
                  )}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  title="Bersihkan log"
                  onClick={() => setLogs([])}
                  disabled={running}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            <div className="card">
              <div className="card-title" style={{ fontSize: 12 }}>📖 Cara Penggunaan</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <div>1️⃣ Hubungkan akun IG Business/Creator di <b>Akun &amp; User</b></div>
                <div>2️⃣ Pilih akun tersebut di dropdown, isi username target</div>
                <div>3️⃣ <b>Mulai Scraping</b> → link postingan terbaru (`/p/` atau `/reel/`)</div>
                <div>4️⃣ <b>Export CSV</b></div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <div className="card-title" style={{ justifyContent: 'space-between' }}>
                <span>📋 Live Log</span>
                {summary && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>
                    ✅ {summary.success}/{summary.total} berhasil, {summary.failed} gagal
                  </span>
                )}
              </div>
              <div
                className="log-box"
                style={{
                  height: 220,
                  overflowY: 'auto',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  background: 'var(--bg-secondary)',
                  borderRadius: 8,
                  padding: 10,
                }}
              >
                {!logs.length ? (
                  <div style={{ color: 'var(--text-muted)' }}>Menunggu...</div>
                ) : (
                  logs.map((log, i) => (
                    <div
                      key={i}
                      style={{
                        marginBottom: 4,
                        color:
                          log.type === 'error'
                            ? 'var(--error)'
                            : log.type === 'success'
                              ? 'var(--success)'
                              : log.type === 'warn'
                                ? 'var(--warning)'
                                : 'var(--text-secondary)',
                      }}
                    >
                      [{log.time}] {log.message}
                    </div>
                  ))
                )}
              </div>
            </div>

            {results.length > 0 && (
              <div className="card">
                <div className="card-title" style={{ justifyContent: 'space-between' }}>
                  <span>📊 Hasil Scraping {cfg.label}</span>
                  <button type="button" className="btn-primary" style={{ fontSize: 11, padding: '5px 12px' }} onClick={exportCsv}>
                    <Download size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                    Export CSV
                  </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)' }}>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>#</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Username</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Link Profil / Postingan</th>
                        <th style={{ padding: '8px 10px', textAlign: 'left' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => {
                        const badge = STATUS_BADGE[r.status] || { label: r.status, cls: 'badge-neutral' };
                        return (
                          <tr key={r.username + i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '7px 10px', color: 'var(--text-muted)' }}>{i + 1}</td>
                            <td style={{ padding: '7px 10px', fontWeight: 600 }}>@{r.username}</td>
                            <td
                              style={{
                                padding: '7px 10px',
                                maxWidth: 280,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {isClickable(r) ? (
                                <a
                                  href={r.latest_post}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ color: 'var(--accent)', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                >
                                  {r.latest_post}
                                  <ExternalLink size={11} />
                                </a>
                              ) : (
                                <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>{r.latest_post}</span>
                              )}
                            </td>
                            <td style={{ padding: '7px 10px' }}>
                              <span className={`badge ${badge.cls}`}>{badge.label}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
