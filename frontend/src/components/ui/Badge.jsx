import React from 'react';

const VARIANTS = {
  default:  { bg: 'var(--color-primary-light)',   color: 'var(--color-primary-dark)' },
  success:  { bg: 'var(--color-success-light)',   color: 'var(--color-success-dark)' },
  warning:  { bg: 'var(--color-warning-light)',   color: 'var(--color-warning-dark)' },
  error:    { bg: 'var(--color-error-light)',     color: 'var(--color-error-dark)' },
  info:     { bg: 'var(--color-info-light)',      color: 'var(--color-info-dark)' },
};

const SIZES = {
  sm: { fontSize: 'var(--font-xs)', padding: '1px 6px' },
  md: { fontSize: 'var(--font-caption)', padding: '2px 8px' },
};

export default function Badge({ children, variant = 'default', size = 'md', style = {} }) {
  const v = VARIANTS[variant] || VARIANTS.default;
  const s = SIZES[size] || SIZES.md;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontWeight: 500,
      borderRadius: 'var(--radius-full)',
      background: v.bg,
      color: v.color,
      ...s,
      ...style,
    }}>
      {children}
    </span>
  );
}
