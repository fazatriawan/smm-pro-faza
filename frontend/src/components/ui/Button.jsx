import React from 'react';
import Spinner from './Spinner';

const VARIANTS = {
  primary: {
    bg: 'var(--color-primary)',
    color: '#fff',
    border: 'none',
    hoverBg: 'var(--color-primary-hover)',
  },
  secondary: {
    bg: 'transparent',
    color: 'var(--color-text-primary)',
    border: '1px solid var(--color-border)',
    hoverBg: 'var(--color-background-subtle)',
  },
  ghost: {
    bg: 'transparent',
    color: 'var(--color-text-secondary)',
    border: 'none',
    hoverBg: 'var(--color-background-subtle)',
  },
  danger: {
    bg: 'var(--color-error)',
    color: '#fff',
    border: 'none',
    hoverBg: 'var(--color-error-dark)',
  },
};

const SIZES = {
  sm: { padding: '6px 12px', fontSize: 'var(--font-xs)' },
  md: { padding: '8px 16px', fontSize: 'var(--font-small)' },
  lg: { padding: '10px 20px', fontSize: 'var(--font-body)' },
};

export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  onClick,
  type = 'button',
  style = {},
  ...props
}) {
  const v = VARIANTS[variant] || VARIANTS.primary;
  const s = SIZES[size] || SIZES.md;
  const isDisabled = disabled || loading;

  return (
    <button
      type={type}
      disabled={isDisabled}
      onClick={onClick}
      {...props}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontWeight: 500,
        borderRadius: 'var(--radius-sm)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.6 : 1,
        transition: 'background var(--transition-fast), transform var(--transition-fast), box-shadow var(--transition-fast)',
        background: v.bg,
        color: v.color,
        border: v.border,
        ...s,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!isDisabled) e.currentTarget.style.background = v.hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = v.bg;
        e.currentTarget.style.transform = 'scale(1)';
      }}
      onMouseDown={(e) => {
        if (!isDisabled) e.currentTarget.style.transform = 'scale(0.97)';
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      {loading && <Spinner size={14} color={v.color} />}
      {!loading && iconLeft}
      {children}
      {!loading && iconRight}
    </button>
  );
}
