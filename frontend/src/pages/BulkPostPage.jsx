import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { postsAPI, accountsAPI } from '../api';
import { PLATFORMS, PlatformPill, StatusBadge, Avatar } from '../utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const PLATFORM_KEYS = Object.keys(PLATFORMS);

export default function BulkPostPage() {
  const qc = useQueryClient();
  const [caption, setCaption] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState(new Set(PLATFORM_KEYS));
  const [selectedAccounts, setSelectedAccounts] = useState('all');
  const [scheduleType, setScheduleType] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [activeTab, setActiveTab] = useState('compose');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'], queryFn: () => accountsAPI.getAll().then(r => r.data)
  });
  const { data: postsData } = useQuery({
    queryKey: ['posts-all'], queryFn: () => postsAPI.getAll({ limit: 20 }).then(r => r.data)
  });

  const createPost = useMutation({
    mutationFn: (fd) => postsAPI.create(fd),
    onSuccess: () => {
      toast.success('Post berhasil dibuat!');
      setCaption(''); setMediaFiles([]);
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
    if (!targetAccounts.length) return toast.error('Tidak ada akun yang cocok dengan platform yang dipilih');

    const fd = new FormData();
    fd.append('caption', caption);
    fd.append('accountIds', JSON.stringify(targetAccounts));
    fd.append('isImmediate', scheduleType === 'now');
    if (scheduleType !== 'now' && scheduledAt) fd.append('scheduledAt', scheduledAt);
    mediaFiles.forEach(f => fd.append('media', f));
    createPost.mutate(fd);
  };

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Bulk Post</span>
        <div className="page-actions">
          <button className={`tab ${activeTab==='compose'?'active':''}`} onClick={() => setActiveTab('compose')}>Buat Post</button>
          <button className={`tab ${activeTab==='history'?'active':''}`} onClick={() => setActiveTab('history')}>Riwayat</button>
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
                <div className="card-title">Target Akun</div>
                <select value={selectedAccounts} onChange={e => setSelectedAccounts(e.target.value)}>
                  <option value="all">Semua akun ({accounts.length} akun)</option>
                  <option value="custom">Pilih manual...</option>
                </select>
              </div>

              <div className="card">
                <div className="card-title">Konten Post</div>
                <textarea
                  placeholder="Tulis caption/konten di sini... Konten yang sama akan diposting ke semua platform & akun yang dipilih."
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  style={{ minHeight: 120, marginBottom: 10 }}
                />
                <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>Upload Media (opsional)</div>
                <div
                  style={{ border: '1.5px dashed rgba(0,0,0,0.15)', borderRadius: 10, padding: '20px', textAlign: 'center', cursor: 'pointer', color: '#aaa', fontSize: 13 }}
                  onClick={() => document.getElementById('media-input').click()}
                >
                  {mediaFiles.length > 0 ? `${mediaFiles.length} file dipilih` : '+ Klik atau drag & drop gambar/video'}
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
                      color: scheduleType === t ? '#534AB7' : '#666', fontWeight: scheduleType === t ? 500 : 400,
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
                      {caption.slice(0, 80) || <span style={{ color: '#aaa' }}>Tulis caption terlebih dahulu...</span>}
                      {caption.length > 80 && '...'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-title">Riwayat Post Bulk</div>
            {(postsData?.posts || []).length === 0 ? (
              <div className="empty-state">Belum ada post</div>
            ) : (postsData?.posts || []).map(p => (
              <div key={p._id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 12, color: '#888', minWidth: 80, flexShrink: 0 }}>
                  {dayjs(p.createdAt).format('DD/MM HH:mm')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, marginBottom: 4 }}>{p.caption?.slice(0, 60)}...</div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[...new Set(p.targetAccounts?.map(ta => ta.account?.platform).filter(Boolean))].map(pl => (
                      <PlatformPill key={pl} platform={pl} size="sm" />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{p.targetAccounts?.length} akun</div>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
