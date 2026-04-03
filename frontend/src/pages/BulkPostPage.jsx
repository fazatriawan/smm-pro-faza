import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { postsAPI, accountsAPI } from '../api';
import { PLATFORMS, PlatformPill, StatusBadge } from '../utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const PLATFORM_KEYS = Object.keys(PLATFORMS);

export default function BulkPostPage() {
  const qc = useQueryClient();
  const [caption, setCaption] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState(new Set(['facebook']));
  const [scheduleType, setScheduleType] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('compose');
  const [expandedPost, setExpandedPost] = useState(null);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'], queryFn: () => accountsAPI.getAll().then(r => r.data)
  });
  const { data: postsData, refetch } = useQuery({
    queryKey: ['posts-all'], queryFn: () => postsAPI.getAll({ limit: 30 }).then(r => r.data),
    refetchInterval: 5000
  });

  const createPost = useMutation({
    mutationFn: (fd) => postsAPI.create(fd),
    onSuccess: () => {
      toast.success('Post berhasil dibuat!');
      setCaption(''); setMediaFiles([]);
      setActiveTab('history');
      qc.invalidateQueries({ queryKey: ['posts-all'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Gagal membuat post'),
  });

  const togglePlatform = (p) => setSelectedPlatforms(prev => {
    const s = new Set(prev);
    s.has(p) ? s.delete(p) : s.add(p);
    return s;
  });

  const handleSubmit = () => {
    if (!caption.trim()) return toast.error('Caption tidak boleh kosong');
    const targetAccounts = accounts
      .filter(a => selectedPlatforms.has(a.platform))
      .map(a => a._id);
    if (!targetAccounts.length) return toast.error('Tidak ada akun yang cocok');

    const fd = new FormData();
    fd.append('caption', caption);
    fd.append('accountIds', JSON.stringify(targetAccounts));
    fd.append('isImmediate', scheduleType === 'now');
    if (scheduleType !== 'now' && scheduledAt) fd.append('scheduledAt', scheduledAt);
    mediaFiles.forEach(f => fd.append('media', f));
    createPost.mutate(fd);
  };

  const getPostLink = (platformPostId, platform) => {
    if (!platformPostId) return null;
    switch (platform) {
      case 'facebook': return `https://facebook.com/${platformPostId}`;
      case 'instagram': return `https://instagram.com/p/${platformPostId}`;
      case 'twitter': return `https://twitter.com/i/web/status/${platformPostId}`;
      case 'tiktok': return `https://tiktok.com/@user/video/${platformPostId}`;
      default: return null;
    }
  };

  const getStatusColor = (status) => {
    switch(status) {
      case 'completed': return '#1D9E75';
      case 'partial': return '#EF9F27';
      case 'failed': return '#E24B4A';
      case 'sending': return '#378ADD';
      default: return '#888';
    }
  };

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Bulk Post</span>
        <div className="page-actions">
          <button className={`tab ${activeTab==='compose'?'active':''}`} onClick={() => setActiveTab('compose')}>Buat Post</button>
          <button className={`tab ${activeTab==='history'?'active':''}`} onClick={() => { setActiveTab('history'); refetch(); }}>Riwayat</button>
        </div>
      </div>
      <div className="page-content">
        {activeTab === 'compose' ? (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">Platform Target</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
                  {PLATFORM_KEYS.map(p => (
                    <div key={p} onClick={() => togglePlatform(p)} style={{
                      textAlign: 'center', padding: '10px 6px',
                      borderRadius: 10, cursor: 'pointer',
                      border: `1.5px solid ${selectedPlatforms.has(p) ? PLATFORMS[p].color : 'transparent'}`,
                      background: selectedPlatforms.has(p) ? PLATFORMS[p].bg : '#f5f4f2',
                      transition: 'all 0.12s',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: PLATFORMS[p].text }}>{PLATFORMS[p].short}</div>
                      <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{PLATFORMS[p].label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="card-title">Konten Post</div>
                <textarea
                  placeholder="Tulis caption/konten di sini..."
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  style={{ minHeight: 120, marginBottom: 10 }}
                />
                <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Upload Media (opsional)</div>
                <div
                  style={{ border: '1.5px dashed rgba(0,0,0,0.15)', borderRadius: 10, padding: '20px', textAlign: 'center', cursor: 'pointer', color: '#aaa', fontSize: 13 }}
                  onClick={() => document.getElementById('media-input').click()}
                >
                  {mediaFiles.length > 0 ? `${mediaFiles.length} file dipilih: ${mediaFiles.map(f=>f.name).join(', ')}` : '+ Klik atau drag & drop gambar/video'}
                </div>
                <input id="media-input" type="file" multiple accept="image/*,video/*" style={{ display: 'none' }}
                  onChange={e => setMediaFiles(Array.from(e.target.files))} />
              </div>

              <div className="card">
                <div className="card-title">Waktu Posting</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  {['now', 'schedule'].map(t => (
                    <button key={t} onClick={() => setScheduleType(t)} style={{
                      flex: 1, padding: '8px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                      background: scheduleType === t ? '#EEEDFE' : '#f5f4f2',
                      border: `1.5px solid ${scheduleType === t ? '#7F77DD' : 'transparent'}`,
                      color: scheduleType === t ? '#534AB7' : '#666',
                    }}>
                      {t === 'now' ? 'Kirim Sekarang' : 'Jadwalkan'}
                    </button>
                  ))}
                </div>
                {scheduleType === 'schedule' && (
                  <input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
                )}
                <button className="btn-primary" style={{ width: '100%', marginTop: 12, padding: 10 }}
                  onClick={handleSubmit} disabled={createPost.isPending}>
                  {createPost.isPending ? 'Mengirim...' : scheduleType === 'now' ? '✦ Posting Serentak Sekarang' : '◷ Jadwalkan Post'}
                </button>
              </div>
            </div>

            <div>
              <div className="card">
                <div className="card-title">Preview</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                  Akan diposting ke {[...selectedPlatforms].length} platform · {accounts.filter(a => selectedPlatforms.has(a.platform)).length} akun
                </div>
                {[...selectedPlatforms].map(p => (
                  <div key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                    <PlatformPill platform={p} />
                    <div style={{ flex: 1, fontSize: 12, color: '#555' }}>
                      {caption.slice(0, 80) || <span style={{ color: '#aaa' }}>Tulis caption...</span>}
                      {caption.length > 80 && '...'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div className="card-title" style={{ margin: 0 }}>Riwayat Post Bulk</div>
              <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => refetch()}>↻ Refresh</button>
            </div>
            {(postsData?.posts || []).length === 0 ? (
              <div className="empty-state">Belum ada post</div>
            ) : (postsData?.posts || []).map(p => (
              <div key={p._id}>
                <div
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)', cursor: 'pointer' }}
                  onClick={() => setExpandedPost(expandedPost === p._id ? null : p._id)}
                >
                  <div style={{ fontSize: 12, color: '#888', minWidth: 80, flexShrink: 0 }}>
                    {dayjs(p.createdAt).format('DD/MM HH:mm')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, marginBottom: 4 }}>{p.caption?.slice(0, 60)}{p.caption?.length > 60 ? '...' : ''}</div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                      {[...new Set(p.targetAccounts?.map(ta => ta.account?.platform).filter(Boolean))].map(pl => (
                        <PlatformPill key={pl} platform={pl} size="sm" />
                      ))}
                      <span style={{ fontSize: 11, color: '#aaa' }}>{p.targetAccounts?.length} akun</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 500,
                      background: p.status === 'completed' ? '#EAF3DE' : p.status === 'failed' ? '#FCEBEB' : p.status === 'sending' ? '#E6F1FB' : '#FAEEDA',
                      color: getStatusColor(p.status)
                    }}>
                      {p.status === 'completed' ? '✓ Terkirim' : p.status === 'failed' ? '✗ Gagal' : p.status === 'sending' ? '⟳ Mengirim' : p.status === 'partial' ? '~ Sebagian' : 'Terjadwal'}
                    </span>
                    <span style={{ fontSize: 11, color: '#aaa' }}>{expandedPost === p._id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Detail per akun dengan link */}
                {expandedPost === p._id && (
                  <div style={{ background: '#f9f9f9', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: '#888', marginBottom: 8, fontWeight: 500 }}>Detail per akun:</div>
                    {p.targetAccounts?.map((ta, i) => {
                      const link = getPostLink(ta.platformPostId, ta.account?.platform);
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '0.5px solid rgba(0,0,0,0.05)' }}>
                          <PlatformPill platform={ta.account?.platform} size="sm" />
                          <span style={{ flex: 1, fontSize: 12 }}>{ta.account?.label || ta.account?.platformUsername || '—'}</span>
                          <span style={{
                            fontSize: 11, padding: '2px 6px', borderRadius: 10,
                            background: ta.status === 'sent' ? '#EAF3DE' : ta.status === 'failed' ? '#FCEBEB' : '#f0efec',
                            color: ta.status === 'sent' ? '#3B6D11' : ta.status === 'failed' ? '#A32D2D' : '#888'
                          }}>
                            {ta.status === 'sent' ? '✓ Terkirim' : ta.status === 'failed' ? '✗ Gagal' : '⟳ Pending'}
                          </span>
                          {link && ta.status === 'sent' && (
                            <a href={link} target="_blank" rel="noopener noreferrer" style={{
                              fontSize: 11, padding: '3px 10px', borderRadius: 6,
                              background: '#EEEDFE', color: '#534AB7',
                              textDecoration: 'none', fontWeight: 500
                            }}>
                              Lihat Post ↗
                            </a>
                          )}
                          {ta.error && (
                            <span style={{ fontSize: 10, color: '#E24B4A', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ta.error}>
                              {ta.error.slice(0, 40)}...
                            </span>
                          )}
                        </div>
                      );
                    })}
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
