import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { amplifyAPI, accountsAPI, aiAPI } from '../api';
import { PLATFORMS } from '../utils';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const PLATFORM_ACTIONS = {
  facebook: [
    { key: 'like', icon: '👍', label: 'Like', color: '#1877F2', desc: 'Suka postingan' },
    { key: 'comment', icon: '💬', label: 'Komentar', color: '#378ADD', desc: 'Tulis komentar' },
    { key: 'share', icon: '↗', label: 'Share', color: '#1D9E75', desc: 'Bagikan ke timeline' },
    { key: 'save', icon: '🔖', label: 'Save', color: '#7F77DD', desc: 'Simpan postingan' },
  ],
  facebook_personal: [
    { key: 'like', icon: '👍', label: 'Like', color: '#1877F2', desc: 'Suka postingan' },
    { key: 'comment', icon: '💬', label: 'Komentar', color: '#378ADD', desc: 'Tulis komentar' },
    { key: 'share', icon: '↗', label: 'Share', color: '#1D9E75', desc: 'Bagikan ke timeline' },
    { key: 'save', icon: '🔖', label: 'Save', color: '#7F77DD', desc: 'Simpan postingan' },
  ],
  youtube: [
    { key: 'like', icon: '👍', label: 'Like', color: '#FF0000', desc: 'Suka video' },
    { key: 'dislike', icon: '👎', label: 'Dislike', color: '#E24B4A', desc: 'Tidak suka video' },
    { key: 'comment', icon: '💬', label: 'Komentar', color: '#378ADD', desc: 'Tulis komentar' },
    { key: 'subscribe', icon: '🔔', label: 'Subscribe', color: '#FF0000', desc: 'Langganan channel' },
    { key: 'save', icon: '🔖', label: 'Save', color: '#7F77DD', desc: 'Simpan ke playlist' },
  ],
  instagram: [
    { key: 'like', icon: '❤️', label: 'Like', color: '#D4537E', desc: 'Suka postingan' },
    { key: 'comment', icon: '💬', label: 'Komentar', color: '#378ADD', desc: 'Tulis komentar' },
    { key: 'save', icon: '🔖', label: 'Save', color: '#7F77DD', desc: 'Simpan postingan' },
    { key: 'follow', icon: '✅', label: 'Follow', color: '#1D9E75', desc: 'Ikuti akun' },
  ],
  twitter: [
    { key: 'like', icon: '❤️', label: 'Like', color: '#D4537E', desc: 'Suka tweet' },
    { key: 'comment', icon: '💬', label: 'Reply', color: '#378ADD', desc: 'Balas tweet' },
    { key: 'share', icon: '🔄', label: 'Retweet', color: '#1D9E75', desc: 'Retweet postingan' },
    { key: 'bookmark', icon: '🔖', label: 'Bookmark', color: '#7F77DD', desc: 'Simpan tweet' },
    { key: 'follow', icon: '✅', label: 'Follow', color: '#1D9E75', desc: 'Ikuti akun' },
  ],
  tiktok: [
    { key: 'like', icon: '❤️', label: 'Like', color: '#D4537E', desc: 'Suka video' },
    { key: 'comment', icon: '💬', label: 'Komentar', color: '#378ADD', desc: 'Tulis komentar' },
    { key: 'share', icon: '↗', label: 'Share', color: '#1D9E75', desc: 'Bagikan video' },
    { key: 'repost', icon: '🔄', label: 'Repost', color: '#639922', desc: 'Repost video' },
    { key: 'save', icon: '🔖', label: 'Favorit', color: '#7F77DD', desc: 'Tambah ke favorit' },
    { key: 'follow', icon: '✅', label: 'Follow', color: '#1D9E75', desc: 'Ikuti akun' },
  ],
};

const PLATFORM_TABS = [
  { key: 'facebook', label: 'Facebook', icon: '📘', color: '#1877F2', bg: '#E6F1FB', badgeBg: '#1877F220' },
  { key: 'instagram', label: 'Instagram', icon: '📸', color: '#D4537E', bg: '#FBEAF0', badgeBg: '#D4537E20' },
  { key: 'youtube', label: 'YouTube', icon: '▶️', color: '#FF0000', bg: '#FAECE7', badgeBg: '#FF000020' },
  { key: 'twitter', label: 'X/Twitter', icon: '🐦', color: '#888780', bg: '#F1EFE8', badgeBg: '#88878020' },
  { key: 'tiktok', label: 'TikTok', icon: '🎵', color: '#639922', bg: '#EAF3DE', badgeBg: '#63992220' },
];

const URL_PLACEHOLDERS = {
  facebook: 'https://www.facebook.com/permalink.php?story_fbid=...',
  instagram: 'https://www.instagram.com/p/ABC123xyz/',
  youtube: 'https://www.youtube.com/watch?v=xxxxxxxxxxx',
  twitter: 'https://twitter.com/user/status/1234567890',
  tiktok: 'https://www.tiktok.com/@user/video/1234567890',
};

export default function AmplifyPage() {
  const qc = useQueryClient();
  const [activePlatform, setActivePlatform] = useState('youtube');
  const [urls, setUrls] = useState(['']);
  const [selectedActions, setSelectedActions] = useState({});
  const [comments, setComments] = useState(['']);
  const [selectedAccountIds, setSelectedAccountIds] = useState(new Set());
  const [selectAll, setSelectAll] = useState(true);
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);
  const [stoppingJob, setStoppingJob] = useState(null);
  const [activeTab, setActiveTab] = useState('create');

  // AI States
  const [useAI, setUseAI] = useState(false);
  const [aiTone, setAiTone] = useState('pro');
  const [aiStyle, setAiStyle] = useState('santai');
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // Content context for AI
  const [contentContext, setContentContext] = useState('');
  const [isScrapingTitle, setIsScrapingTitle] = useState(false);

  const dropdownRef = useRef(null);

  // Extract YouTube video ID from URL
  const extractYouTubeId = (url) => {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  // Scrape YouTube title via oEmbed (no API key needed)
  const scrapeYouTubeTitle = async (url) => {
    if (!url || !extractYouTubeId(url)) return;
    setIsScrapingTitle(true);
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (res.ok) {
        const data = await res.json();
        if (data.title) {
          setContentContext(data.title);
        }
      }
    } catch (err) {
      // Silently fail, user can input manually
    } finally {
      setIsScrapingTitle(false);
    }
  };

  // Auto-scrape YouTube title when URL changes
  useEffect(() => {
    if (activePlatform === 'youtube' && urls.length > 0) {
      const firstUrl = urls[0]?.trim();
      if (firstUrl && extractYouTubeId(firstUrl)) {
        scrapeYouTubeTitle(firstUrl);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls[0], activePlatform]);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => accountsAPI.getAll().then(r => r.data)
  });

  const { data: jobs = [], refetch } = useQuery({
    queryKey: ['amplify-jobs'],
    queryFn: () => amplifyAPI.getAll().then(r => r.data),
    refetchInterval: 5000
  });

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowAccountDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    setUseAI(false);
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

  const generateAIComments = async () => {
    const count = getSelectedCount() || 5;
    if (count === 0) {
      toast.error('Pilih minimal 1 akun terlebih dahulu');
      return;
    }

    setIsGeneratingAI(true);
    try {
      const res = await aiAPI.generateComments({
        platform: activePlatform,
        count,
        stance: aiTone,
        style: aiStyle,
        topic: contentContext || 'konten video'
      });
      const generated = res.data?.comments || [];
      if (generated.length > 0) {
        setComments(generated);
        toast.success(`✨ ${generated.length} komentar AI berhasil digenerate!`);
      } else {
        toast.error('AI tidak mengembalikan komentar');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal generate komentar AI');
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleSubmit = () => {
    const validUrls = urls.filter(u => u.trim());
    if (!validUrls.length) return toast.error('Masukkan minimal 1 URL target');
    if (!Object.values(selectedActions).some(v => v)) return toast.error('Pilih minimal 1 aksi');
    if (selectedActions.comment && comments.filter(c => c.trim()).length === 0) {
      return toast.error('Isi minimal 1 template komentar atau generate dengan AI');
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

  const selectedCount = getSelectedCount();

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid rgba(0,0,0,0.06)'
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a1a', margin: 0, letterSpacing: '-0.3px' }}>
            Amplifikasi Konten
          </h1>
          <p style={{ fontSize: 13, color: '#888', margin: '4px 0 0 0' }}>
            Automatisasi interaksi social media dengan multi-akun
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6, background: '#f5f4f2', padding: 4, borderRadius: 10 }}>
          <button
            onClick={() => setActiveTab('create')}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
              background: activeTab === 'create' ? '#fff' : 'transparent',
              color: activeTab === 'create' ? '#534AB7' : '#888',
              boxShadow: activeTab === 'create' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none'
            }}
          >
            ✨ Buat Job
          </button>
          <button
            onClick={() => { setActiveTab('history'); refetch(); }}
            style={{
              padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
              background: activeTab === 'history' ? '#fff' : 'transparent',
              color: activeTab === 'history' ? '#534AB7' : '#888',
              boxShadow: activeTab === 'history' ? '0 1px 4px rgba(0,0,0,0.08)' : 'none'
            }}
          >
            📋 Riwayat
          </button>
        </div>
      </div>

      <div>
        {activeTab === 'create' ? (
          <>
            {/* Platform Tabs - Modern Pills */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
              {PLATFORM_TABS.map(p => {
                const count = accounts.filter(a =>
                  p.key === 'facebook'
                    ? a.platform === 'facebook' || a.platform === 'facebook_personal'
                    : a.platform === p.key
                ).length;
                const isActive = activePlatform === p.key;
                return (
                  <button
                    key={p.key}
                    onClick={() => handlePlatformChange(p.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 18px', borderRadius: 12, cursor: 'pointer',
                      border: `2px solid ${isActive ? p.color : 'transparent'}`,
                      background: isActive ? p.bg : '#f8f8f6',
                      transition: 'all 0.18s ease',
                      fontFamily: 'inherit',
                      outline: 'none',
                      transform: isActive ? 'scale(1.02)' : 'scale(1)',
                    }}
                    onMouseEnter={e => {
                      if (!isActive) e.currentTarget.style.background = '#f0efec';
                    }}
                    onMouseLeave={e => {
                      if (!isActive) e.currentTarget.style.background = '#f8f8f6';
                    }}
                  >
                    <span style={{ fontSize: 16 }}>{p.icon}</span>
                    <span style={{
                      fontSize: 13, fontWeight: isActive ? 600 : 500,
                      color: isActive ? p.color : '#555'
                    }}>{p.label}</span>
                    <span style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 12,
                      background: isActive ? p.color : '#e0e0e0',
                      color: isActive ? '#fff' : '#888', fontWeight: 600,
                      minWidth: 20, textAlign: 'center'
                    }}>{count}</span>
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 20, alignItems: 'start' }}>
              {/* Left Column */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* URL Card */}
                <div style={{
                  background: '#fff', borderRadius: 16, padding: 20,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
                        🎯 URL Target
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                        Semua akun akan mengamplifikasi setiap URL
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        if (urls.length < 10) setUrls([...urls, '']);
                        else toast.error('Maksimal 10 URL');
                      }}
                      style={{
                        padding: '6px 14px', borderRadius: 8, border: '1.5px solid #E0E0E0',
                        background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                        color: '#534AB7', display: 'flex', alignItems: 'center', gap: 4,
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F8F7FF'}
                      onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                    >
                      + Tambah URL
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {urls.map((u, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <div style={{
                          width: 26, height: 26, borderRadius: '50%',
                          background: 'linear-gradient(135deg, #EEEDFE, #E8E6FC)',
                          color: '#534AB7',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 700, flexShrink: 0
                        }}>{i + 1}</div>
                        <input
                          type="url"
                          placeholder={URL_PLACEHOLDERS[activePlatform]}
                          value={u}
                          onChange={e => {
                            const updated = [...urls];
                            updated[i] = e.target.value;
                            setUrls(updated);
                          }}
                          style={{
                            flex: 1, padding: '10px 14px', borderRadius: 10,
                            border: '1.5px solid #E8E8E8', fontSize: 13,
                            background: '#FAFAFA', transition: 'all 0.15s',
                            outline: 'none'
                          }}
                          onFocus={e => e.target.style.borderColor = '#534AB7'}
                          onBlur={e => e.target.style.borderColor = '#E8E8E8'}
                        />
                        {urls.length > 1 && (
                          <button
                            onClick={() => setUrls(urls.filter((_, idx) => idx !== i))}
                            style={{
                              width: 28, height: 28, borderRadius: '50%',
                              background: '#FCEBEB', border: 'none',
                              cursor: 'pointer', color: '#E24B4A', fontSize: 16,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              transition: 'all 0.15s'
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = '#FAD5D5'}
                            onMouseLeave={e => e.currentTarget.style.background = '#FCEBEB'}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Content Context Input */}
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>
                        📝 Konteks Konten
                      </label>
                      {isScrapingTitle && (
                        <span style={{ fontSize: 11, color: '#7F77DD' }}>
                          ⟳ Mengambil judul video...
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder={
                        activePlatform === 'youtube'
                          ? 'Judul video akan diambil otomatis, atau isi manual...'
                          : 'Deskripsikan konten target (mis: stand up comedy, tutorial masak, dll)...'
                      }
                      value={contentContext}
                      onChange={e => setContentContext(e.target.value)}
                      style={{
                        width: '100%', padding: '10px 14px', borderRadius: 10,
                        border: '1.5px solid #E8E8E8', fontSize: 13,
                        background: '#FAFAFA', transition: 'all 0.15s',
                        outline: 'none', boxSizing: 'border-box'
                      }}
                      onFocus={e => e.target.style.borderColor = '#534AB7'}
                      onBlur={e => e.target.style.borderColor = '#E8E8E8'}
                    />
                    <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
                      {activePlatform === 'youtube'
                        ? '💡 AI akan membaca judul video untuk membuat komentar yang relevan'
                        : '💡 Deskripsikan konten agar AI membuat komentar yang sesuai'
                      }
                    </div>
                  </div>

                  {platformAccounts.length === 0 && (
                    <div style={{
                      marginTop: 14, padding: '12px 16px', background: '#FCEBEB',
                      borderRadius: 10, fontSize: 12, color: '#A32D2D',
                      display: 'flex', alignItems: 'center', gap: 8
                    }}>
                      <span>⚠️</span>
                      <span>Belum ada akun {PLATFORM_TABS.find(p => p.key === activePlatform)?.label} terhubung.</span>
                    </div>
                  )}
                </div>

                {/* Actions Card */}
                <div style={{
                  background: '#fff', borderRadius: 16, padding: 20,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 14 }}>
                    ⚡ Pilih Aksi
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(currentActions.length, 4)}, 1fr)`, gap: 10 }}>
                    {currentActions.map(a => {
                      const isSelected = selectedActions[a.key];
                      return (
                        <button
                          key={a.key}
                          onClick={() => toggleAction(a.key)}
                          style={{
                            textAlign: 'center', padding: '16px 10px', borderRadius: 14,
                            cursor: 'pointer', border: 'none', fontFamily: 'inherit',
                            background: isSelected
                              ? `linear-gradient(135deg, ${a.color}15, ${a.color}08)`
                              : '#f8f8f6',
                            boxShadow: isSelected
                              ? `0 0 0 2px ${a.color}, 0 4px 12px ${a.color}20`
                              : '0 1px 2px rgba(0,0,0,0.04)',
                            transition: 'all 0.18s ease',
                            outline: 'none',
                            position: 'relative',
                            overflow: 'hidden'
                          }}
                          onMouseEnter={e => {
                            if (!isSelected) e.currentTarget.style.background = '#f0efec';
                          }}
                          onMouseLeave={e => {
                            if (!isSelected) e.currentTarget.style.background = '#f8f8f6';
                          }}
                        >
                          <div style={{ fontSize: 24, marginBottom: 6 }}>{a.icon}</div>
                          <div style={{
                            fontSize: 12, fontWeight: 600,
                            color: isSelected ? a.color : '#555'
                          }}>{a.label}</div>
                          <div style={{
                            fontSize: 10, color: '#999', marginTop: 2
                          }}>{a.desc}</div>
                          {isSelected && (
                            <div style={{
                              position: 'absolute', top: 6, right: 6,
                              width: 16, height: 16, borderRadius: '50%',
                              background: a.color, display: 'flex',
                              alignItems: 'center', justifyContent: 'center'
                            }}>
                              <span style={{ color: '#fff', fontSize: 9 }}>✓</span>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Comments Card - with AI */}
                {selectedActions.comment && (
                  <div style={{
                    background: '#fff', borderRadius: 16, padding: 20,
                    border: '1px solid rgba(0,0,0,0.06)',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
                          💬 Template Komentar
                        </div>
                        <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          {useAI
                            ? `AI akan generate ${selectedCount || 0} komentar unik sesuai jumlah akun`
                            : 'Setiap akun akan menggunakan komentar secara bergantian'}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => setComments([...comments, ''])}
                          style={{
                            padding: '6px 14px', borderRadius: 8, border: '1.5px solid #E0E0E0',
                            background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                            color: '#534AB7', transition: 'all 0.15s'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8F7FF'}
                          onMouseLeave={e => e.currentTarget.style.background = '#fff'}
                        >
                          + Tambah
                        </button>
                      </div>
                    </div>

                    {/* AI Toggle */}
                    <div style={{
                      marginBottom: 16, padding: 14,
                      background: useAI ? 'linear-gradient(135deg, #F0EEFB, #E8E6FC)' : '#f8f8f6',
                      borderRadius: 12,
                      border: useAI ? '1.5px solid #7F77DD40' : '1.5px solid transparent',
                      transition: 'all 0.2s'
                    }}>
                      <label style={{
                        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer'
                      }}>
                        <div style={{
                          width: 36, height: 20, borderRadius: 10,
                          background: useAI ? '#7F77DD' : '#ccc',
                          position: 'relative', transition: 'all 0.2s',
                          flexShrink: 0
                        }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: '50%',
                            background: '#fff',
                            position: 'absolute', top: 2,
                            left: useAI ? 18 : 2,
                            transition: 'all 0.2s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                          }} />
                          <input
                            type="checkbox"
                            checked={useAI}
                            onChange={(e) => setUseAI(e.target.checked)}
                            style={{ opacity: 0, position: 'absolute', width: '100%', height: '100%', cursor: 'pointer' }}
                          />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: useAI ? '#534AB7' : '#555' }}>
                            ✨ Gunakan AI Gemini untuk komentar
                          </div>
                          <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>
                            Generate komentar otomatis dengan tone dan gaya pilihan
                          </div>
                        </div>
                      </label>

                      {useAI && (
                        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 500, color: '#666', marginBottom: 4, display: 'block' }}>
                                Tone / Narasi
                              </label>
                              <select
                                value={aiTone}
                                onChange={e => setAiTone(e.target.value)}
                                style={{
                                  width: '100%', padding: '10px 12px', borderRadius: 10,
                                  border: '1.5px solid #E0E0E0', fontSize: 12, background: '#fff',
                                  outline: 'none', cursor: 'pointer'
                                }}
                              >
                                <option value="pro">👍 Pro — Mendukung & Memuji</option>
                                <option value="kontra">👎 Kontra — Kritis & Menyanggah</option>
                                <option value="netral">😐 Netral — Seimbang</option>
                              </select>
                            </div>
                            <div>
                              <label style={{ fontSize: 11, fontWeight: 500, color: '#666', marginBottom: 4, display: 'block' }}>
                                Gaya Penulisan
                              </label>
                              <select
                                value={aiStyle}
                                onChange={e => setAiStyle(e.target.value)}
                                style={{
                                  width: '100%', padding: '10px 12px', borderRadius: 10,
                                  border: '1.5px solid #E0E0E0', fontSize: 12, background: '#fff',
                                  outline: 'none', cursor: 'pointer'
                                }}
                              >
                                <option value="santai">😎 Santai & Friendly</option>
                                <option value="formal">👔 Formal & Profesional</option>
                                <option value="kritis">🧐 Kritis & Analitis</option>
                                <option value="lucu">😂 Lucu & Menghibur</option>
                                <option value="pendek">⚡ Singkat & Padat</option>
                                <option value="mixed">🎲 Campuran Gaya</option>
                              </select>
                            </div>
                          </div>

                          <button
                            onClick={generateAIComments}
                            disabled={isGeneratingAI || selectedCount === 0}
                            style={{
                              padding: '10px 18px', borderRadius: 10, border: 'none',
                              background: isGeneratingAI ? '#ccc' : 'linear-gradient(135deg, #7F77DD, #6B63C9)',
                              color: '#fff', fontSize: 13, fontWeight: 600,
                              cursor: isGeneratingAI || selectedCount === 0 ? 'not-allowed' : 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                              transition: 'all 0.15s', boxShadow: isGeneratingAI ? 'none' : '0 2px 8px #7F77DD40'
                            }}
                          >
                            {isGeneratingAI ? (
                              <>
                                <span style={{ animation: 'spin 1s linear infinite' }}>⟳</span>
                                Generate komentar...
                              </>
                            ) : (
                              <>
                                ✨ Generate {selectedCount || 0} Komentar AI
                              </>
                            )}
                          </button>

                          {selectedCount === 0 && (
                            <div style={{ fontSize: 11, color: '#E24B4A', textAlign: 'center' }}>
                              Pilih akun terlebih dahulu untuk menentukan jumlah komentar
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Manual Comment Inputs */}
                    <div style={{
                      display: 'flex', flexDirection: 'column', gap: 10,
                      opacity: useAI ? 0.6 : 1,
                      pointerEvents: useAI ? 'none' : 'auto',
                      transition: 'opacity 0.2s'
                    }}>
                      {comments.map((c, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: '50%',
                            background: 'linear-gradient(135deg, #EEEDFE, #E8E6FC)',
                            color: '#534AB7',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 11, fontWeight: 700, flexShrink: 0
                          }}>{i + 1}</div>
                          <input
                            type="text"
                            placeholder={`Variasi komentar ${i + 1}...`}
                            value={c}
                            onChange={e => {
                              const updated = [...comments];
                              updated[i] = e.target.value;
                              setComments(updated);
                            }}
                            style={{
                              flex: 1, padding: '10px 14px', borderRadius: 10,
                              border: '1.5px solid #E8E8E8', fontSize: 13,
                              background: '#FAFAFA', outline: 'none',
                              transition: 'all 0.15s'
                            }}
                            onFocus={e => e.target.style.borderColor = '#534AB7'}
                            onBlur={e => e.target.style.borderColor = '#E8E8E8'}
                          />
                          {comments.length > 1 && (
                            <button
                              onClick={() => setComments(comments.filter((_, idx) => idx !== i))}
                              style={{
                                width: 28, height: 28, borderRadius: '50%',
                                background: '#FCEBEB', border: 'none',
                                cursor: 'pointer', color: '#E24B4A', fontSize: 16,
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                              }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Account Selection Card */}
                <div style={{
                  background: '#fff', borderRadius: 16, padding: 20,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a', marginBottom: 14 }}>
                    👥 Akun yang Digunakan
                  </div>

                  <div style={{ position: 'relative' }} ref={dropdownRef}>
                    <div
                      onClick={() => setShowAccountDropdown(!showAccountDropdown)}
                      style={{
                        padding: '12px 16px', border: '1.5px solid #E8E8E8',
                        borderRadius: 12, cursor: 'pointer', display: 'flex',
                        justifyContent: 'space-between', alignItems: 'center',
                        background: '#FAFAFA', fontSize: 13,
                        transition: 'all 0.15s'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>👤</span>
                        <span style={{ fontWeight: 500 }}>
                          {selectedCount === 0
                            ? 'Pilih akun...'
                            : `${selectedCount} akun dipilih`}
                        </span>
                      </div>
                      <span style={{
                        color: '#888', fontSize: 11,
                        transform: showAccountDropdown ? 'rotate(180deg)' : 'rotate(0)',
                        transition: 'transform 0.2s'
                      }}>▼</span>
                    </div>

                    {showAccountDropdown && (
                      <div style={{
                        position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
                        background: '#fff', border: '1.5px solid #E8E8E8',
                        borderRadius: 12, zIndex: 100, maxHeight: 280,
                        overflowY: 'auto', boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
                        padding: 6
                      }}>
                        {/* Select All */}
                        <div
                          onClick={toggleSelectAll}
                          style={{
                            padding: '10px 14px', display: 'flex', alignItems: 'center',
                            gap: 10, cursor: 'pointer', borderRadius: 8,
                            background: selectAll ? '#EEEDFE' : 'transparent',
                            transition: 'all 0.12s'
                          }}
                        >
                          <div style={{
                            width: 18, height: 18, borderRadius: 5,
                            border: `2px solid ${selectAll ? '#7F77DD' : '#ccc'}`,
                            background: selectAll ? '#7F77DD' : '#fff',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0
                          }}>
                            {selectAll && <span style={{ color: '#fff', fontSize: 11 }}>✓</span>}
                          </div>
                          <span style={{
                            fontSize: 13, fontWeight: 600,
                            color: selectAll ? '#534AB7' : '#333'
                          }}>
                            Semua Akun ({platformAccounts.length})
                          </span>
                        </div>

                        <div style={{ height: 1, background: '#f0f0f0', margin: '4px 10px' }} />

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
                                borderRadius: 8,
                                background: isChecked ? `${platformColor}08` : 'transparent',
                                transition: 'all 0.12s'
                              }}
                            >
                              <div style={{
                                width: 18, height: 18, borderRadius: 5,
                                border: `2px solid ${isChecked ? platformColor : '#ccc'}`,
                                background: isChecked ? platformColor : '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0
                              }}>
                                {isChecked && <span style={{ color: '#fff', fontSize: 11 }}>✓</span>}
                              </div>
                              <span style={{ fontSize: 12, flex: 1, color: '#333' }}>{a.label || a.username}</span>
                            </div>
                          );
                        })}

                        {platformAccounts.length === 0 && (
                          <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: '#aaa' }}>
                            Tidak ada akun untuk platform ini
                          </div>
                        )}

                        <div style={{ height: 1, background: '#f0f0f0', margin: '4px 10px' }} />

                        <div
                          onClick={() => setShowAccountDropdown(false)}
                          style={{
                            padding: '10px 14px', textAlign: 'center',
                            fontSize: 12, color: '#7F77DD', cursor: 'pointer',
                            borderRadius: 8, fontWeight: 600,
                            transition: 'all 0.12s'
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = '#F8F7FF'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          ✓ Selesai Pilih
                        </div>
                      </div>
                    )}
                  </div>

                  {selectedCount > 0 && (
                    <div style={{
                      marginTop: 12, padding: '10px 14px',
                      background: 'linear-gradient(135deg, #EAF3DE, #E8F0D8)',
                      borderRadius: 10, fontSize: 12, color: '#3B6D11',
                      display: 'flex', alignItems: 'center', gap: 6
                    }}>
                      <span>✅</span>
                      <span><strong>{selectedCount}</strong> akun akan menjalankan amplifikasi</span>
                    </div>
                  )}

                  <div style={{
                    marginTop: 10, padding: '10px 14px',
                    background: '#f8f8f6', borderRadius: 10,
                    fontSize: 12, color: '#888',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    <span>🛡️</span>
                    <span>Jeda 30-60 detik antar akun untuk keamanan</span>
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  onClick={handleSubmit}
                  disabled={createJob.isPending || platformAccounts.length === 0}
                  style={{
                    width: '100%', padding: '14px 20px', borderRadius: 14,
                    border: 'none', fontSize: 15, fontWeight: 700,
                    color: '#fff',
                    background: createJob.isPending || platformAccounts.length === 0
                      ? '#ccc'
                      : 'linear-gradient(135deg, #534AB7, #6B63C9)',
                    cursor: createJob.isPending || platformAccounts.length === 0 ? 'not-allowed' : 'pointer',
                    boxShadow: createJob.isPending || platformAccounts.length === 0
                      ? 'none'
                      : '0 4px 16px #534AB760',
                    transition: 'all 0.18s',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                  }}
                >
                  {createJob.isPending ? (
                    <>
                      <span style={{ animation: 'spin 1s linear infinite' }}>⟳</span>
                      Memulai amplifikasi...
                    </>
                  ) : (
                    <>
                      🚀 Jalankan Amplifikasi
                    </>
                  )}
                </button>
              </div>

              {/* Right Column - Preview */}
              <div style={{ position: 'sticky', top: 20 }}>
                <div style={{
                  background: '#fff', borderRadius: 16, padding: 20,
                  border: '1px solid rgba(0,0,0,0.06)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: '#1a1a1a',
                    marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    👁️ Preview
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Platform
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      fontSize: 13, fontWeight: 600, color: PLATFORM_TABS.find(p => p.key === activePlatform)?.color || '#333'
                    }}>
                      <span style={{ fontSize: 16 }}>
                        {PLATFORM_TABS.find(p => p.key === activePlatform)?.icon}
                      </span>
                      {PLATFORM_TABS.find(p => p.key === activePlatform)?.label}
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      URL Target ({urls.filter(u => u.trim()).length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {urls.filter(u => u.trim()).map((u, i) => (
                        <div key={i} style={{
                          fontSize: 12, color: '#185FA5', wordBreak: 'break-all',
                          padding: '6px 10px', background: '#F0F7FF', borderRadius: 8
                        }}>
                          {u.slice(0, 45)}{u.length > 45 ? '...' : ''}
                        </div>
                      ))}
                      {urls.filter(u => u.trim()).length === 0 && (
                        <span style={{ color: '#ccc', fontSize: 12 }}>— Belum ada URL</span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Aksi Dipilih
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {currentActions.filter(a => selectedActions[a.key]).map(a => (
                        <span key={a.key} style={{
                          fontSize: 11, padding: '4px 10px', borderRadius: 20,
                          background: `${a.color}15`, color: a.color, fontWeight: 600,
                          display: 'flex', alignItems: 'center', gap: 4
                        }}>
                          {a.icon} {a.label}
                        </span>
                      ))}
                      {!Object.values(selectedActions).some(v => v) && (
                        <span style={{ fontSize: 12, color: '#ccc' }}>Belum ada aksi dipilih</span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      Akun ({selectedCount})
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                      {selectedCount} akun dipilih
                    </div>
                  </div>

                  {selectedActions.comment && comments.filter(c => c.trim()).length > 0 && (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 500, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Komentar ({comments.filter(c => c.trim()).length} variasi)
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {comments.filter(c => c.trim()).slice(0, 5).map((c, i) => (
                          <div key={i} style={{
                            fontSize: 11, padding: '6px 10px',
                            background: '#f8f8f6', borderRadius: 8,
                            color: '#555', borderLeft: '3px solid #7F77DD'
                          }}>
                            {c.length > 50 ? c.slice(0, 50) + '...' : c}
                          </div>
                        ))}
                        {comments.filter(c => c.trim()).length > 5 && (
                          <div style={{ fontSize: 11, color: '#888', textAlign: 'center' }}>
                            +{comments.filter(c => c.trim()).length - 5} komentar lainnya
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {useAI && selectedActions.comment && (
                    <div style={{
                      marginBottom: 14, padding: '10px 14px',
                      background: 'linear-gradient(135deg, #F0EEFB, #E8E6FC)',
                      borderRadius: 10, fontSize: 12, color: '#534AB7',
                      display: 'flex', alignItems: 'center', gap: 6
                    }}>
                      <span>✨</span>
                      <span>AI {aiTone === 'pro' ? 'Pro' : aiTone === 'kontra' ? 'Kontra' : 'Netral'} · {aiStyle}</span>
                    </div>
                  )}

                  <div style={{
                    padding: '12px 14px', background: '#FAEEDA', borderRadius: 10,
                    fontSize: 12, color: '#633806',
                    display: 'flex', alignItems: 'flex-start', gap: 8
                  }}>
                    <span style={{ fontSize: 14 }}>⚠️</span>
                    <span>Amplifikasi menggunakan API resmi dengan jeda otomatis antar aksi untuk keamanan akun.</span>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* History Tab */
          <div style={{
            background: '#fff', borderRadius: 16, padding: 20,
            border: '1px solid rgba(0,0,0,0.06)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a' }}>
                  📋 Riwayat Amplifikasi
                </div>
                <div style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                  {jobs.length} job total
                </div>
              </div>
              <button
                onClick={() => refetch()}
                style={{
                  padding: '8px 16px', borderRadius: 10, border: '1.5px solid #E0E0E0',
                  background: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 500,
                  color: '#534AB7', display: 'flex', alignItems: 'center', gap: 4
                }}
              >
                ↻ Refresh
              </button>
            </div>

            {jobs.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: '60px 20px', color: '#aaa'
              }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📭</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#888' }}>
                  Belum ada job amplifikasi
                </div>
                <div style={{ fontSize: 12, marginTop: 4 }}>
                  Buat job baru untuk memulai amplifikasi
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {jobs.map(job => (
                  <div key={job._id} style={{
                    padding: 16, borderRadius: 14,
                    border: '1.5px solid rgba(0,0,0,0.06)',
                    background: '#FAFAFA',
                    transition: 'all 0.15s'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                          fontSize: 12, color: '#185FA5', wordBreak: 'break-all',
                          marginBottom: 4, fontWeight: 500
                        }}>
                          {job.targetUrl}
                        </div>
                        <div style={{ fontSize: 11, color: '#aaa', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <span>{dayjs(job.createdAt).format('DD MMM YYYY · HH:mm')}</span>
                          <span>·</span>
                          <span style={{
                            color: PLATFORM_TABS.find(p => p.key === job.platform)?.color || '#888',
                            fontWeight: 600
                          }}>
                            {PLATFORM_TABS.find(p => p.key === job.platform)?.icon} {job.platform}
                          </span>
                          <span>·</span>
                          <span>{job.actions?.map(a => a.type).join(', ')}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        <span style={{
                          fontSize: 11, padding: '4px 12px', borderRadius: 20, fontWeight: 600,
                          background: `${getStatusColor(job.status)}15`,
                          color: getStatusColor(job.status)
                        }}>
                          {getStatusLabel(job.status)}
                        </span>
                        {job.status === 'running' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); stopJob(job._id); }}
                            disabled={stoppingJob === job._id}
                            style={{
                              fontSize: 11, padding: '4px 12px', borderRadius: 20,
                              background: '#FCEBEB', color: '#E24B4A',
                              border: '1.5px solid #E24B4A', cursor: 'pointer', fontWeight: 600,
                              transition: 'all 0.15s'
                            }}
                          >
                            {stoppingJob === job._id ? '...' : '⏹ Stop'}
                          </button>
                        )}
                      </div>
                    </div>

                    {job.results && job.results.length > 0 && (
                      <div style={{
                        background: '#fff', borderRadius: 10, padding: '10px 14px',
                        border: '1px solid rgba(0,0,0,0.04)'
                      }}>
                        <div style={{ fontSize: 11, color: '#888', marginBottom: 8, fontWeight: 500 }}>
                          Hasil: {job.results.filter(r => r.success).length} berhasil · {job.results.filter(r => !r.success).length} gagal
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {job.results.map((r, i) => (
                            <span key={i} style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 8,
                              background: r.success ? '#EAF3DE' : '#FCEBEB',
                              color: r.success ? '#3B6D11' : '#A32D2D',
                              fontWeight: 500
                            }}>
                              {r.success ? '✓' : '✗'} {r.action}
                              {r.error && ` · ${r.error.slice(0, 30)}`}
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
        )}
      </div>

      {/* CSS Animation for spinner */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
