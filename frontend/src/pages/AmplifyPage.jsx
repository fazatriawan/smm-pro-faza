import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { amplifyAPI, accountsAPI } from '../api';
import { PLATFORMS } from '../utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const PLATFORM_ACTIONS = {
  facebook: [
    { key: 'like', icon: '♥', label: 'Like', color: '#D4537E' },
    { key: 'comment', icon: '◎', label: 'Komentar', color: '#378ADD' },
    { key: 'share', icon: '↗', label: 'Share', color: '#1D9E75' },
    { key: 'save', icon: '◈', label: 'Save', color: '#7F77DD' },
  ],
  facebook_personal: [
    { key: 'like', icon: '♥', label: 'Like', color: '#D4537E' },
    { key: 'comment', icon: '◎', label: 'Komentar', color: '#378ADD' },
    { key: 'share', icon: '↗', label: 'Share', color: '#1D9E75' },
    { key: 'save', icon: '◈', label: 'Save', color: '#7F77DD' },
  ],
  youtube: [
    { key: 'like', icon: '👍', label: 'Like', color: '#FF0000' },
    { key: 'dislike', icon: '👎', label: 'Dislike', color: '#E24B4A' },
    { key: 'comment', icon: '◎', label: 'Komentar', color: '#378ADD' },
    { key: 'subscribe', icon: '🔔', label: 'Subscribe', color: '#FF0000' },
    { key: 'save', icon: '◈', label: 'Save to Playlist', color: '#7F77DD' },
  ],
  instagram: [
    { key: 'like', icon: '♥', label: 'Like', color: '#D4537E' },
    { key: 'comment', icon: '◎', label: 'Komentar', color: '#378ADD' },
    { key: 'save', icon: '◈', label: 'Save', color: '#7F77DD' },
    { key: 'follow', icon: '◉', label: 'Follow', color: '#1D9E75' },
  ],
  twitter: [
    { key: 'like', icon: '♥', label: 'Like', color: '#D4537E' },
    { key: 'comment', icon: '◎', label: 'Reply', color: '#378ADD' },
    { key: 'share', icon: '↻', label: 'Retweet', color: '#1D9E75' },
    { key: 'bookmark', icon: '◈', label: 'Bookmark', color: '#7F77DD' },
    { key: 'follow', icon: '◉', label: 'Follow', color: '#1D9E75' },
  ],
  tiktok: [
    { key: 'like', icon: '♥', label: 'Like', color: '#D4537E' },
    { key: 'comment', icon: '◎', label: 'Komentar', color: '#378ADD' },
    { key: 'share', icon: '↗', label: 'Share', color: '#1D9E75' },
    { key: 'repost', icon: '↻', label: 'Repost', color: '#639922' },
    { key: 'save', icon: '◈', label: 'Favorit', color: '#7F77DD' },
    { key: 'follow', icon: '◉', label: 'Follow', color: '#1D9E75' },
  ],
};

const PLATFORM_TABS = [
  { key: 'facebook', label: 'Facebook', icon: 'FB', color: '#1877F2', bg: '#E6F1FB' },
  { key: 'instagram', label: 'Instagram', icon: 'IG', color: '#D4537E', bg: '#FBEAF0' },
  { key: 'youtube', label: 'YouTube', icon: 'YT', color: '#FF0000', bg: '#FAECE7' },
  { key: 'twitter', label: 'X/Twitter', icon: 'X', color: '#888780', bg: '#F1EFE8' },
  { key: 'tiktok', label: 'TikTok', icon: 'TT', color: '#639922', bg: '#EAF3DE' },
];

const URL_PLACEHOLDERS = {
  facebook: 'https://www.facebook.com/permalink.php?story_fbid=...&id=...',
  instagram: 'https://www.instagram.com/p/...',
  youtube: 'https://www.youtube.com/watch?v=...',
  twitter: 'https://twitter.com/user/status/...',
  tiktok: 'https://www.tiktok.com/@user/video/...',
};

export default function AmplifyPage() {
  const qc = useQueryClient();
  const [activePlatform, setActivePlatform] = useState('facebook');
  const [urls, setUrls] = useState(['']);
  const [selectedActions, setSelectedActions] = useState({});
  const [comments, setComments] = useState(['']);
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set());
  const [selectAll, setSelectAll] = useState(true);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [stoppingJob, setStoppingJob] = useState(null);
  const [activeTab, setActiveTab] = useState('create');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const { data: jobs = [], refetch } = useQuery({
    queryKey: ['amplify-jobs'],
    queryFn: () => amplifyAPI.getAll().then(r => r.data),
    refetchInterval: 5000
  });

  const stopJob = async (jobId) => {
    try {
      setStoppingJob(jobId);
      await amplifyAPI.stop(jobId);
      toast.success('Job berhasil dihentikan!');
      refetch();
    } catch (err) {
      toast.error('Gagal menghentikan job');
    } finally {
      setStoppingJob(null);
    }
  };

  const createJob = useMutation({
    mutationFn: (data) => amplifyAPI.create(data),
    onSuccess: () => {
      toast.success('Amplifikasi dimulai!');
      setActiveTab('history');
      qc.invalidateQueries({ queryKey: ['amplify-jobs'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Gagal')
  });

  const platformAccounts = accounts.filter(a => {
    if (activePlatform === 'facebook') return a.platform === 'facebook' || a.platform === 'facebook_personal';
    if (activePlatform === 'instagram') return a.platform === 'instagram';
    return a.platform === activePlatform;
  });

  const currentActions = PLATFORM_ACTIONS[activePlatform] || [];

  const toggleAction = (key) => {
    setSelectedActions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handlePlatformChange = (platform) => {
    setActivePlatform(platform);
    setSelectedActions({});
    setUrls(['']);
    setComments(['']);
    setSelectedAccountIds(new Set());
    setSelectAll(true);
    setShowAccountDropdown(false);
  };

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
      setSelectedAccountIds(new Set(platformAccounts.map(a => a._id)));
      setSelectAll(true);
    }
  };

  const getSelectedCount = () => {
    if (selectAll) return platformAccounts.length;
    return [...selectedAccountIds].filter(id => platformAccounts.find(a => a._id === id)).length;
  };

  const getTargetAccountIds = () => {
    if (selectAll) return platformAccounts.map(a => a._id);
    return [...selectedAccountIds].filter(id => platformAccounts.find(a => a._id === id));
  };

  const handleSubmit = () => {
    const validUrls = urls.filter(u => u.trim());
    if (!validUrls.length) return toast.error('Masukkan minimal 1 URL target');
    if (!Object.values(selectedActions).some(v => v)) return toast.error('Pilih minimal 1 aksi');
    if (selectedActions.comment && comments.filter(c => c.trim()).length === 0) {
      return toast.error('Isi minimal 1 template komentar');
    }

    const actions = Object.entries(selectedActions)
      .filter(([_, enabled]) => enabled)
      .map(([type]) => ({
        type,
        enabled: true,
        commentTemplates: type === 'comment' ? comments.filter(c => c.trim()) : []
      }));

    const accountIds = getTargetAccountIds();
    if (!accountIds.length) return toast.error('Pilih minimal 1 akun');

    createJob.mutate({
      targetUrls: validUrls,
      targetUrl: validUrls[0],
      platform: activePlatform,
      actions,
      accountIds
    });
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'completed': return '#1D9E75';
      case 'running': return '#378ADD';
      case 'failed': return '#E24B4A';
      default: return '#EF9F27';
    }
  };

  const getStatusLabel = (status) => {
    switch(status) {
      case 'completed': return '✓ Selesai';
      case 'running': return '⟳ Berjalan';
      case 'failed': return '✗ Gagal';
      default: return '◷ Menunggu';
    }
  };

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Amplifikasi Konten</span>
        <div className="page-actions">
          <button className={`tab ${activeTab==='create'?'active':''}`} onClick={() => setActiveTab('create')}>Buat Job</button>
          <button className={`tab ${activeTab==='history'?'active':''}`} onClick={() => { setActiveTab('history'); refetch(); }}>Riwayat</button>
        </div>
      </div>

      <div className="page-content">
        {activeTab === 'create' ? (
          <>
            {/* Platform Tabs */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {PLATFORM_TABS.map(p => {
                const count = accounts.filter(a =>
                  p.key === 'facebook'
                    ? a.platform === 'facebook' || a.platform === 'facebook_personal'
                    : a.platform === p.key
                ).length;
                return (
                  <div
                    key={p.key}
                    onClick={() => handlePlatformChange(p.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 16px', borderRadius: 10, cursor: 'pointer',
                      border: `1.5px solid ${activePlatform === p.key ? p.color : 'transparent'}`,
                      background: activePlatform === p.key ? p.bg : '#f5f4f2',
                      transition: 'all 0.12s'
                    }}
                  >
                    <span style={{
                      fontSize: 11, fontWeight: 700,
                      color: activePlatform === p.key ? p.color : '#888'
                    }}>{p.icon}</span>
                    <span style={{
                      fontSize: 13, fontWeight: activePlatform === p.key ? 500 : 400,
                      color: activePlatform === p.key ? p.color : '#666'
                    }}>{p.label}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: activePlatform === p.key ? p.color : '#ddd',
                      color: '#fff', fontWeight: 600
                    }}>{count}</span>
                  </div>
                );
              })}
            </div>

            <div className="two-col" style={{ alignItems: 'start' }}>
              <div>
                {/* URL Multi */}
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <div className="card-title" style={{ margin: 0 }}>URL Target {PLATFORM_TABS.find(p => p.key === activePlatform)?.label}</div>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 12 }}
                      onClick={() => {
                        if (urls.length < 10) setUrls([...urls, '']);
                        else toast.error('Maksimal 10 URL');
                      }}
                    >+ Tambah URL</button>
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                    Semua akun akan mengamplifikasi semua URL yang dimasukkan
                  </div>
                  {urls.map((u, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                      <div style={{
                        width: 22, height: 22, borderRadius: '50%',
                        background: '#EEEDFE', color: '#534AB7',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 600, flexShrink: 0
                      }}>{i+1}</div>
                      <input
                        type="url"
                        placeholder={URL_PLACEHOLDERS[activePlatform]}
                        value={u}
                        onChange={e => {
                          const updated = [...urls];
                          updated[i] = e.target.value;
                          setUrls(updated);
                        }}
                        style={{ flex: 1 }}
                      />
                      {urls.length > 1 && (
                        <button
                          onClick={() => setUrls(urls.filter((_, idx) => idx !== i))}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E24B4A', fontSize: 18 }}
                        >×</button>
                      )}
                    </div>
                  ))}
                  {platformAccounts.length === 0 && (
                    <div style={{ marginTop: 8, padding: '8px 12px', background: '#FCEBEB', borderRadius: 8, fontSize: 12, color: '#A32D2D' }}>
                      ⚠ Belum ada akun {PLATFORM_TABS.find(p => p.key === activePlatform)?.label} terhubung.
                    </div>
                  )}
                </div>

                {/* Aksi */}
                <div className="card">
                  <div className="card-title">Pilih Aksi</div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${currentActions.length}, 1fr)`, gap: 8 }}>
                    {currentActions.map(a => (
                      <div
                        key={a.key}
                        onClick={() => toggleAction(a.key)}
                        style={{
                          textAlign: 'center', padding: '12px 8px', borderRadius: 10,
                          cursor: 'pointer',
                          border: `1.5px solid ${selectedActions[a.key] ? a.color : 'transparent'}`,
                          background: selectedActions[a.key] ? `${a.color}15` : '#f5f4f2',
                          transition: 'all 0.12s'
                        }}
                      >
                        <div style={{ fontSize: 20 }}>{a.icon}</div>
                        <div style={{
                          fontSize: 11, marginTop: 4, fontWeight: 500,
                          color: selectedActions[a.key] ? a.color : '#666'
                        }}>{a.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Template Komentar */}
                {selectedActions.comment && (
                  <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div className="card-title" style={{ margin: 0 }}>Template Komentar</div>
                      <button className="btn-secondary" style={{ fontSize: 12 }}
                        onClick={() => setComments([...comments, ''])}>+ Tambah</button>
                    </div>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                      Setiap akun akan menggunakan komentar berbeda secara bergantian
                    </div>
                    {comments.map((c, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%',
                          background: '#EEEDFE', color: '#534AB7',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 600, flexShrink: 0
                        }}>{i+1}</div>
                        <input
                          type="text"
                          placeholder={`Variasi komentar ${i+1}...`}
                          value={c}
                          onChange={e => {
                            const updated = [...comments];
                            updated[i] = e.target.value;
                            setComments(updated);
                          }}
                          style={{ flex: 1 }}
                        />
                        {comments.length > 1 && (
                          <button onClick={() => setComments(comments.filter((_, idx) => idx !== i))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E24B4A', fontSize: 18 }}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Pilih Akun dengan Ceklis */}
                <div className="card">
                  <div className="card-title">Akun yang Digunakan</div>
                  <div style={{ position: 'relative' }}>
                    <div
                      onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                      style={{
                        padding: '10px 14px', border: '1px solid rgba(0,0,0,0.12)',
                        borderRadius: 8, cursor: 'pointer', display: 'flex',
                        justifyContent: 'space-between', alignItems: 'center',
                        background: '#fff', fontSize: 13
                      }}
                    >
                      <span>
                        {getSelectedCount() === 0
                          ? 'Pilih akun...'
                          : `${getSelectedCount()} akun dipilih`}
                      </span>
                      <span style={{ color: '#888' }}>{showAccountDropdown ? '▲' : '▼'}</span>
                    </div>

                    {showAccountDropdown && (
                      <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0,
                        background: '#fff', border: '1px solid rgba(0,0,0,0.12)',
                        borderRadius: 8, zIndex: 100, maxHeight: 250,
                        overflowY: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
                        marginTop: 4
                      }}>
                        {/* Select All */}
                        <div
                          onClick={toggleSelectAll}
                          style={{
                            padding: '10px 14px', display: 'flex', alignItems: 'center',
                            gap: 10, cursor: 'pointer',
                            borderBottom: '1px solid rgba(0,0,0,0.06)',
                            background: selectAll ? '#EEEDFE' : '#f9f9f9'
                          }}
                        >
                          <div style={{
                            width: 16, height: 16, borderRadius: 4,
                            border: `1.5px solid ${selectAll ? '#7F77DD' : '#ccc'}`,
                            background: selectAll ? '#7F77DD' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            {selectAll && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 13, fontWeight: 600, color: selectAll ? '#534AB7' : '#333' }}>
                            Semua Akun ({platformAccounts.length})
                          </span>
                        </div>

                        {/* List Akun */}
                        {platformAccounts.map(a => {
                          const isChecked = selectAll || selectedAccountIds.has(a._id);
                          const platformColor = PLATFORM_TABS.find(p => p.key === activePlatform)?.color || '#888';
                          return (
                            <div
                              key={a._id}
                              onClick={() => toggleAccount(a._id)}
                              style={{
                                padding: '8px 14px', display: 'flex',
                                alignItems: 'center', gap: 10, cursor: 'pointer',
                                background: isChecked ? `${platformColor}08` : '#fff',
                                borderBottom: '0.5px solid rgba(0,0,0,0.04)'
                              }}
                            >
                              <div style={{
                                width: 16, height: 16, borderRadius: 4,
                                border: `1.5px solid ${isChecked ? platformColor : '#ccc'}`,
                                background: isChecked ? platformColor : '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0
                              }}>
                                {isChecked && <span style={{ color: '#fff', fontSize: 10 }}>✓</span>}
                              </div>
                              <span style={{ fontSize: 12, flex: 1 }}>{a.label}</span>
                            </div>
                          );
                        })}

                        {platformAccounts.length === 0 && (
                          <div style={{ padding: 16, textAlign: 'center', fontSize: 12, color: '#aaa' }}>
                            Tidak ada akun terhubung untuk platform ini
                          </div>
                        )}

                        <div
                          onClick={() => setShowAccountDropdown(false)}
                          style={{
                            padding: '10px 14px', textAlign: 'center',
                            fontSize: 12, color: '#7F77DD', cursor: 'pointer',
                            borderTop: '1px solid rgba(0,0,0,0.06)', fontWeight: 500
                          }}
                        >
                          Selesai Pilih ✓
                        </div>
                      </div>
                    )}
                  </div>

                  {getSelectedCount() > 0 && (
                    <div style={{ marginTop: 8, fontSize: 12, color: '#1D9E75' }}>
                      ✓ {getSelectedCount()} akun akan menjalankan amplifikasi
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                    ⚡ Jeda 30-60 detik antar akun untuk keamanan
                  </div>
                </div>

                <button
                  className="btn-primary"
                  style={{ width: '100%', padding: 12, fontSize: 14 }}
                  onClick={handleSubmit}
                  disabled={createJob.isPending || platformAccounts.length === 0}
                >
                  {createJob.isPending ? '⟳ Memulai...' : '↑ Jalankan Amplifikasi'}
                </button>
              </div>

              {/* Preview */}
              <div>
                <div className="card">
                  <div className="card-title">Preview</div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Platform:</div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {PLATFORM_TABS.find(p => p.key === activePlatform)?.label}
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>URL Target ({urls.filter(u=>u.trim()).length}):</div>
                    {urls.filter(u => u.trim()).map((u, i) => (
                      <div key={i} style={{ fontSize: 12, color: '#185FA5', wordBreak: 'break-all', marginBottom: 2 }}>
                        {i+1}. {u.slice(0, 50)}{u.length > 50 ? '...' : ''}
                      </div>
                    ))}
                    {urls.filter(u=>u.trim()).length === 0 && <span style={{ color: '#aaa', fontSize: 12 }}>—</span>}
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Aksi:</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {currentActions.filter(a => selectedActions[a.key]).map(a => (
                        <span key={a.key} style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 20,
                          background: `${a.color}15`, color: a.color, fontWeight: 500
                        }}>{a.icon} {a.label}</span>
                      ))}
                      {!Object.values(selectedActions).some(v => v) && (
                        <span style={{ fontSize: 12, color: '#aaa' }}>Belum ada aksi dipilih</span>
                      )}
                    </div>
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Akun:</div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>
                      {getSelectedCount()} akun dipilih
                    </div>
                  </div>
                  {selectedActions.comment && comments.filter(c => c.trim()).length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Variasi komentar:</div>
                      {comments.filter(c => c.trim()).map((c, i) => (
                        <div key={i} style={{
                          fontSize: 12, padding: '4px 8px',
                          background: '#f5f4f2', borderRadius: 6, marginBottom: 4
                        }}>{i+1}. {c}</div>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 12, padding: '8px 12px', background: '#FAEEDA', borderRadius: 8, fontSize: 12, color: '#633806' }}>
                    ⚠ Amplifikasi menggunakan API resmi. Jeda otomatis antar aksi diterapkan untuk keamanan akun.
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="card-title" style={{ margin: 0 }}>Riwayat Amplifikasi</div>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => refetch()}>↻ Refresh</button>
            </div>
            {jobs.length === 0 ? (
              <div className="empty-state">Belum ada job amplifikasi</div>
            ) : jobs.map(job => (
              <div key={job._id} style={{ padding: '12px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#185FA5', wordBreak: 'break-all', marginBottom: 2 }}>
                      {job.targetUrl}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>
                      {dayjs(job.createdAt).format('DD/MM HH:mm')} · {job.platform} · {job.actions?.map(a => a.type).join(', ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 500,
                      background: `${getStatusColor(job.status)}20`,
                      color: getStatusColor(job.status)
                    }}>
                      {getStatusLabel(job.status)}
                    </span>
                    {job.status === 'running' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); stopJob(job._id); }}
                        disabled={stoppingJob === job._id}
                        style={{
                          fontSize: 11, padding: '3px 10px', borderRadius: 20,
                          background: '#FCEBEB', color: '#E24B4A',
                          border: '1px solid #E24B4A', cursor: 'pointer', fontWeight: 500
                        }}
                      >
                        {stoppingJob === job._id ? '...' : '⏹ Stop'}
                      </button>
                    )}
                  </div>
                </div>
                {job.results && job.results.length > 0 && (
                  <div style={{ background: '#f9f9f9', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                      ✓ {job.results.filter(r => r.success).length} berhasil · ✗ {job.results.filter(r => !r.success).length} gagal
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {job.results.map((r, i) => (
                        <span key={i} style={{
                          fontSize: 10, padding: '2px 6px', borderRadius: 10,
                          background: r.success ? '#EAF3DE' : '#FCEBEB',
                          color: r.success ? '#3B6D11' : '#A32D2D'
                        }}>
                          {r.success ? '✓' : '✗'} {r.action}
                          {r.error && ` - ${r.error.slice(0, 30)}`}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
