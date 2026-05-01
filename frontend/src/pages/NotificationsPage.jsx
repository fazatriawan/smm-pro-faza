import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Heart,
  MessageCircle,
  UserPlus,
  AtSign,
  Share,
  Mail,
  Settings,
  Bell,
  CheckCheck,
} from 'lucide-react';
import { notifAPI } from '../api';
import { useNotifStore } from '../store';
import { PLATFORMS } from '../utils';
import {
  Button,
  Card,
  Badge,
  Skeleton,
  EmptyState,
} from '../components/ui';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/id';
dayjs.extend(relativeTime);
dayjs.locale('id');

const TABS = [
  { key: 'all', label: 'Semua' },
  ...Object.entries(PLATFORMS).map(([k, v]) => ({ key: k, label: v.label }))
];

const TYPE_ICONS = {
  like: Heart,
  comment: MessageCircle,
  follow: UserPlus,
  mention: AtSign,
  share: Share,
  dm: Mail,
  system: Settings,
};

const TYPE_LABELS = {
  like: 'Suka',
  comment: 'Komentar',
  follow: 'Follow',
  mention: 'Mention',
  share: 'Share',
  dm: 'Pesan',
  system: 'Sistem',
};

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
  const unreadCount = data?.unreadCount || 0;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Notifikasi Terpusat</span>
        <div className="page-actions">
          {unreadCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => markAll.mutate()}
              iconLeft={<CheckCheck size={14} />}
              loading={markAll.isPending}
            >
              Tandai semua dibaca
            </Button>
          )}
        </div>
      </div>
      <div className="page-content">
        <Card>
          <div className="tab-bar">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`tab ${activePlatform === t.key ? 'active' : ''}`}
                onClick={() => setActivePlatform(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-3">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-start gap-3">
                  <Skeleton width={32} height={32} circle />
                  <div style={{ flex: 1 }}>
                    <Skeleton height={16} width="60%" />
                    <Skeleton height={12} width="40%" style={{ marginTop: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <EmptyState
              icon={<Bell size={40} />}
              title="Tidak ada notifikasi"
              description="Notifikasi dari semua platform akan muncul di sini"
            />
          ) : (
            <div className="notification-list">
              {notifications.map((n, i) => {
                const p = PLATFORMS[n.platform];
                const Icon = TYPE_ICONS[n.type] || Settings;
                return (
                  <div
                    key={n._id || i}
                    className={`notification-item ${!n.isRead ? 'unread' : ''}`}
                    onClick={() => !n.isRead && markRead.mutate(n._id)}
                  >
                    <div className="notification-dot" style={{ background: n.isRead ? 'transparent' : 'var(--color-primary)' }} />
                    <div
                      className="notification-icon-box"
                      style={{ background: p?.bg || 'var(--color-background-subtle)' }}
                    >
                      <Icon size={16} style={{ color: p?.text || 'var(--color-text-secondary)' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-small" style={{ marginBottom: 2, fontWeight: !n.isRead ? 600 : 400 }}>
                        {n.content}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="default" size="sm">
                          {TYPE_LABELS[n.type] || n.type}
                        </Badge>
                        <span className="text-xs text-tertiary">
                          {p?.label || n.platform} · @{n.account?.platformUsername || n.account?.label || '—'} · {dayjs(n.receivedAt).fromNow()}
                        </span>
                      </div>
                    </div>
                    {!n.isRead && (
                      <Badge variant="info" size="sm">Baru</Badge>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const MOCK_NOTIFS = [
  { _id: 'mock-1', platform: 'instagram', type: 'comment', content: '@shopee_id mengomentari: "Keren banget produknya!"', isRead: false, receivedAt: new Date(Date.now() - 120000), account: { platformUsername: 'brand_official' } },
  { _id: 'mock-2', platform: 'tiktok',   type: 'like',    content: 'Video kamu masuk FYP! Sudah 10K views dalam 1 jam', isRead: false, receivedAt: new Date(Date.now() - 900000), account: { platformUsername: 'viral_content' } },
  { _id: 'mock-3', platform: 'youtube',  type: 'follow',  content: 'Channel kamu mendapat 50 subscriber baru hari ini', isRead: false, receivedAt: new Date(Date.now() - 3600000), account: { platformUsername: 'brand_official' } },
  { _id: 'mock-4', platform: 'facebook', type: 'share',   content: 'Post kamu di-share 120 kali', isRead: true,  receivedAt: new Date(Date.now() - 7200000), account: { platformUsername: 'promo_store' } },
  { _id: 'mock-5', platform: 'twitter',  type: 'mention', content: 'Tweet kamu trending di #TopikHariIni', isRead: false, receivedAt: new Date(Date.now() - 10800000), account: { platformUsername: 'trend_id' } },
  { _id: 'mock-6', platform: 'instagram',type: 'like',    content: 'Story kamu dilihat 5.420 akun', isRead: true,  receivedAt: new Date(Date.now() - 14400000), account: { platformUsername: 'konten_kita' } },
  { _id: 'mock-7', platform: 'tiktok',   type: 'comment', content: 'Duet request dari @kreator_besar', isRead: false, receivedAt: new Date(Date.now() - 18000000), account: { platformUsername: 'viral_content' } },
];
