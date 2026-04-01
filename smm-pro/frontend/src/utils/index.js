export const PLATFORMS = {
  youtube:   { label: 'YouTube',   short: 'YT', color: '#D85A30', bg: '#FAECE7', text: '#993C1D' },
  instagram: { label: 'Instagram', short: 'IG', color: '#D4537E', bg: '#FBEAF0', text: '#993556' },
  facebook:  { label: 'Facebook',  short: 'FB', color: '#378ADD', bg: '#E6F1FB', text: '#185FA5' },
  twitter:   { label: 'X/Twitter', short: 'X',  color: '#888780', bg: '#F1EFE8', text: '#5F5E5A' },
  tiktok:    { label: 'TikTok',    short: 'TT', color: '#639922', bg: '#EAF3DE', text: '#3B6D11' },
};

export const PLATFORM_KEYS = Object.keys(PLATFORMS);

export const PlatformPill = ({ platform, size = 'md' }) => {
  const p = PLATFORMS[platform];
  if (!p) return null;
  const style = {
    display: 'inline-flex', alignItems: 'center',
    fontSize: size === 'sm' ? 10 : 11,
    padding: size === 'sm' ? '2px 6px' : '3px 8px',
    borderRadius: 20, fontWeight: 500,
    background: p.bg, color: p.text,
  };
  return <span style={style}>{p.short}</span>;
};

export const StatusBadge = ({ status }) => {
  const map = {
    sent:      { label: 'Terkirim',  bg: '#EAF3DE', color: '#3B6D11' },
    completed: { label: 'Selesai',   bg: '#EAF3DE', color: '#3B6D11' },
    pending:   { label: 'Menunggu',  bg: '#FAEEDA', color: '#854F0B' },
    scheduled: { label: 'Terjadwal', bg: '#EEEDFE', color: '#534AB7' },
    sending:   { label: 'Mengirim',  bg: '#E6F1FB', color: '#185FA5' },
    failed:    { label: 'Gagal',     bg: '#FCEBEB', color: '#A32D2D' },
    partial:   { label: 'Sebagian',  bg: '#FAEEDA', color: '#854F0B' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 20,
      background: s.bg, color: s.color, fontWeight: 500
    }}>{s.label}</span>
  );
};

export const Avatar = ({ name = '', size = 32 }) => {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: '#E6F1FB', color: '#185FA5',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 500, flexShrink: 0
    }}>{initials || '?'}</div>
  );
};

export const formatNumber = (n) => {
  if (!n && n !== 0) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
};

export const timeAgo = (date) => {
  const diff = (Date.now() - new Date(date)) / 1000;
  if (diff < 60) return `${Math.floor(diff)}d lalu`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}j lalu`;
  return `${Math.floor(diff / 86400)}h lalu`;
};
