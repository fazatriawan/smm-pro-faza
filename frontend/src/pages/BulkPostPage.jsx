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
  Search,
  Filter,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Trash2,
  MoreHorizontal,
  Play,
  Link as LinkIcon,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Clock4,
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

  // History state
  const [historyFilter, setHistoryFilter] = useState('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyView, setHistoryView] = useState('list');
  const [selectedPostIds, setSelectedPostIds] = useState(new Set());
  const [historyPage, setHistoryPage] = useState(1);
  const [historyLimit] = useState(20);
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [dateFilter, setDateFilter] = useState('all');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  const { data: rawAccounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });
  const accounts = deduplicateAccounts(rawAccounts);

  const { data: postsData, isLoading: postsLoading, refetch } = useQuery({
    queryKey: ['posts-all', historyPage, historyLimit, historyFilter],
    queryFn: () => postsAPI.getAll({ page: historyPage, limit: historyLimit, status: getStatusFilter(historyFilter) }).then(r => r.data),
    refetchInterval: 5000,
    enabled: activeTab === 'history',
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

  const getStatusFilter = (filter) => {
    switch (filter) {
      case 'queued': return 'scheduled';
      case 'delivered': return undefined; // handled client-side (includes partial)
      case 'error': return undefined; // handled client-side
      case 'pending_review': return undefined; // handled client-side
      case 'unscheduled': return 'draft';
      default: return undefined;
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

  const getMediaThumbnail = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    const base = process.env.REACT_APP_API_URL || '';
    return `${base}/${url.replace(/^\.\//, '')}`;
  };

  const extractHashtags = (caption) => {
    if (!caption) return [];
    const matches = caption.match(/#[\w\u00C0-\u017F]+/g);
    return matches || [];
  };

  const formatPostDate = (date) => {
    if (!date) return '';
    const d = dayjs(date);
    return d.format('MMM DD, YYYY h:mm A');
  };

  const formatShortDate = (date) => {
    if (!date) return '';
    const d = dayjs(date);
    return d.format('MMM DD, YYYY');
  };

  const togglePostSelection = (id) => {
    setSelectedPostIds(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  };

  const toggleSelectAllPosts = () => {
    if (selectedPostIds.size === posts.length && posts.length > 0) {
      setSelectedPostIds(new Set());
    } else {
      setSelectedPostIds(new Set(posts.map(p => p._id)));
    }
  };

  const getStatusCounts = () => {
    const all = postsData?.posts || [];
    // For accurate counts we might need all posts, but let's compute from available data
    return {
      all: postsData?.total || 0,
      queued: all.filter(p => p.status === 'scheduled').length,
      unscheduled: all.filter(p => p.status === 'draft').length,
      error: all.filter(p => p.status === 'failed' || p.status === 'partial').length,
      delivered: all.filter(p => p.status === 'completed' || p.status === 'partial').length,
      pending_review: all.filter(p => p.status === 'sending' || p.status === 'processing').length,
    };
  };

  const statusCounts = getStatusCounts();

  const getPrimaryPlatform = (post) => {
    const platforms = [...new Set(post.targetAccounts?.map(ta => ta.account?.platform).filter(Boolean))];
    return platforms[0] || 'facebook';
  };

  const getPrimaryAccount = (post) => {
    const ta = post.targetAccounts?.[0];
    return ta?.account?.label || ta?.account?.platformUsername || 'Akun';
  };

  // Client-side filtering for search, date, and unsupported API filters
  const filteredPosts = (postsData?.posts || []).filter(p => {
    // Search filter
    if (historySearch) {
      const q = historySearch.toLowerCase();
      const matchCaption = p.caption?.toLowerCase().includes(q);
      const matchHashtags = p.hashtags?.some(h => h.toLowerCase().includes(q));
      if (!matchCaption && !matchHashtags) return false;
    }
    // Date filter
    if (dateFilter !== 'all') {
      const postDate = dayjs(p.scheduledAt || p.createdAt);
      const now = dayjs();
      if (dateFilter === 'today' && !postDate.isSame(now, 'day')) return false;
      if (dateFilter === 'week' && !postDate.isSame(now, 'week')) return false;
      if (dateFilter === 'month' && !postDate.isSame(now, 'month')) return false;
    }
    // Status filter (for tabs not supported by API)
    if (historyFilter === 'error') {
      return p.status === 'failed' || p.status === 'partial';
    }
    if (historyFilter === 'pending_review') {
      return p.status === 'sending' || p.status === 'processing';
    }
    if (historyFilter === 'delivered') {
      return p.status === 'completed' || p.status === 'partial';
    }
    return true;
  });

  const posts = filteredPosts;
  const totalPages = postsData?.pages || 1;
  const totalItems = historyFilter === 'all' && !historySearch && dateFilter === 'all'
    ? (postsData?.total || 0)
    : filteredPosts.length;

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
          <div>
            {/* Status Tabs */}
            <div style={{
              display: 'flex',
              gap: 4,
              borderBottom: '1px solid var(--color-border)',
              marginBottom: 16,
              overflowX: 'auto',
            }}>
              {[
                { key: 'all', label: 'Semua Post' },
                { key: 'queued', label: 'Terjadwal' },
                { key: 'unscheduled', label: 'Draft' },
                { key: 'pending_review', label: 'Sedang Proses' },
                { key: 'error', label: 'Error' },
                { key: 'delivered', label: 'Terkirim' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setHistoryFilter(tab.key); setHistoryPage(1); setSelectedPostIds(new Set()); }}
                  style={{
                    padding: '10px 16px',
                    fontSize: 13,
                    fontWeight: 500,
                    border: 'none',
                    background: 'transparent',
                    color: historyFilter === tab.key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                    borderBottom: historyFilter === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {tab.label}
                  {statusCounts[tab.key] > 0 && (
                    <span style={{
                      marginLeft: 6,
                      background: historyFilter === tab.key ? 'var(--color-primary)' : 'var(--color-surface-alt)',
                      color: historyFilter === tab.key ? '#fff' : 'var(--color-text-secondary)',
                      padding: '1px 6px',
                      borderRadius: 10,
                      fontSize: 11,
                    }}>
                      {statusCounts[tab.key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Toolbar */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              marginBottom: 16,
              flexWrap: 'wrap',
            }}>
              {/* Select All */}
              <div
                onClick={toggleSelectAllPosts}
                style={{
                  width: 18, height: 18,
                  border: '1.5px solid var(--color-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: selectedPostIds.size === posts.length && posts.length > 0 ? 'var(--color-primary)' : 'var(--color-surface)',
                }}
              >
                {selectedPostIds.size === posts.length && posts.length > 0 && <Check size={12} color="#fff" />}
              </div>

              {/* Search */}
              <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 320 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="Cari post..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px 8px 32px',
                    borderRadius: 8,
                    border: '1.5px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    fontSize: 13,
                  }}
                />
              </div>

              {/* Date Filter */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setShowDateDropdown(!showDateDropdown)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1.5px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  <CalendarDays size={14} />
                  {dateFilter === 'all' ? 'Semua Tanggal' : dateFilter === 'today' ? 'Hari Ini' : dateFilter === 'week' ? 'Minggu Ini' : 'Bulan Ini'}
                  <ChevronDown size={12} />
                </button>
                {showDateDropdown && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 10,
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                    marginTop: 4,
                    boxShadow: 'var(--shadow-lg)',
                    minWidth: 160,
                  }}>
                    {[
                      { key: 'all', label: 'Semua Tanggal' },
                      { key: 'today', label: 'Hari Ini' },
                      { key: 'week', label: 'Minggu Ini' },
                      { key: 'month', label: 'Bulan Ini' },
                    ].map(d => (
                      <div
                        key={d.key}
                        onClick={() => { setDateFilter(d.key); setShowDateDropdown(false); }}
                        style={{
                          padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                          background: dateFilter === d.key ? 'var(--color-primary-light)' : 'transparent',
                          color: dateFilter === d.key ? 'var(--color-primary)' : 'var(--color-text-primary)',
                        }}
                      >
                        {d.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* View Toggle */}
              <div style={{
                display: 'flex',
                border: '1.5px solid var(--color-border)',
                borderRadius: 8,
                overflow: 'hidden',
              }}>
                {['list', 'day', 'week', 'month'].map(v => (
                  <button
                    key={v}
                    onClick={() => setHistoryView(v)}
                    style={{
                      padding: '7px 12px',
                      fontSize: 12,
                      fontWeight: 500,
                      border: 'none',
                      background: historyView === v ? 'var(--color-primary)' : 'var(--color-surface)',
                      color: historyView === v ? '#fff' : 'var(--color-text-secondary)',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {v}
                  </button>
                ))}
              </div>

              <div style={{ flex: 1 }} />

              {/* Pagination Info */}
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {(historyPage - 1) * historyLimit + 1} — {Math.min(historyPage * historyLimit, totalItems)} dari {totalItems}
              </span>

              {/* Prev/Next */}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                  disabled={historyPage <= 1}
                  style={{
                    padding: '6px 10px', borderRadius: 6, border: '1.5px solid var(--color-border)',
                    background: 'var(--color-surface)', cursor: historyPage <= 1 ? 'not-allowed' : 'pointer',
                    opacity: historyPage <= 1 ? 0.5 : 1,
                  }}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                  disabled={historyPage >= totalPages}
                  style={{
                    padding: '6px 10px', borderRadius: 6, border: '1.5px solid var(--color-border)',
                    background: 'var(--color-surface)', cursor: historyPage >= totalPages ? 'not-allowed' : 'pointer',
                    opacity: historyPage >= totalPages ? 0.5 : 1,
                  }}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            {/* Post List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {postsLoading ? (
                <>
                  <Skeleton height={100} />
                  <Skeleton height={100} />
                  <Skeleton height={100} />
                </>
              ) : posts.length === 0 ? (
                <EmptyState
                  icon={<FileText size={40} />}
                  title="Belum ada post"
                  description="Buat post pertama kamu di tab Buat Post"
                />
              ) : (
                posts.map(p => {
                  const hashtags = p.hashtags?.length ? p.hashtags : extractHashtags(p.caption);
                  const primaryPlatform = getPrimaryPlatform(p);
                  const primaryAccount = getPrimaryAccount(p);
                  const platformColor = PLATFORMS[primaryPlatform]?.color || '#666';
                  const thumbnail = getMediaThumbnail(p.mediaUrls?.[0]);
                  const isExpanded = expandedPost === p._id;

                  return (
                    <div key={p._id} style={{
                      background: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        display: 'flex',
                        gap: 12,
                        padding: '14px 16px',
                        cursor: 'pointer',
                      }}
                        onClick={() => setExpandedPost(isExpanded ? null : p._id)}
                      >
                        {/* Checkbox */}
                        <div
                          onClick={e => { e.stopPropagation(); togglePostSelection(p._id); }}
                          style={{
                            width: 18, height: 18, minWidth: 18,
                            border: '1.5px solid var(--color-border)',
                            borderRadius: 4,
                            cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: selectedPostIds.has(p._id) ? 'var(--color-primary)' : 'var(--color-surface)',
                            marginTop: 2,
                          }}
                        >
                          {selectedPostIds.has(p._id) && <Check size={12} color="#fff" />}
                        </div>

                        {/* Thumbnail */}
                        <div style={{ width: 80, height: 80, minWidth: 80, borderRadius: 8, overflow: 'hidden', background: 'var(--color-surface-alt)', position: 'relative' }}>
                          {thumbnail ? (
                            <img src={thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-tertiary)' }}>
                              <FileText size={24} />
                            </div>
                          )}
                          {p.mediaType === 'video' && (
                            <div style={{ position: 'absolute', top: 4, left: 4, background: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: '2px 4px' }}>
                              <Play size={10} color="#fff" />
                            </div>
                          )}
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--color-text-primary)', marginBottom: 6 }}>
                            {p.caption?.slice(0, 120)}{p.caption?.length > 120 ? '...' : ''}
                          </div>
                          {hashtags.length > 0 && (
                            <div style={{ fontSize: 12, color: '#3b82f6', marginBottom: 8, lineHeight: 1.5 }}>
                              {hashtags.slice(0, 6).join(' ')}
                              {hashtags.length > 6 && ' ...'}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                            <Calendar size={12} />
                            {formatPostDate(p.scheduledAt || p.createdAt)}
                          </div>
                        </div>

                        {/* Right Side: Platform & Account */}
                        <div style={{ minWidth: 160, textAlign: 'right' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginBottom: 6 }}>
                            <div style={{
                              width: 22, height: 22, borderRadius: '50%',
                              background: platformColor,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              color: '#fff', fontSize: 10, fontWeight: 700,
                            }}>
                              {PLATFORMS[primaryPlatform]?.short || '?'}
                            </div>
                            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                              {primaryAccount}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                            {p.scheduledAt ? `Web On ${formatShortDate(p.scheduledAt)}` : 'Segera'}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                            by {primaryAccount}
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <Badge
                              variant={STATUS_VARIANTS[p.status]?.variant || 'default'}
                              size="sm"
                            >
                              {STATUS_VARIANTS[p.status]?.label || p.status}
                            </Badge>
                          </div>
                        </div>
                      </div>

                      {/* Expanded Detail */}
                      {isExpanded && (
                        <div style={{
                          borderTop: '1px solid var(--color-border)',
                          padding: '12px 16px',
                          background: 'var(--color-background-subtle)',
                        }}>
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
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
