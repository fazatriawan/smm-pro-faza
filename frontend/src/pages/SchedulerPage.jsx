import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { scheduleAPI } from '../api';
import { PlatformPill, StatusBadge } from '../utils';
import { Button, Card, EmptyState } from '../components/ui';
import { Calendar, Clock, Plus, Save } from 'lucide-react';
import dayjs from 'dayjs';
import toast from 'react-hot-toast';

const DAILY_TEMPLATE = [
  { time: '07:00', platforms: ['instagram', 'tiktok'], label: 'Konten pagi' },
  { time: '10:00', platforms: ['facebook', 'twitter'], label: 'Update mid-morning' },
  { time: '12:00', platforms: ['instagram', 'facebook'], label: 'Promo siang' },
  { time: '15:00', platforms: ['tiktok', 'youtube'],   label: 'Video sore' },
  { time: '18:00', platforms: ['instagram', 'twitter'], label: 'Prime time' },
  { time: '21:00', platforms: ['facebook', 'tiktok'],  label: 'Recap malam' },
];

const mockPosts = Array.from({ length: 6 }, (_, i) => ({
  _id: String(i), caption: `Konten terjadwal ${i + 1} — caption singkat untuk preview`,
  scheduledAt: dayjs().add(i * 3, 'hour').toISOString(),
  status: i < 2 ? 'completed' : 'scheduled',
  targetAccounts: [
    { account: { platform: ['instagram','youtube','tiktok','facebook','twitter'][i % 5] } },
    { account: { platform: ['facebook','instagram','youtube'][i % 3] } },
  ]
}));

export default function SchedulerPage() {
  const qc = useQueryClient();
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['scheduled'],
    queryFn: () => scheduleAPI.getUpcoming({}).then(r => r.data)
  });

  const reschedule = useMutation({
    mutationFn: ({ id, scheduledAt }) => scheduleAPI.reschedule(id, scheduledAt),
    onSuccess: () => { toast.success('Jadwal diperbarui'); qc.invalidateQueries({ queryKey: ['scheduled'] }); }
  });

  const displayPosts = posts.length > 0 ? posts : mockPosts;

  return (
    <div>
      <div className="page-header">
        <span className="page-title">Scheduler</span>
        <div className="page-actions">
          <Button variant="secondary" size="sm" iconLeft={<Plus size={14} />}>
            Tambah Jadwal
          </Button>
        </div>
      </div>

      <div className="page-content">
        <div className="two-col">
          <Card header="Antrian Terjadwal" headerAction={
            <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
              {displayPosts.length} post
            </span>
          }>
            {isLoading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1,2,3].map(i => <div key={i} className="skeleton" style={{ height: 48 }} />)}
              </div>
            ) : displayPosts.length === 0 ? (
              <EmptyState
                icon={<Calendar size={40} />}
                title="Tidak ada post terjadwal"
                description="Jadwalkan post untuk otomatis terkirim"
              />
            ) : displayPosts.map((p, i) => (
              <div key={p._id || i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '10px 0',
                borderBottom: i < displayPosts.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              }}>
                <div style={{
                  fontSize: 'var(--font-caption)',
                  color: 'var(--color-text-tertiary)',
                  minWidth: 55, flexShrink: 0,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Clock size={14} style={{ marginBottom: 2 }} />
                  <span>{dayjs(p.scheduledAt).format('HH:mm')}</span>
                  <span style={{ fontSize: 'var(--font-xs)' }}>{dayjs(p.scheduledAt).format('DD/MM')}</span>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--font-small)', marginBottom: 4, color: 'var(--color-text-primary)' }}>
                    {p.caption?.slice(0, 50)}...
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {p.targetAccounts?.slice(0, 4).map((ta, j) => (
                      <PlatformPill key={j} platform={ta.account?.platform} size="sm" />
                    ))}
                  </div>
                </div>
                <StatusBadge status={p.status} />
              </div>
            ))}
          </Card>

          <Card header="Template Jadwal Harian" headerAction={
            <Button variant="ghost" size="sm" iconLeft={<Save size={14} />}>
              Simpan
            </Button>
          }>
            <div style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
              Jam post otomatis yang akan diulang setiap hari
            </div>
            {DAILY_TEMPLATE.map((t, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0',
                borderBottom: i < DAILY_TEMPLATE.length - 1 ? '1px solid var(--color-border-subtle)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 80 }}>
                  <Clock size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                  <span style={{ fontSize: 'var(--font-caption)', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                    {t.time}
                  </span>
                </div>
                <div style={{ flex: 1, fontSize: 'var(--font-caption)', color: 'var(--color-text-secondary)' }}>
                  {t.label}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {t.platforms.map(p => <PlatformPill key={p} platform={p} size="sm" />)}
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
