import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notifAPI } from '../api';
import { useNotifStore } from '../store';
import { PLATFORMS } from '../utils';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/id';
dayjs.extend(relativeTime);
dayjs.locale('id');

const TABS = [
  { key: 'all', label: 'Semua' },
  ...Object.entries(PLATFORMS).map(([k, v]) => ({ key: k, label: v.label }))
];

const TYPE_ICONS = { like: '♥', comment: '◎', follow: '◉', mention: '@', share: '↗', dm: '✉', system: '⚙' };

export default function NotificationsPage() {
  const [activePlatform, setActivePlatform] = useState('all');
  const qc = useQueryClient();
  const { markAllRead } = useNotifStore();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications', activePlatform],
    queryFn: () => notifAPI.getAll({
      platform: activePlatform === 'all' ? undefined : activePlatform,
      limit: 100
    }).then(r => r.data),
    refetchInterval: 30000,
  });

  const markRead = useMutation({
    mutationFn: (id) => notifAPI.markRead(id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
    }
  });

  const markAll = useMutation({
    mutationFn: () => notifAPI.markAllRead(),
    onSuccess: () => { markAllRead(); qc.invalidateQueries({ queryKey: ['notifications'] }); }
  });

  const notifications = data?.notifications || MOCK_NOTIFS;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Notifikasi Terpusat</span>
        <div className="page-actions">
          {(data?.unreadCount || 0) > 0 && (
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => markAll.mutate()}>
              Tandai semua dibaca
            </button>
          )}
        </div>
      </div>
      <div className="page-content">
        <div className="card">
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: '0.5px solid rgba(0,0,0,0.08)', paddingBottom: 0, overflowX: 'auto' }}>
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActivePlatform(t.key)} style={{
                padding: '7px 14px', fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                background: 'none', border: 'none',
                color: activePlatform === t.key ? '#534AB7' : '#888',
                borderBottom: `2px solid ${activePlatform === t.key ? '#7F77DD' : 'transparent'}`,
                fontWeight: activePlatform === t.key ? 500 : 400,
                transition: 'all 0.12s'
              }}>{t.label}</button>
            ))}
          </div>

          {isLoading ? (
            <div className="empty-state">Memuat notifikasi...</div>
          ) : notifications.length === 0 ? (
            <div className="empty-state">Tidak ada notifikasi</div>
          ) : notifications.map((n, i) => {
            const p = PLATFORMS[n.platform];
            return (
              <div key={n._id || i}
                onClick={() => !n.isRead && markRead.mutate(n._id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 0',
                  borderBottom: '0.5px solid rgba(0,0,0,0.06)',
                  background: n.isRead ? 'transparent' : 'rgba(127,119,221,0.03)',
                  cursor: n.isRead ? 'default' : 'pointer',
                }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flexShrink: 0, marginTop: 5,
                  background: n.isRead ? 'transparent' : '#7F77DD',
                }} />
                <div style={{
                  width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                  background: p?.bg || '#f0efec', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, color: p?.text || '#666', fontWeight: 600,
                }}>
                  {TYPE_ICONS[n.type] || '◈'}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, marginBottom: 2, fontWeight: n.isRead ? 400 : 500 }}>
                    {n.content}
                  </div>
                  <div style={{ fontSize: 11, color: '#aaa' }}>
                    {p?.label || n.platform} · @{n.account?.platformUsername || n.account?.label || '—'} · {dayjs(n.receivedAt).fromNow()}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const MOCK_NOTIFS = [
  { platform: 'instagram', type: 'comment', content: '@shopee_id mengomentari: "Keren banget produknya!"', isRead: false, receivedAt: new Date(Date.now() - 120000), account: { platformUsername: 'brand_official' } },
  { platform: 'tiktok',   type: 'like',    content: 'Video kamu masuk FYP! Sudah 10K views dalam 1 jam', isRead: false, receivedAt: new Date(Date.now() - 900000), account: { platformUsername: 'viral_content' } },
  { platform: 'youtube',  type: 'follow',  content: 'Channel kamu mendapat 50 subscriber baru hari ini', isRead: false, receivedAt: new Date(Date.now() - 3600000), account: { platformUsername: 'brand_official' } },
  { platform: 'facebook', type: 'share',   content: 'Post kamu di-share 120 kali', isRead: true,  receivedAt: new Date(Date.now() - 7200000), account: { platformUsername: 'promo_store' } },
  { platform: 'twitter',  type: 'mention', content: 'Tweet kamu trending di #TopikHariIni', isRead: false, receivedAt: new Date(Date.now() - 10800000), account: { platformUsername: 'trend_id' } },
  { platform: 'instagram',type: 'like',    content: 'Story kamu dilihat 5.420 akun', isRead: true,  receivedAt: new Date(Date.now() - 14400000), account: { platformUsername: 'konten_kita' } },
  { platform: 'tiktok',   type: 'comment', content: 'Duet request dari @kreator_besar', isRead: false, receivedAt: new Date(Date.now() - 18000000), account: { platformUsername: 'viral_content' } },
];
