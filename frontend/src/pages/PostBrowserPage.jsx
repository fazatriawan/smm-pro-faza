import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountsAPI, postBrowserAPI } from '../api';
import {
  Link2, Copy, Check, ExternalLink, Image, Video, FileText, Loader2,
  Globe, MessageCircle, Hash, RefreshCw, Search, Filter
} from 'lucide-react';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const SUPPORTED_PLATFORMS = ['instagram', 'facebook', 'facebook_personal', 'youtube', 'threads'];

const PLATFORM_META = {
  instagram:         { label: 'Instagram',  color: '#E1306C', bg: '#FFF0F5' },
  facebook:          { label: 'Facebook',   color: '#1877F2', bg: '#EFF4FF' },
  facebook_personal: { label: 'Facebook',   color: '#1877F2', bg: '#EFF4FF' },
  youtube:           { label: 'YouTube',    color: '#FF0000', bg: '#FFF5F5' },
  threads:           { label: 'Threads',    color: '#000000', bg: '#F5F5F5' },
};

function PlatformIcon({ platform, size = 14 }) {
  if (platform === 'instagram') return <MessageCircle size={size} />;
  if (platform === 'youtube')   return <Video size={size} />;
  if (platform === 'threads')   return <Hash size={size} />;
  return <Globe size={size} />;
}

function TypeIcon({ type }) {
  if (type === 'video')  return <Video size={12} />;
  if (type === 'image')  return <Image size={12} />;
  return <FileText size={12} />;
}

function PostCard({ post, onCopy, copied }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      transition: 'box-shadow 0.15s',
    }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Thumbnail */}
      <div style={{ position: 'relative', background: '#f0f0f0', aspectRatio: '16/9', overflow: 'hidden' }}>
        {post.thumbnail ? (
          <img
            src={post.thumbnail}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => { e.target.style.display = 'none'; }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb' }}>
            <TypeIcon type={post.type} />
          </div>
        )}
        <span style={{
          position: 'absolute', top: 8, left: 8,
          background: 'rgba(0,0,0,0.6)', color: '#fff',
          borderRadius: 6, padding: '2px 8px', fontSize: 11,
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <TypeIcon type={post.type} />
          {post.type}
        </span>
      </div>

      {/* Content */}
      <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <p style={{
          margin: 0, fontSize: 13, color: 'var(--text-primary)',
          lineHeight: 1.5, flex: 1,
          display: '-webkit-box', WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {post.caption || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Tidak ada caption</span>}
        </p>

        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {post.date ? dayjs(post.date).format('D MMM YYYY • HH:mm') : '—'}
        </div>

        {/* URL bar */}
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: 8,
          padding: '6px 10px',
          fontSize: 11,
          color: 'var(--text-muted)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {post.url}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => onCopy(post.url)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
              background: copied ? '#E8F5E9' : 'var(--primary)',
              color: copied ? '#388E3C' : '#fff',
              transition: 'all 0.2s',
            }}
          >
            {copied ? <><Check size={13} /> Tersalin!</> : <><Copy size={13} /> Salin URL</>}
          </button>
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-card)', color: 'var(--text-secondary)', textDecoration: 'none',
            }}
            title="Buka di platform"
          >
            <ExternalLink size={13} />
          </a>
        </div>
      </div>
    </div>
  );
}

export default function PostBrowserPage() {
  const [selectedPlatform, setSelectedPlatform] = useState('instagram');
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [searchQ, setSearchQ] = useState('');

  const { data: accountsData = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data),
  });

  const filteredAccounts = accountsData.filter(a =>
    SUPPORTED_PLATFORMS.includes(a.platform) &&
    (a.platform === selectedPlatform || (selectedPlatform === 'facebook' && a.platform === 'facebook_personal'))
  );

  const { data: postsData, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ['account-posts', selectedAccountId],
    queryFn: () => postBrowserAPI.getPosts(selectedAccountId).then(r => r.data),
    enabled: !!selectedAccountId,
  });

  const posts = (postsData?.posts || []).filter(p =>
    !searchQ || p.caption?.toLowerCase().includes(searchQ.toLowerCase()) || p.url?.includes(searchQ)
  );

  const handleCopy = (url, id) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      toast.success('URL disalin!');
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleCopyAll = () => {
    if (!posts.length) return;
    const urls = posts.map(p => p.url).join('\n');
    navigator.clipboard.writeText(urls).then(() => {
      toast.success(`${posts.length} URL disalin!`);
    });
  };

  const handlePlatformChange = (platform) => {
    setSelectedPlatform(platform);
    setSelectedAccountId('');
    setSearchQ('');
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#7c3aed,#4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Link2 size={18} color="#fff" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>Browser Postingan</h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>Ambil link dari postingan akun yang terhubung</p>
          </div>
        </div>
      </div>

      {/* Platform Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {Object.entries(PLATFORM_META)
          .filter(([key]) => key !== 'facebook_personal')
          .map(([key, meta]) => (
            <button
              key={key}
              onClick={() => handlePlatformChange(key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                background: selectedPlatform === key ? meta.color : 'var(--bg-card)',
                color: selectedPlatform === key ? '#fff' : 'var(--text-secondary)',
                border: selectedPlatform === key ? `2px solid ${meta.color}` : '2px solid var(--border)',
                transition: 'all 0.15s',
              }}
            >
              <PlatformIcon platform={key} size={14} />
              {meta.label}
              {filteredAccounts.filter(a => a.platform === key || (key === 'facebook' && a.platform === 'facebook_personal')).length > 0 && (
                <span style={{
                  background: selectedPlatform === key ? 'rgba(255,255,255,0.25)' : 'var(--bg-secondary)',
                  color: selectedPlatform === key ? '#fff' : 'var(--text-muted)',
                  borderRadius: 20, padding: '1px 7px', fontSize: 11,
                }}>
                  {filteredAccounts.filter(a => a.platform === key || (key === 'facebook' && a.platform === 'facebook_personal')).length}
                </span>
              )}
            </button>
          ))}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Account selector */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '0 0 auto' }}>
          <Filter size={14} color="var(--text-muted)" />
          <select
            value={selectedAccountId}
            onChange={e => setSelectedAccountId(e.target.value)}
            style={{
              padding: '8px 32px 8px 12px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 13, cursor: 'pointer',
              minWidth: 200, appearance: 'none',
            }}
          >
            <option value="">— Pilih akun —</option>
            {filteredAccounts.map(a => (
              <option key={a._id} value={a._id}>{a.label || a.platformUsername}</option>
            ))}
          </select>
        </div>

        {/* Search */}
        {postsData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200 }}>
            <Search size={14} color="var(--text-muted)" />
            <input
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
              placeholder="Cari caption atau URL..."
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                border: '1px solid var(--border)', background: 'var(--bg-card)',
                color: 'var(--text-primary)', fontSize: 13,
              }}
            />
          </div>
        )}

        {/* Actions */}
        {postsData && (
          <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} className={isFetching ? 'spin' : ''} />
              Refresh
            </button>
            <button
              onClick={handleCopyAll}
              disabled={!posts.length}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', borderRadius: 8, border: 'none',
                background: 'var(--primary)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}
            >
              <Copy size={13} />
              Salin Semua URL ({posts.length})
            </button>
          </div>
        )}
      </div>

      {/* Empty state — no account selected */}
      {!selectedAccountId && (
        <div style={{
          textAlign: 'center', padding: '80px 20px',
          background: 'var(--bg-card)', borderRadius: 16, border: '2px dashed var(--border)',
        }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>
            <PlatformIcon platform={selectedPlatform} size={40} />
          </div>
          <h3 style={{ margin: '0 0 8px', color: 'var(--text-primary)' }}>Pilih akun {PLATFORM_META[selectedPlatform]?.label}</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 14 }}>
            {filteredAccounts.length === 0
              ? `Belum ada akun ${PLATFORM_META[selectedPlatform]?.label} yang terhubung`
              : 'Pilih akun di atas untuk melihat postingan'}
          </p>
        </div>
      )}

      {/* Loading */}
      {isLoading && selectedAccountId && (
        <div style={{ textAlign: 'center', padding: '80px 20px' }}>
          <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
          <p style={{ marginTop: 12, color: 'var(--text-muted)' }}>Mengambil postingan...</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: '#FFF5F5', border: '1px solid #FEB2B2', borderRadius: 12,
          padding: '20px 24px', color: '#C53030', fontSize: 14,
        }}>
          <strong>Gagal mengambil postingan:</strong> {error.response?.data?.message || error.message}
        </div>
      )}

      {/* Posts grid */}
      {!isLoading && postsData && (
        <>
          {posts.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
              {searchQ ? 'Tidak ada postingan yang cocok dengan pencarian.' : 'Belum ada postingan di akun ini.'}
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                Menampilkan <strong>{posts.length}</strong> postingan dari <strong>{postsData.account?.label}</strong>
              </div>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 16,
              }}>
                {posts.map(post => (
                  <PostCard
                    key={post.id}
                    post={post}
                    onCopy={(url) => handleCopy(url, post.id)}
                    copied={copiedId === post.id}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}
