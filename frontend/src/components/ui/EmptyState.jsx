import React from 'react';

export default function EmptyState({ icon, title, description, action }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '48px 24px',
      color: 'var(--color-text-tertiary)',
    }}>
      {icon && (
        <div style={{ marginBottom: 12, color: 'var(--color-text-tertiary)', opacity: 0.5 }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 'var(--font-small)', fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 'var(--font-caption)', color: 'var(--color-text-tertiary)' }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
