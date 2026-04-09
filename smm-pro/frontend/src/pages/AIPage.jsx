import React, { useState } from 'react';
import { aiAPI } from '../api';
import toast from 'react-hot-toast';

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

  return (
    <div>
      <div className="page-header">
        <span className="page-title">✨ AI Content Generator</span>
        <div style={{ fontSize: 12, color: '#888' }}>Powered by Gemini AI</div>
      </div>

      <div className="page-content">
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { key: 'caption', label: '📝 Caption Generator' },
            { key: 'comment', label: '💬 Komentar AI' },
            { key: 'hashtag', label: '#️⃣ Hashtag Generator' },
          ].map(t => (
            <div key={t.key} onClick={() => setActiveTab(t.key)} style={{
              padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              background: activeTab === t.key ? '#EEEDFE' : '#f5f4f2',
              color: activeTab === t.key ? '#534AB7' : '#888',
              fontWeight: activeTab === t.key ? 500 : 400,
              fontSize: 13, border: `1.5px solid ${activeTab === t.key ? '#7F77DD' : 'transparent'}`
            }}>{t.label}</div>
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
      </div>
    </div>
  );
}
