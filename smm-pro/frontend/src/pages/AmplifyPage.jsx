import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { amplifyAPI, accountsAPI } from '../api';
import { PLATFORMS, PlatformPill } from '../utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const ACTION_TYPES = [
  { key: 'like', icon: '♥', label: 'Like', color: '#D4537E' },
  { key: 'comment', icon: '◎', label: 'Komentar', color: '#378ADD' },
  { key: 'share', icon: '↗', label: 'Share', color: '#1D9E75' },
];

export default function AmplifyPage() {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [selectedActions, setSelectedActions] = useState({ like: true, comment: false, share: false });
  const [comments, setComments] = useState(['']);
  const [selectedAccounts, setSelectedAccounts] = useState('all');
  const [activeTab, setActiveTab] = useState('create');
  const [runningJob, setRunningJob] = useState(null);
  const [progress, setProgress] = useState([]);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const { data: jobs = [], refetch } = useQuery({
    queryKey: ['amplify-jobs'],
    queryFn: () => amplifyAPI.getAll().then(r => r.data),
    refetchInterval: runningJob ? 3000 : false
  });

  const createJob = useMutation({
    mutationFn: (data) => amplifyAPI.create(data),
    onSuccess: (res) => {
      toast.success('Amplifikasi dimulai!');
      setRunningJob(res.data._id);
      setActiveTab('history');
      qc.invalidateQueries({ queryKey: ['amplify-jobs'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Gagal')
  });

  const fbAccounts = accounts.filter(a => a.platform === 'facebook' || a.platform === 'facebook_personal');

  const handleSubmit = () => {
    if (!url.trim()) return toast.error('Masukkan URL post target');
    if (!url.includes('facebook.com')) return toast.error('URL harus dari Facebook');
    if (!Object.values(selectedActions).some(v => v)) return toast.error('Pilih minimal 1 aksi');

    const actions = Object.entries(selectedActions)
      .filter(([_, enabled]) => enabled)
      .map(([type]) => ({
        type,
        enabled: true,
        commentTemplates: type === 'comment' ? comments.filter(c => c.trim()) : []
      }));

    if (selectedActions.comment && comments.filter(c => c.trim()).length === 0) {
      return toast.error('Isi minimal 1 template komentar');
    }

    const accountIds = selectedAccounts === 'all'
      ? fbAccounts.map(a => a._id)
      : [selectedAccounts];

    createJob.mutate({
      targetUrl: url,
      platform: 'facebook',
      actions,
      accountIds
    });
  };

  const addComment = () => {
    if (comments.length >= 10) return toast.error('Maksimal 10 variasi komentar');
    setComments([...comments, '']);
  };

  const updateComment = (i, val) => {
    const updated = [...comments];
    updated[i] = val;
    setComments(updated);
  };

  const removeComment = (i) => {
    setComments(comments.filter((_, idx) => idx !== i));
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
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              {/* URL Target */}
              <div className="card">
                <div className="card-title">URL Post Target</div>
                <input
                  type="url"
                  placeholder="https://facebook.com/..."
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                {url && url.includes('facebook.com') && (
                  <div style={{ fontSize: 12, color: '#1D9E75' }}>✓ URL Facebook valid</div>
                )}
              </div>

              {/* Pilih Aksi */}
              <div className="card">
                <div className="card-title">Pilih Aksi</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
                  {ACTION_TYPES.map(a => (
                    <div
                      key={a.key}
                      onClick={() => setSelectedActions(prev => ({ ...prev, [a.key]: !prev[a.key] }))}
                      style={{
                        textAlign: 'center', padding: '14px 8px', borderRadius: 10,
                        cursor: 'pointer',
                        border: `1.5px solid ${selectedActions[a.key] ? a.color : 'transparent'}`,
                        background: selectedActions[a.key] ? `${a.color}15` : '#f5f4f2',
                        transition: 'all 0.12s'
                      }}
                    >
                      <div style={{ fontSize: 24, color: selectedActions[a.key] ? a.color : '#aaa' }}>{a.icon}</div>
                      <div style={{ fontSize: 12, marginTop: 4, fontWeight: 500, color: selectedActions[a.key] ? a.color : '#666' }}>{a.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Template Komentar */}
              {selectedActions.comment && (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div className="card-title" style={{ margin: 0 }}>Template Komentar</div>
                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={addComment}>+ Tambah Variasi</button>
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 10 }}>
                    Setiap akun akan menggunakan komentar berbeda secara bergantian
                  </div>
                  {comments.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%',
                        background: '#EEEDFE', color: '#534AB7',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 600, flexShrink: 0, marginTop: 8
                      }}>{i + 1}</div>
                      <input
                        type="text"
                        placeholder={`Variasi komentar ${i + 1}...`}
                        value={c}
                        onChange={e => updateComment(i, e.target.value)}
                        style={{ flex: 1 }}
                      />
                      {comments.length > 1 && (
                        <button
                          onClick={() => removeComment(i)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E24B4A', fontSize: 16, padding: '0 4px' }}
                        >×</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Pilih Akun */}
              <div className="card">
                <div className="card-title">Akun yang Digunakan</div>
                <select value={selectedAccounts} onChange={e => setSelectedAccounts(e.target.value)}>
                  <option value="all">Semua {fbAccounts.length} akun Facebook</option>
                  {fbAccounts.map(a => (
                    <option key={a._id} value={a._id}>{a.label}</option>
                  ))}
                </select>
                <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
                  ⚡ Jeda 30-60 detik antar akun untuk keamanan
                </div>
              </div>

              <button
                className="btn-primary"
                style={{ width: '100%', padding: 12, fontSize: 14 }}
                onClick={handleSubmit}
                disabled={createJob.isPending}
              >
                {createJob.isPending ? '⟳ Memulai...' : '↑ Jalankan Amplifikasi'}
              </button>
            </div>

            {/* Preview */}
            <div>
              <div className="card">
                <div className="card-title">Preview Job</div>
                <div style={{ fontSize: 13, marginBottom: 12 }}>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: '#888', fontSize: 12 }}>Target:</span>
                    <div style={{ fontSize: 12, color: '#185FA5', wordBreak: 'break-all', marginTop: 2 }}>
                      {url || '—'}
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: '#888', fontSize: 12 }}>Aksi:</span>
                    <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                      {ACTION_TYPES.filter(a => selectedActions[a.key]).map(a => (
                        <span key={a.key} style={{
                          fontSize: 11, padding: '2px 8px', borderRadius: 20,
                          background: `${a.color}15`, color: a.color, fontWeight: 500
                        }}>{a.icon} {a.label}</span>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <span style={{ color: '#888', fontSize: 12 }}>Akun:</span>
                    <div style={{ fontSize: 12, fontWeight: 500, marginTop: 2 }}>
                      {selectedAccounts === 'all' ? `${fbAccounts.length} akun Facebook` : '1 akun dipilih'}
                    </div>
                  </div>
                  {selectedActions.comment && comments.filter(c=>c.trim()).length > 0 && (
                    <div>
                      <span style={{ color: '#888', fontSize: 12 }}>Variasi komentar:</span>
                      {comments.filter(c=>c.trim()).map((c, i) => (
                        <div key={i} style={{ fontSize: 12, padding: '4px 8px', background: '#f5f4f2', borderRadius: 6, marginTop: 4 }}>
                          {i+1}. {c}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ background: '#FAEEDA', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#633806' }}>
                  ⚠ Amplifikasi menggunakan API resmi Facebook. Jeda otomatis diterapkan antar aksi untuk keamanan akun.
                </div>
              </div>
            </div>
          </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: '#185FA5', marginBottom: 2, wordBreak: 'break-all' }}>
                      {job.targetUrl}
                    </div>
                    <div style={{ fontSize: 11, color: '#aaa' }}>
                      {dayjs(job.createdAt).format('DD/MM HH:mm')} · {job.actions?.map(a => a.type).join(', ')}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 20, fontWeight: 500,
                    background: `${getStatusColor(job.status)}20`,
                    color: getStatusColor(job.status)
                  }}>
                    {getStatusLabel(job.status)}
                  </span>
                </div>

                {/* Progress per akun */}
                {job.results && job.results.length > 0 && (
                  <div style={{ background: '#f9f9f9', borderRadius: 8, padding: '8px 12px' }}>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>
                      {job.results.filter(r => r.success).length}/{job.results.length} berhasil
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {job.accounts?.map((acc, i) => {
                        const result = job.results?.find(r => r.account === acc._id || r.account === acc);
                        return (
                          <span key={i} style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 10,
                            background: result?.success ? '#EAF3DE' : result ? '#FCEBEB' : '#f0efec',
                            color: result?.success ? '#3B6D11' : result ? '#A32D2D' : '#888'
                          }}>
                            {result?.success ? '✓' : result ? '✗' : '◷'} {acc.label || acc}
                          </span>
                        );
                      })}
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
