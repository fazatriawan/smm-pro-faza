import React from 'react';

export default function Card({ children, header, headerAction, padding = 'var(--space-4)', className = '', style = {}, hover = false }) {
  return (
    <div
      className={className}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-sm)',
        overflow: 'hidden',
        transition: hover ? 'box-shadow var(--transition-normal), transform var(--transition-normal)' : 'none',
        ...style,
      }}
      onMouseEnter={hover ? (e) => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.transform = 'translateY(-1px)'; } : undefined}
      onMouseLeave={hover ? (e) => { e.currentTarget.style.boxShadow = 'var(--shadow-sm)'; e.currentTarget.style.transform = 'translateY(0)'; } : undefined}
    >
      {header && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}>
          <span style={{ fontSize: 'var(--font-small)', fontWeight: 600, color: 'var(--color-text-primary)' }}>{header}</span>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div style={{ padding }}>{children}</div>
    </div>
  );
}
