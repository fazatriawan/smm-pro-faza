import React, { useState } from 'react';
import { aiAPI } from '../api';
import toast from 'react-hot-toast';
import dayjs from 'dayjs';

const PLATFORMS = ['facebook', 'instagram', 'youtube', 'twitter', 'tiktok', 'threads'];
const TONES = [
  { key: 'casual', label: '😊 Santai' },
  { key: 'formal', label: '👔 Formal' },
  { key: 'funny', label: '😂 Lucu' },
  { key: 'persuasive', label: '🎯 Persuasif' },
  { key: 'informative', label: '📚 Informatif' },
  { key: 'emotional', label: '❤️ Emosional' },
];
const COMMENT_STYLES = [
  { key: 'mixed', label: '🎲 Campuran' },
  { key: 'appreciative', label: '👏 Memuji' },
  { key: 'questioning', label: '❓ Bertanya' },
  { key: 'sharing', label: '💬 Berbagi' },
  { key: 'supportive', label: '💪 Mendukung' },
  { key: 'funny', label: '😄 Lucu' },
];

export default function AIPage() {
  const [activeTab, setActiveTab] = useState('caption');
  const [loading, setLoading] = useState(false);

  // Caption state
  const [capTopic, setCapTopic] = useState('');
  const [capPlatform, setCapPlatform] = useState('facebook');
  const [capTone, setCapTone] = useState('casual');
  const [capInfo, setCapInfo] = useState('');
  const [capResult, setCapResult] = useState('');
  const [capVariations, setCapVariations] = useState([]);
  const [capMode, setCapMode] = useState('single');

  // Comment state
  const [comTopic, setComTopic] = useState('');
  const [comPlatform, setComPlatform] = useState('facebook');
  const [comStyle, setComStyle] = useState('mixed');
  const [comCount, setComCount] = useState(10);
  const [comResults, setComResults] = useState([]);

  // Hashtag state
  const [hashTopic, setHashTopic] = useState('');
  const [hashPlatform, setHashPlatform] = useState('instagram');
  const [hashResults, setHashResults] = useState([]);

  // Content Generator state
  const [cgTema, setCgTema] = useState('');
  const [cgData, setCgData] = useState('');
  const [cgType, setCgType] = useState('video');
  const [cgResult, setCgResult] = useState(null);

  // News state
  const [newsSources, setNewsSources] = useState(new Set(['antara', 'detik', 'kompas']));
  const [newsKeyword, setNewsKeyword] = useState('');
  const [newsLimit, setNewsLimit] = useState(15);
  const [newsResults, setNewsResults] = useState([]);
  const [trendsResults, setTrendsResults] = useState([]);
  const [selectedNews, setSelectedNews] = useState(null);

  // Imagen state
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgResult, setImgResult] = useState(null);

  // Sentiment state
  const [sentTexts, setSentTexts] = useState('');
  const [sentResults, setSentResults] = useState(null);

  const NEWS_SOURCES = ['antara', 'detik', 'kompas', 'tempo', 'tribun', 'cnn'];

  const generateCaption = async () => {
    if (!capTopic.trim()) return toast.error('Masukkan topik/produk!');
    setLoading(true);
    try {
      if (capMode === 'single') {
        const res = await aiAPI.generateCaption({ topic: capTopic, platform: capPlatform, tone: capTone, additionalInfo: capInfo });
        setCapResult(res.data.caption);
      } else {
        const res = await aiAPI.generateVariations({ topic: capTopic, platform: capPlatform, tone: capTone, count: 5, additionalInfo: capInfo });
        setCapVariations(res.data.variations);
      }
      toast.success('Caption berhasil digenerate!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal generate caption');
    } finally {
      setLoading(false);
    }
  };

  const generateComments = async () => {
    if (!comTopic.trim()) return toast.error('Masukkan topik!');
    setLoading(true);
    try {
      const res = await aiAPI.generateComments({ topic: comTopic, platform: comPlatform, style: comStyle, count: comCount });
      setComResults(res.data.comments);
      toast.success(`${res.data.comments.length} komentar berhasil digenerate!`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal generate komentar');
    } finally {
      setLoading(false);
    }
  };

  const generateHashtags = async () => {
    if (!hashTopic.trim()) return toast.error('Masukkan topik!');
    setLoading(true);
    try {
      const res = await aiAPI.generateHashtags({ topic: hashTopic, platform: hashPlatform, count: 20 });
      setHashResults(res.data.hashtags);
      toast.success('Hashtag berhasil digenerate!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal generate hashtag');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Disalin!');
  };

  const generateContentJSON = async () => {
    if (!cgTema.trim()) return toast.error('Masukkan tema!');
    setLoading(true);
    try {
      const res = await aiAPI.generateContent({ tema: cgTema, data: cgData, contentType: cgType });
      setCgResult(res.data.result);
      toast.success('Konten berhasil digenerate!');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Gagal generate konten');
    } finally { setLoading(false); }
  };

  const scrapeNews = async () => {
    setLoading(true);
    try {
      const res = await aiAPI.scrapeNews({ sources: [...newsSources].join(','), keyword: newsKeyword, limit: newsLimit });
      setNewsResults(res.data.articles);
      if (!res.data.articles.length) toast.error('Tidak ada berita ditemukan');
    } catch (err) { toast.error(err.response?.data?.message || 'Gagal scrape berita'); }
    finally { setLoading(false); }
  };

  const scrapeTrends = async () => {
    setLoading(true);
    try {
      const res = await aiAPI.scrapeTrends();
      setTrendsResults(res.data.trends);
    } catch (err) { toast.error(err.response?.data?.message || 'Gagal ambil trending'); }
    finally { setLoading(false); }
  };

  const generateImagen = async () => {
    if (!imgPrompt.trim()) return toast.error('Masukkan deskripsi gambar!');
    setLoading(true);
    setImgResult(null);
    try {
      const res = await aiAPI.generateImagen({ prompt: imgPrompt });
      setImgResult(res.data);
      toast.success('Gambar berhasil digenerate!');
    } catch (err) { toast.error(err.response?.data?.message || 'Gagal generate gambar'); }
    finally { setLoading(false); }
  };

  const analyzeSentiment = async () => {
    const texts = sentTexts.split('\n').map(t => t.trim()).filter(Boolean);
    if (!texts.length) return toast.error('Masukkan minimal 1 teks!');
    setLoading(true);
    try {
      const res = await aiAPI.analyzeSentiment({ texts });
      setSentResults(res.data);
    } catch (err) { toast.error(err.response?.data?.message || 'Gagal analisis sentimen'); }
    finally { setLoading(false); }
  };

  const tabStyle = (key) => ({
    padding: '8px 14px', borderRadius: 8, cursor: 'pointer',
    background: activeTab === key ? '#EEEDFE' : '#f5f4f2',
    color: activeTab === key ? '#534AB7' : '#888',
    fontWeight: activeTab === key ? 500 : 400,
    fontSize: 12, border: `1.5px solid ${activeTab === key ? '#7F77DD' : 'transparent'}`,
    whiteSpace: 'nowrap',
  });

  return (
    <div>
      <div className="page-header">
        <span className="page-title">✨ AI Content Tools</span>
        <div style={{ fontSize: 12, color: '#888' }}>Powered by Gemini AI</div>
      </div>

      <div className="page-content">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { key: 'caption',   label: '📝 Caption' },
            { key: 'comment',   label: '💬 Komentar' },
            { key: 'hashtag',   label: '#️⃣ Hashtag' },
            { key: 'content',   label: '🎬 Content Generator' },
            { key: 'news',      label: '📰 Berita & Tren' },
            { key: 'imagen',    label: '🖼️ Imagen B-roll' },
            { key: 'sentiment', label: '📊 Sentimen' },
          ].map(t => (
            <div key={t.key} onClick={() => setActiveTab(t.key)} style={tabStyle(t.key)}>{t.label}</div>
          ))}
        </div>

        {/* Caption Generator */}
        {activeTab === 'caption' && (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">✨ Generate Caption</div>

                {/* Mode */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {[
                    { key: 'single', label: '1 Caption' },
                    { key: 'variations', label: '5 Variasi (untuk banyak akun)' }
                  ].map(m => (
                    <div key={m.key} onClick={() => setCapMode(m.key)} style={{
                      padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                      background: capMode === m.key ? '#EEEDFE' : '#f5f4f2',
                      color: capMode === m.key ? '#534AB7' : '#888',
                      border: `1.5px solid ${capMode === m.key ? '#7F77DD' : 'transparent'}`
                    }}>{m.label}</div>
                  ))}
                </div>

                <div className="form-group">
                  <label>Topik / Produk *</label>
                  <input type="text" value={capTopic} onChange={e => setCapTopic(e.target.value)}
                    placeholder="contoh: Serum wajah anti aging, Jasa umroh, Produk herbal..." />
                </div>

                <div className="form-group">
                  <label>Platform Target</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {PLATFORMS.map(p => (
                      <div key={p} onClick={() => setCapPlatform(p)} style={{
                        padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                        background: capPlatform === p ? '#7F77DD' : '#f5f4f2',
                        color: capPlatform === p ? '#fff' : '#666'
                      }}>{p}</div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Tone / Gaya Penulisan</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {TONES.map(t => (
                      <div key={t.key} onClick={() => setCapTone(t.key)} style={{
                        padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, textAlign: 'center',
                        background: capTone === t.key ? '#EEEDFE' : '#f5f4f2',
                        color: capTone === t.key ? '#534AB7' : '#666',
                        border: `1.5px solid ${capTone === t.key ? '#7F77DD' : 'transparent'}`
                      }}>{t.label}</div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Info Tambahan (opsional)</label>
                  <textarea value={capInfo} onChange={e => setCapInfo(e.target.value)} rows={2}
                    placeholder="contoh: ada promo diskon 50%, stok terbatas, khusus hari ini..." />
                </div>

                <button className="btn-primary" style={{ width: '100%', padding: 10 }}
                  onClick={generateCaption} disabled={loading}>
                  {loading ? '⟳ Generating...' : `✨ Generate ${capMode === 'variations' ? '5 Variasi' : 'Caption'}`}
                </button>
              </div>
            </div>

            <div>
              {/* Single Result */}
              {capMode === 'single' && capResult && (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div className="card-title" style={{ margin: 0 }}>✅ Hasil Caption</div>
                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => copyToClipboard(capResult)}>
                      📋 Copy
                    </button>
                  </div>
                  <div style={{ background: '#f9f9f9', borderRadius: 8, padding: 14, fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                    {capResult}
                  </div>
                  <button className="btn-primary" style={{ width: '100%', marginTop: 10, padding: 8, fontSize: 12 }}
                    onClick={() => { navigator.clipboard.writeText(capResult); toast.success('Caption disalin — paste di Bulk Post!'); }}>
                    ✦ Gunakan di Bulk Post
                  </button>
                </div>
              )}

              {/* Variations Result */}
              {capMode === 'variations' && capVariations.length > 0 && (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div className="card-title" style={{ margin: 0 }}>✅ {capVariations.length} Variasi Caption</div>
                    <button className="btn-secondary" style={{ fontSize: 12 }}
                      onClick={() => copyToClipboard(capVariations.join('\n\n---\n\n'))}>
                      📋 Copy Semua
                    </button>
                  </div>
                  {capVariations.map((v, i) => (
                    <div key={i} style={{ marginBottom: 12, border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                      <div style={{ background: '#EEEDFE', padding: '6px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#534AB7' }}>Variasi {i+1}</span>
                        <button onClick={() => copyToClipboard(v)} style={{ fontSize: 11, background: 'none', border: 'none', cursor: 'pointer', color: '#534AB7' }}>📋 Copy</button>
                      </div>
                      <div style={{ padding: 12, fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap', background: '#f9f9f9' }}>
                        {v}
                      </div>
                    </div>
                  ))}
                  <div style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: '8px', background: '#EAF3DE', borderRadius: 8 }}>
                    💡 Gunakan variasi berbeda untuk setiap Facebook Page agar konten tidak terlihat spam
                  </div>
                </div>
              )}

              {!capResult && capVariations.length === 0 && (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>✨</div>
                  <div>Isi form dan klik Generate untuk membuat caption dengan AI</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Comment Generator */}
        {activeTab === 'comment' && (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">💬 Generate Komentar AI</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                  Generate komentar natural yang berbeda-beda untuk amplifikasi — setiap akun akan menggunakan komentar berbeda
                </div>

                <div className="form-group">
                  <label>Topik Konten *</label>
                  <input type="text" value={comTopic} onChange={e => setComTopic(e.target.value)}
                    placeholder="contoh: Video tutorial makeup, Review produk herbal..." />
                </div>

                <div className="form-group">
                  <label>Platform</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {PLATFORMS.map(p => (
                      <div key={p} onClick={() => setComPlatform(p)} style={{
                        padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                        background: comPlatform === p ? '#7F77DD' : '#f5f4f2',
                        color: comPlatform === p ? '#fff' : '#666'
                      }}>{p}</div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Gaya Komentar</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {COMMENT_STYLES.map(s => (
                      <div key={s.key} onClick={() => setComStyle(s.key)} style={{
                        padding: '7px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, textAlign: 'center',
                        background: comStyle === s.key ? '#EEEDFE' : '#f5f4f2',
                        color: comStyle === s.key ? '#534AB7' : '#666',
                        border: `1.5px solid ${comStyle === s.key ? '#7F77DD' : 'transparent'}`
                      }}>{s.label}</div>
                    ))}
                  </div>
                </div>

                <div className="form-group">
                  <label>Jumlah Komentar: {comCount}</label>
                  <input type="range" min="5" max="30" value={comCount}
                    onChange={e => setComCount(parseInt(e.target.value))} />
                </div>

                <button className="btn-primary" style={{ width: '100%', padding: 10 }}
                  onClick={generateComments} disabled={loading}>
                  {loading ? '⟳ Generating...' : `💬 Generate ${comCount} Komentar`}
                </button>
              </div>
            </div>

            <div>
              {comResults.length > 0 ? (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div className="card-title" style={{ margin: 0 }}>✅ {comResults.length} Komentar Siap</div>
                    <button className="btn-secondary" style={{ fontSize: 12 }}
                      onClick={() => copyToClipboard(comResults.join('\n'))}>
                      📋 Copy Semua
                    </button>
                  </div>
                  <div style={{ maxHeight: 450, overflowY: 'auto' }}>
                    {comResults.map((c, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                        padding: '8px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)'
                      }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', background: '#EEEDFE',
                          color: '#534AB7', display: 'flex', alignItems: 'center',
                          justifyContent: 'center', fontSize: 10, fontWeight: 600, flexShrink: 0
                        }}>{i+1}</div>
                        <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5 }}>{c}</div>
                        <button onClick={() => copyToClipboard(c)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#aaa' }}>
                          📋
                        </button>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 12, padding: 10, background: '#EAF3DE', borderRadius: 8, fontSize: 12, color: '#3B6D11' }}>
                    💡 Komentar ini siap digunakan di menu Amplifikasi — paste ke kolom "Template Komentar"
                  </div>
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>💬</div>
                  <div>Generate komentar natural yang berbeda untuk setiap akun amplifikasi</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Content Generator */}
        {activeTab === 'content' && (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">🎬 AI Content Generator</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                  Buat script video/carousel lengkap dengan hook, visual, caption, dan hashtag dalam format JSON terstruktur
                </div>

                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {[{ key: 'video', label: '🎬 Video / Reels' }, { key: 'gambar', label: '🖼️ Carousel / Infografis' }].map(m => (
                    <div key={m.key} onClick={() => setCgType(m.key)} style={{
                      padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                      background: cgType === m.key ? '#EEEDFE' : '#f5f4f2',
                      color: cgType === m.key ? '#534AB7' : '#888',
                      border: `1.5px solid ${cgType === m.key ? '#7F77DD' : 'transparent'}`
                    }}>{m.label}</div>
                  ))}
                </div>

                <div className="form-group">
                  <label>Tema Konten *</label>
                  <input type="text" value={cgTema} onChange={e => setCgTema(e.target.value)}
                    placeholder="contoh: Tips hemat listrik, Manfaat madu, Cara investasi saham..." />
                </div>
                <div className="form-group">
                  <label>Referensi Data / Berita (opsional)</label>
                  <textarea value={cgData} onChange={e => setCgData(e.target.value)} rows={3}
                    placeholder="Paste berita, data statistik, atau info tambahan sebagai referensi konten..." />
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>💡 Gunakan tab Berita & Tren untuk ambil berita terbaru, lalu paste di sini</div>
                </div>
                <button className="btn-primary" style={{ width: '100%', padding: 10 }}
                  onClick={generateContentJSON} disabled={loading}>
                  {loading ? '⟳ Generating...' : '🎬 Generate Konten'}
                </button>
              </div>
            </div>

            <div>
              {cgResult ? (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div className="card-title" style={{ margin: 0 }}>✅ Hasil Konten</div>
                    <button className="btn-secondary" style={{ fontSize: 12 }}
                      onClick={() => copyToClipboard(JSON.stringify(cgResult, null, 2))}>📋 Copy JSON</button>
                  </div>
                  {cgType === 'video' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {[
                        { label: '🎯 Judul', value: cgResult.judul },
                        { label: '🪝 Hook (3 detik)', value: cgResult.hook },
                        { label: '🎬 Visual', value: cgResult.visual },
                        { label: '📜 Script', value: cgResult.script },
                        { label: '📣 CTA', value: cgResult.cta },
                      ].map(({ label, value }) => value && (
                        <div key={label} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ background: '#EEEDFE', padding: '5px 12px', fontSize: 11, fontWeight: 600, color: '#534AB7' }}>{label}</div>
                          <div style={{ padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{value}</div>
                        </div>
                      ))}
                      {cgResult.caption && (
                        <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ background: '#EEEDFE', padding: '5px 12px', fontSize: 11, fontWeight: 600, color: '#534AB7', display: 'flex', justifyContent: 'space-between' }}>
                            📝 Caption
                            <button onClick={() => copyToClipboard(cgResult.caption)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#534AB7' }}>📋 Copy</button>
                          </div>
                          <div style={{ padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{cgResult.caption}</div>
                        </div>
                      )}
                      {cgResult.hashtag?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: 10, background: '#f9f9f9', borderRadius: 8 }}>
                          {cgResult.hashtag.map((h, i) => (
                            <span key={i} onClick={() => copyToClipboard(h)} style={{ padding: '3px 10px', background: '#EEEDFE', borderRadius: 20, fontSize: 11, color: '#534AB7', cursor: 'pointer' }}>{h}</span>
                          ))}
                        </div>
                      )}
                      {cgResult.prompt_gambar_inggris && (
                        <div style={{ padding: 10, background: '#EAF3DE', borderRadius: 8, fontSize: 12 }}>
                          <strong>🖼️ Prompt B-roll:</strong> {cgResult.prompt_gambar_inggris}
                          <button onClick={() => { copyToClipboard(cgResult.prompt_gambar_inggris); setActiveTab('imagen'); setImgPrompt(cgResult.prompt_gambar_inggris); }}
                            style={{ marginLeft: 8, fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#534AB7', color: '#fff', border: 'none', cursor: 'pointer' }}>
                            → Generate Gambar
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {cgResult.judul && <div style={{ fontWeight: 600, fontSize: 14 }}>{cgResult.judul}</div>}
                      {cgResult.hook_visual && (
                        <div style={{ padding: 10, background: '#EEEDFE', borderRadius: 8, fontSize: 13, fontWeight: 500, color: '#534AB7' }}>
                          🪝 Hook: {cgResult.hook_visual}
                        </div>
                      )}
                      {cgResult.slides?.map((s, i) => (
                        <div key={i} style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ background: '#f0f0f0', padding: '5px 12px', fontSize: 11, fontWeight: 600 }}>Slide {s.nomor}: {s.judul_slide}</div>
                          <div style={{ padding: 10 }}>
                            <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 6 }}>{s.isi}</div>
                            <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic' }}>🖼️ Visual: {s.deskripsi_visual_inggris}</div>
                          </div>
                        </div>
                      ))}
                      {cgResult.caption && (
                        <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 8, overflow: 'hidden' }}>
                          <div style={{ background: '#EEEDFE', padding: '5px 12px', fontSize: 11, fontWeight: 600, color: '#534AB7', display: 'flex', justifyContent: 'space-between' }}>
                            📝 Caption
                            <button onClick={() => copyToClipboard(cgResult.caption)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#534AB7' }}>📋 Copy</button>
                          </div>
                          <div style={{ padding: 10, fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{cgResult.caption}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🎬</div>
                  <div>Generate script konten lengkap dengan hook, visual, script, caption, dan hashtag</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Hashtag Generator */}
        {activeTab === 'hashtag' && (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">#️⃣ Generate Hashtag</div>

                <div className="form-group">
                  <label>Topik / Produk *</label>
                  <input type="text" value={hashTopic} onChange={e => setHashTopic(e.target.value)}
                    placeholder="contoh: Skincare alami, Wisata Bali, Kuliner Jawa..." />
                </div>

                <div className="form-group">
                  <label>Platform</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {PLATFORMS.map(p => (
                      <div key={p} onClick={() => setHashPlatform(p)} style={{
                        padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                        background: hashPlatform === p ? '#7F77DD' : '#f5f4f2',
                        color: hashPlatform === p ? '#fff' : '#666'
                      }}>{p}</div>
                    ))}
                  </div>
                </div>

                <button className="btn-primary" style={{ width: '100%', padding: 10 }}
                  onClick={generateHashtags} disabled={loading}>
                  {loading ? '⟳ Generating...' : '#️⃣ Generate 20 Hashtag'}
                </button>
              </div>
            </div>

            <div>
              {hashResults.length > 0 ? (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div className="card-title" style={{ margin: 0 }}>✅ {hashResults.length} Hashtag</div>
                    <button className="btn-secondary" style={{ fontSize: 12 }}
                      onClick={() => copyToClipboard(hashResults.join(' '))}>
                      📋 Copy Semua
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {hashResults.map((h, i) => (
                      <div key={i} onClick={() => copyToClipboard(h)} style={{
                        padding: '5px 12px', background: '#EEEDFE', borderRadius: 20,
                        fontSize: 12, color: '#534AB7', cursor: 'pointer'
                      }}>{h}</div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: 10, background: '#E6F1FB', borderRadius: 8, fontSize: 12, color: '#185FA5' }}>
                    💡 Klik hashtag untuk menyalin satu per satu, atau "Copy Semua" untuk sekaligus
                  </div>
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>#️⃣</div>
                  <div>Generate hashtag relevan untuk meningkatkan jangkauan konten</div>
                </div>
              )}
            </div>
          </div>
        )}
        {/* Berita & Tren */}
        {activeTab === 'news' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              {[{ key: 'berita', label: '📰 Scrape Berita' }, { key: 'trends', label: '🔥 Google Trends ID' }].map(t => (
                <div key={t.key} onClick={() => { if (t.key === 'trends' && !trendsResults.length) scrapeTrends(); }} style={tabStyle(t.key === 'berita' ? 'news_berita' : 'news_trends')}>
                  {t.label}
                </div>
              ))}
            </div>

            <div className="two-col" style={{ alignItems: 'start' }}>
              {/* News */}
              <div>
                <div className="card">
                  <div className="card-title">📰 Ambil Berita Terkini</div>
                  <div className="form-group">
                    <label>Sumber Berita</label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {NEWS_SOURCES.map(s => (
                        <div key={s} onClick={() => setNewsSources(prev => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; })} style={{
                          padding: '5px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 12,
                          background: newsSources.has(s) ? '#7F77DD' : '#f5f4f2',
                          color: newsSources.has(s) ? '#fff' : '#666', textTransform: 'capitalize'
                        }}>{s}</div>
                      ))}
                    </div>
                  </div>
                  <div className="form-group">
                    <label>Filter Kata Kunci (opsional)</label>
                    <input type="text" value={newsKeyword} onChange={e => setNewsKeyword(e.target.value)}
                      placeholder="contoh: ekonomi, kesehatan, teknologi..." />
                  </div>
                  <div className="form-group">
                    <label>Jumlah Berita: {newsLimit}</label>
                    <input type="range" min="5" max="30" value={newsLimit} onChange={e => setNewsLimit(Number(e.target.value))} />
                  </div>
                  <button className="btn-primary" style={{ width: '100%', padding: 10 }} onClick={scrapeNews} disabled={loading}>
                    {loading ? '⟳ Mengambil...' : '📰 Ambil Berita'}
                  </button>
                </div>

                {/* Trends */}
                <div className="card" style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div className="card-title" style={{ margin: 0 }}>🔥 Google Trends Indonesia</div>
                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={scrapeTrends} disabled={loading}>
                      {loading ? '⟳' : '↻ Refresh'}
                    </button>
                  </div>
                  {trendsResults.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {trendsResults.map((t, i) => (
                        <div key={i} onClick={() => { setCgTema(t); setActiveTab('content'); toast.success('Tema dipindah ke Content Generator!'); }}
                          style={{ padding: '5px 12px', background: '#FFF3E0', borderRadius: 20, fontSize: 12, color: '#E65100', cursor: 'pointer', border: '1px solid #FFB74D' }}>
                          🔥 {t}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', color: '#aaa', padding: '20px 0', fontSize: 12 }}>Klik Refresh untuk ambil trending topic</div>
                  )}
                  <div style={{ fontSize: 11, color: '#888', marginTop: 10 }}>💡 Klik trend untuk langsung gunakan sebagai tema Content Generator</div>
                </div>
              </div>

              {/* News Results */}
              <div>
                {newsResults.length > 0 ? (
                  <div className="card">
                    <div className="card-title">{newsResults.length} Berita Terkini</div>
                    <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                      {newsResults.map((a, i) => (
                        <div key={i} style={{ borderBottom: '0.5px solid rgba(0,0,0,0.06)', paddingBottom: 12, marginBottom: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4, marginBottom: 4 }}>{a.title}</div>
                              <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#aaa' }}>
                                <span style={{ background: '#f0f0f0', padding: '1px 8px', borderRadius: 10, textTransform: 'capitalize' }}>{a.source}</span>
                                {a.pubDate && <span>{dayjs(a.pubDate).format('DD MMM HH:mm')}</span>}
                              </div>
                              {a.description && <div style={{ fontSize: 11, color: '#888', marginTop: 4, lineHeight: 1.5 }}>{a.description?.slice(0, 120)}...</div>}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                              <button onClick={() => { setCgTema(a.title); setCgData(a.description || ''); setActiveTab('content'); }}
                                style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: '#534AB7', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                → Content Gen
                              </button>
                              {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer"
                                style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: '#f0f0f0', color: '#666', textAlign: 'center', textDecoration: 'none' }}>
                                Buka ↗
                              </a>}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="card" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                    <div style={{ fontSize: 48, marginBottom: 12 }}>📰</div>
                    <div>Scrape berita terkini dari 6 sumber media Indonesia terpercaya</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Imagen B-roll */}
        {activeTab === 'imagen' && (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">🖼️ Imagen B-roll Generator</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                  Generate gambar B-roll realistis 9:16 untuk TikTok/Reels menggunakan Gemini Imagen
                </div>
                <div className="form-group">
                  <label>Deskripsi Gambar (dalam Bahasa Inggris) *</label>
                  <textarea value={imgPrompt} onChange={e => setImgPrompt(e.target.value)} rows={4}
                    placeholder="contoh: A person using smartphone in a modern coffee shop, warm lighting, bokeh background, vertical 9:16 format..." />
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>💡 Gunakan prompt dari Content Generator atau tulis sendiri dalam Bahasa Inggris</div>
                </div>
                <button className="btn-primary" style={{ width: '100%', padding: 10 }}
                  onClick={generateImagen} disabled={loading}>
                  {loading ? '⟳ Generating (15-30 detik)...' : '🖼️ Generate Gambar'}
                </button>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 8, textAlign: 'center' }}>
                  Powered by Gemini 2.5 Flash Preview • Membutuhkan API key aktif
                </div>
              </div>
            </div>

            <div>
              {imgResult ? (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div className="card-title" style={{ margin: 0 }}>✅ Gambar B-roll</div>
                    <a href={`data:${imgResult.mimeType};base64,${imgResult.base64}`} download="broll-imagen.png"
                      style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, background: '#534AB7', color: '#fff', textDecoration: 'none' }}>
                      ⬇️ Download
                    </a>
                  </div>
                  <img src={`data:${imgResult.mimeType};base64,${imgResult.base64}`} alt="B-roll"
                    style={{ width: '100%', borderRadius: 8, maxHeight: 500, objectFit: 'contain' }} />
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>🖼️</div>
                  <div>Generate gambar B-roll realistis vertikal 9:16 untuk konten video</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sentiment Analysis */}
        {activeTab === 'sentiment' && (
          <div className="two-col" style={{ alignItems: 'start' }}>
            <div>
              <div className="card">
                <div className="card-title">📊 Analisis Sentimen</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
                  Analisis sentimen dari judul berita atau teks lainnya — positif, negatif, atau netral
                </div>
                <div className="form-group">
                  <label>Daftar Teks (satu per baris) *</label>
                  <textarea value={sentTexts} onChange={e => setSentTexts(e.target.value)} rows={8}
                    placeholder="Masukkan judul berita atau teks, satu per baris:&#10;Harga BBM naik lagi mulai bulan ini&#10;Ekonomi Indonesia tumbuh 5% di kuartal ini&#10;Banjir melanda Jakarta hari ini..." />
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>💡 Copy judul berita dari tab Berita & Tren, lalu paste di sini</div>
                </div>
                <button className="btn-primary" style={{ width: '100%', padding: 10 }}
                  onClick={analyzeSentiment} disabled={loading}>
                  {loading ? '⟳ Menganalisis...' : '📊 Analisis Sentimen'}
                </button>
              </div>
            </div>

            <div>
              {sentResults ? (
                <div className="card">
                  <div className="card-title">Hasil Analisis</div>
                  {sentResults.summary && (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                      {[
                        { label: 'Positif', value: sentResults.summary.positif, color: '#1D9E75', bg: '#EAF3DE' },
                        { label: 'Negatif', value: sentResults.summary.negatif, color: '#E24B4A', bg: '#FDECEC' },
                        { label: 'Netral',  value: sentResults.summary.netral,  color: '#888',    bg: '#f5f4f2' },
                      ].map(s => (
                        <div key={s.label} style={{ flex: 1, textAlign: 'center', background: s.bg, borderRadius: 8, padding: '10px 0' }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
                          <div style={{ fontSize: 11, color: s.color }}>{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {sentResults.results?.map((r, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '0.5px solid rgba(0,0,0,0.06)', alignItems: 'flex-start' }}>
                        <div style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, flexShrink: 0, marginTop: 2,
                          background: r.sentiment === 'positif' ? '#EAF3DE' : r.sentiment === 'negatif' ? '#FDECEC' : '#f5f4f2',
                          color: r.sentiment === 'positif' ? '#1D9E75' : r.sentiment === 'negatif' ? '#E24B4A' : '#888',
                        }}>{r.sentiment}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, lineHeight: 1.5 }}>{r.text}</div>
                          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{r.reason}</div>
                        </div>
                        <div style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>{Math.round((r.score || 0) * 100)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>
                  <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
                  <div>Analisis sentimen positif/negatif/netral dari judul berita atau teks</div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
