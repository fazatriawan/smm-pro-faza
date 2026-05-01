import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Send,
  Calendar,
  Clock,
  Upload,
  RefreshCw,
  Square,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Image as ImageIcon,
  Video,
  Check,
  FileText,
} from 'lucide-react';
import { postsAPI, accountsAPI } from '../api';
import { PLATFORMS, PlatformPill, deduplicateAccounts } from '../utils';
import {
  Button,
  Card,
  Badge,
  Skeleton,
  EmptyState,
  Spinner,
} from '../components/ui';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const PLATFORM_KEYS = ['facebook', 'instagram', 'youtube', 'twitter', 'tiktok', 'threads'];

const STATUS_VARIANTS = {
  completed: { variant: 'success', label: 'Terkirim' },
  partial:   { variant: 'warning', label: 'Sebagian' },
  failed:    { variant: 'error',   label: 'Gagal' },
  sending:   { variant: 'info',    label: 'Mengirim' },
  processing:{ variant: 'info',    label: 'Mengirim' },
  scheduled: { variant: 'default', label: 'Terjadwal' },
};

const TARGET_STATUS_VARIANTS = {
  sent:    { variant: 'success', label: 'Terkirim' },
  failed:  { variant: 'error',   label: 'Gagal' },
  pending: { variant: 'default', label: 'Pending' },
};

export default function BulkPostPage() {
  const qc = useQueryClient();
  const [caption, setCaption] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState(new Set(['facebook']));
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set());
  const [selectAll, setSelectAll] = useState(true);
  const [scheduleType, setScheduleType] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [tiktokPrivacy, setTiktokPrivacy] = useState('SELF');
  const [activeTab, setActiveTab] = useState('compose');
  const [expandedPost, setExpandedPost] = useState(null);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);

  const { data: rawAccounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });
  const accounts = deduplicateAccounts(rawAccounts);

  const { data: postsData, isLoading: postsLoading, refetch } = useQuery({
    queryKey: ['posts-all'],
    queryFn: () => postsAPI.getAll({ limit: 30 }).then(r => r.data),
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

  const togglePlatform = (p) => {
    setSelectedPlatforms(prev => {
      const s = new Set(prev);
      s.has(p) ? s.delete(p) : s.add(p);
      return s;
    });
  };

  const filteredAccounts = accounts.filter(a => selectedPlatforms.has(a.platform));

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
      setSelectedAccountIds(new Set(filteredAccounts.map(a => a._id)));
      setSelectAll(true);
    }
  };

  const getTargetAccounts = () => {
    if (selectAll) return filteredAccounts.map(a => a._id);
    return [...selectedAccountIds].filter(id => filteredAccounts.find(a => a._id === id));
  };

  const getSelectedCount = () => {
    if (selectAll) return filteredAccounts.length;
    return [...selectedAccountIds].filter(id => filteredAccounts.find(a => a._id === id)).length;
  };

  const handleSubmit = () => {
    if (!caption.trim()) return toast.error('Caption tidak boleh kosong');
    const targetAccounts = getTargetAccounts();
    if (!targetAccounts.length) return toast.error('Pilih minimal 1 akun');

    const fd = new FormData();
    fd.append('caption', caption);
    fd.append('accountIds', JSON.stringify(targetAccounts));
    fd.append('isImmediate', scheduleType === 'now');
    if (scheduleType !== 'now' && scheduledAt) fd.append('scheduledAt', scheduledAt);
    if (selectedPlatforms.has('tiktok')) {
      fd.append('platformOverrides', JSON.stringify({ tiktok: { privacyLevel: tiktokPrivacy } }));
    }
    mediaFiles.forEach(f => fd.append('media', f));
    createPost.mutate(fd);
  };

  const retryPost = useMutation({
    mutationFn: (postId) => postsAPI.retry(postId),
    onSuccess: () => {
      toast.success('Retry dimulai!');
      refetch();
    },
    onError: () => toast.error('Gagal retry')
  });

  const stopPost = useMutation({
    mutationFn: (postId) => postsAPI.stop(postId),
    onSuccess: () => {
      toast.success('Post berhasil dihentikan!');
      refetch();
    },
    onError: () => toast.error('Gagal menghentikan post')
  });

  const exportToExcel = async (postId) => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.REACT_APP_API_URL}/export/bulk-post/${postId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Export gagal');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_BulkPost_${new Date().toLocaleDateString('id-ID').replace(/\//g, '-')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Laporan Excel berhasil didownload!');
    } catch (err) {
      toast.error('Gagal export Excel');
    }
  };

  const exportAllToExcel = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${process.env.REACT_APP_API_URL}/export/bulk-post`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Export gagal');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Laporan_BulkPost_Semua_${new Date().toLocaleDateString('id-ID').replace(/\//g, '-')}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Laporan semua post berhasil didownload!');
    } catch (err) {
      toast.error('Gagal export Excel');
    }
  };

  const getPostLink = (platformPostId, platform) => {
    if (!platformPostId) return null;
    const id = String(platformPostId);
    switch (platform) {
      case 'facebook':
        if (id.includes('_')) return `https://www.facebook.com/permalink.php?story_fbid=${id.split('_')[1]}&id=${id.split('_')[0]}`;
        return `https://www.facebook.com/video/${id}`;
      case 'instagram': return `https://www.instagram.com/p/${id}`;
      case 'twitter':   return `https://twitter.com/i/web/status/${id}`;
      case 'youtube':   return `https://www.youtube.com/watch?v=${id}`;
      case 'threads':   return `https://www.threads.net/t/${id}`;
      default: return null;
    }
  };

  const posts = postsData?.posts || [];

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Bulk Post</span>
        <div className="page-actions">
          <button className={`tab ${activeTab === 'compose' ? 'active' : ''}`} onClick={() => setActiveTab('compose')}>
            <FileText size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Buat Post
          </button>
          <button className={`tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => { setActiveTab('history'); refetch(); }}>
            <Clock size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
            Riwayat
          </button>
        </div>
      </div>

      <div className="page-content">
        {activeTab === 'compose' ? (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              {/* Platform Target */}
              <Card header="Platform Target">
                <div className="platform-grid">
                  {PLATFORM_KEYS.map(p => {
                    const isActive = selectedPlatforms.has(p);
                    const platform = PLATFORMS[p];
                    return (
                      <div
                        key={p}
                        onClick={() => togglePlatform(p)}
                        className={`platform-chip ${isActive ? 'active' : ''}`}
                        style={{
                          borderColor: isActive ? platform.color : 'transparent',
                          background: isActive ? platform.bg : 'var(--color-background-subtle)',
                        }}
                      >
                        <div className="platform-chip-short" style={{ color: platform.text }}>
                          {platform.short}
                        </div>
                        <div className="platform-chip-label">{platform.label}</div>
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Target Akun */}
              <Card header="Target Akun">
                {accountsLoading ? (
                  <div className="flex flex-col gap-2">
                    <Skeleton height={40} />
                    <Skeleton height={40} />
                    <Skeleton height={40} />
                  </div>
                ) : (
                  <div className="account-dropdown-wrapper">
                    <div
                      className="account-dropdown-trigger"
                      onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                    >
                      <span className="text-small">
                        {getSelectedCount() === 0
                          ? 'Pilih akun...'
                          : `${getSelectedCount()} akun dipilih`}
                      </span>
                      <span className="text-tertiary">
                        {showAccountDropdown ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </span>
                    </div>

                    {showAccountDropdown && (
                      <div className="account-dropdown-menu">
                        {/* Select All */}
                        <div
                          className={`account-dropdown-item select-all ${selectAll ? 'checked' : ''}`}
                          onClick={toggleSelectAll}
                        >
                          <div className="custom-checkbox" style={{
                            borderColor: selectAll ? 'var(--color-primary)' : 'var(--color-border)',
                            background: selectAll ? 'var(--color-primary)' : 'var(--color-surface)',
                          }}>
                            {selectAll && <Check size={10} color="#fff" />}
                          </div>
                          <span className="text-small" style={{ fontWeight: selectAll ? 600 : 400, color: selectAll ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>
                            Semua Akun ({filteredAccounts.length})
                          </span>
                        </div>

                        {/* Per Platform Group */}
                        {PLATFORM_KEYS.map(platform => {
                          const platformAccounts = filteredAccounts.filter(a => a.platform === platform);
                          if (platformAccounts.length === 0) return null;
                          return (
                            <div key={platform}>
                              <div className="account-dropdown-group">
                                {PLATFORMS[platform]?.label || platform} ({platformAccounts.length})
                              </div>
                              {platformAccounts.map(a => {
                                const isChecked = selectAll || selectedAccountIds.has(a._id);
                                return (
                                  <div
                                    key={a._id}
                                    className={`account-dropdown-item ${isChecked ? 'checked' : ''}`}
                                    onClick={() => toggleAccount(a._id)}
                                    style={{ background: isChecked ? `${PLATFORMS[platform]?.color}08` : 'var(--color-surface)' }}
                                  >
                                    <div className="custom-checkbox" style={{
                                      borderColor: isChecked ? PLATFORMS[platform]?.color : 'var(--color-border)',
                                      background: isChecked ? PLATFORMS[platform]?.color : 'var(--color-surface)',
                                    }}>
                                      {isChecked && <Check size={10} color="#fff" />}
                                    </div>
                                    <PlatformPill platform={platform} size="sm" />
                                    <span className="text-caption" style={{ flex: 1 }}>{a.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}

                        {filteredAccounts.length === 0 && (
                          <div className="empty-state" style={{ padding: '16px' }}>
                            Tidak ada akun untuk platform yang dipilih
                          </div>
                        )}

                        <div className="account-dropdown-footer" onClick={() => setShowAccountDropdown(false)}>
                          Selesai Pilih
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {getSelectedCount() > 0 && (
                  <div className="text-success text-caption mt-2">
                    <span className="inline-icon mr-1"><Check size={12} /></span>
                    {getSelectedCount()} akun akan menerima post ini
                  </div>
                )}
              </Card>

              {/* Konten Post */}
              <Card header="Konten Post">
                <textarea
                  placeholder="Tulis caption/konten di sini..."
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  style={{ minHeight: 120, marginBottom: 10 }}
                />
                <div className="text-caption text-secondary mb-2">Upload Media (opsional)</div>
                <div
                  className="media-dropzone"
                  onClick={() => document.getElementById('media-input').click()}
                >
                  {mediaFiles.length > 0 ? (
                    <span className="text-small">
                      {mediaFiles.length} file: {mediaFiles.map(f => f.name).join(', ')}
                    </span>
                  ) : (
                    <>
                      <Upload size={20} className="text-tertiary mb-1" />
                      <span className="text-caption text-tertiary">Klik atau drag &amp; drop gambar/video</span>
                    </>
                  )}
                </div>
                <input id="media-input" type="file" multiple accept="image/*,video/*"
                  style={{ display: 'none' }}
                  onChange={e => setMediaFiles(Array.from(e.target.files))} />
              </Card>

              {/* TikTok Privacy */}
              {selectedPlatforms.has('tiktok') && (
                <Card header="Pengaturan TikTok">
                  <div className="tiktok-privacy-grid">
                    {[
                      { value: 'SELF', label: 'Pribadi (Private)', desc: 'Hanya kamu yang bisa lihat — works now', icon: <ImageIcon size={16} /> },
                      { value: 'PUBLIC', label: 'Publik (Public)', desc: 'Semua orang bisa lihat — butuh audit TikTok', icon: <Video size={16} /> },
                    ].map(opt => (
                      <div
                        key={opt.value}
                        onClick={() => setTiktokPrivacy(opt.value)}
                        className={`tiktok-privacy-option ${tiktokPrivacy === opt.value ? 'active' : ''}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {opt.icon}
                          <span className="text-small" style={{ fontWeight: 600 }}>{opt.label}</span>
                        </div>
                        <span className="text-caption text-secondary">{opt.desc}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Waktu */}
              <Card header="Waktu Posting">
                <div className="schedule-type-grid">
                  <button
                    className={`schedule-type-btn ${scheduleType === 'now' ? 'active' : ''}`}
                    onClick={() => setScheduleType('now')}
                  >
                    <Send size={14} />
                    Kirim Sekarang
                  </button>
                  <button
                    className={`schedule-type-btn ${scheduleType === 'schedule' ? 'active' : ''}`}
                    onClick={() => setScheduleType('schedule')}
                  >
                    <Calendar size={14} />
                    Jadwalkan
                  </button>
                </div>
                {scheduleType === 'schedule' && (
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={e => setScheduledAt(e.target.value)}
                    className="mt-3"
                  />
                )}
                <Button
                  variant="primary"
                  size="lg"
                  style={{ width: '100%', marginTop: 12 }}
                  onClick={handleSubmit}
                  loading={createPost.isPending}
                  iconLeft={<Send size={16} />}
                >
                  {scheduleType === 'now' ? 'Posting Serentak Sekarang' : 'Jadwalkan Post'}
                </Button>
              </Card>
            </div>

            {/* Preview */}
            <div>
              <Card header="Preview">
                <div className="text-caption text-secondary mb-3">
                  Akan diposting ke {getSelectedCount()} akun
                </div>
                {[...selectedPlatforms].map(p => (
                  <div key={p} className="preview-platform-row">
                    <PlatformPill platform={p} />
                    <span className="text-caption text-secondary" style={{ flex: 1 }}>
                      {caption.slice(0, 80) || <span className="text-tertiary">Tulis caption...</span>}
                      {caption.length > 80 && '...'}
                    </span>
                  </div>
                ))}
                {selectedPlatforms.size === 0 && (
                  <EmptyState
                    icon={<FileText size={32} />}
                    title="Belum ada platform dipilih"
                    description="Pilih minimal satu platform untuk melihat preview"
                  />
                )}
              </Card>
            </div>
          </div>
        ) : (
          <Card
            header="Riwayat Post Bulk"
            headerAction={
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => refetch()} iconLeft={<RefreshCw size={14} />}>
                  Refresh
                </Button>
                <Button variant="ghost" size="sm" onClick={exportAllToExcel} iconLeft={<FileSpreadsheet size={14} />}>
                  Export Semua
                </Button>
              </div>
            }
          >
            {postsLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton height={60} />
                <Skeleton height={60} />
                <Skeleton height={60} />
              </div>
            ) : posts.length === 0 ? (
              <EmptyState
                icon={<FileText size={40} />}
                title="Belum ada post"
                description="Buat post pertama kamu di tab Buat Post"
              />
            ) : (
              posts.map(p => (
                <div key={p._id} className="post-history-item">
                  <div
                    className="post-history-summary"
                    onClick={() => setExpandedPost(expandedPost === p._id ? null : p._id)}
                  >
                    <div className="post-history-meta">
                      {dayjs(p.createdAt).format('DD/MM HH:mm')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-small mb-1">
                        {p.caption?.slice(0, 60)}{p.caption?.length > 60 ? '...' : ''}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {[...new Set(p.targetAccounts?.map(ta => ta.account?.platform).filter(Boolean))].map(pl => (
                          <PlatformPill key={pl} platform={pl} size="sm" />
                        ))}
                        <span className="text-xs text-tertiary">{p.targetAccounts?.length} akun</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={STATUS_VARIANTS[p.status]?.variant || 'default'}
                          size="sm"
                        >
                          {STATUS_VARIANTS[p.status]?.label || p.status}
                        </Badge>
                        {(p.status === 'sending' || p.status === 'processing') && (
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); stopPost.mutate(p._id); }}
                            iconLeft={<Square size={10} />}
                          >
                            Stop
                          </Button>
                        )}
                      </div>
                      <span className="text-tertiary">
                        {expandedPost === p._id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </span>
                    </div>
                  </div>

                  {expandedPost === p._id && (
                    <div className="post-history-detail">
                      <div className="text-caption text-secondary mb-2" style={{ fontWeight: 500 }}>
                        Detail per akun:
                      </div>
                      <div className="flex gap-2 mb-2 justify-end">
                        {(p.status === 'sending' || p.status === 'processing') && (
                          <Button variant="danger" size="sm" onClick={() => stopPost.mutate(p._id)} iconLeft={<Square size={12} />}>
                            Stop
                          </Button>
                        )}
                        {(p.status === 'failed' || p.status === 'partial') && (
                          <Button variant="secondary" size="sm" onClick={() => retryPost.mutate(p._id)} iconLeft={<RotateCcw size={12} />}>
                            Ulangi yang Gagal
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => exportToExcel(p._id)} iconLeft={<FileSpreadsheet size={12} />}>
                          Export Excel
                        </Button>
                      </div>
                      {p.targetAccounts?.map((ta, i) => {
                        const link = getPostLink(ta.platformPostId, ta.account?.platform);
                        const statusCfg = TARGET_STATUS_VARIANTS[ta.status] || TARGET_STATUS_VARIANTS.pending;
                        return (
                          <div key={i} className="target-account-row">
                            <PlatformPill platform={ta.account?.platform} size="sm" />
                            <span className="text-caption" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ta.account?.label || ta.account?.platformUsername || '—'}
                            </span>
                            <Badge variant={statusCfg.variant} size="sm">{statusCfg.label}</Badge>
                            {link && ta.status === 'sent' && (
                              <a href={link} target="_blank" rel="noopener noreferrer" className="btn-secondary" style={{ fontSize: 'var(--font-xs)', padding: '3px 10px', textDecoration: 'none' }}>
                                Lihat Post
                              </a>
                            )}
                            {ta.error && (
                              <span className="text-xs text-error" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ta.error}>
                                {ta.error.slice(0, 50)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
