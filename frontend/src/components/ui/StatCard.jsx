import React from 'react';

export default function StatCard({ label, value, sub, icon, trend, trendUp }) {
  return (
    <div className="stat-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="stat-label">{label}</div>
        {icon && (
          <div style={{
            width: 32, height: 32, borderRadius: 'var(--radius-sm)',
            background: 'var(--color-primary-light)',
            color: 'var(--color-primary)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {icon}
          </div>
        )}
      </div>
      <div className="stat-value">{value}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
        {trend && (
          <span style={{
            fontSize: 'var(--font-xs)',
            fontWeight: 600,
            color: trendUp ? 'var(--color-success)' : 'var(--color-error)',
          }}>
            {trendUp ? '↑' : '↓'} {trend}
          </span>
        )}
        {sub && (
          <span style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}
