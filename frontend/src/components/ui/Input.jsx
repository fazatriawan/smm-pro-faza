import React from 'react';

export default function Input({
  label,
  helper,
  error,
  iconLeft,
  iconRight,
  size = 'md',
  fullWidth = true,
  style = {},
  inputStyle = {},
  ...props
}) {
  const sizes = {
    sm: { padding: '6px 10px', fontSize: 'var(--font-xs)', minHeight: 32 },
    md: { padding: '8px 12px', fontSize: 'var(--font-small)', minHeight: 40 },
    lg: { padding: '10px 14px', fontSize: 'var(--font-body)', minHeight: 44 },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div style={{ width: fullWidth ? '100%' : 'auto', ...style }}>
      {label && (
        <label style={{
          display: 'block',
          fontSize: 'var(--font-caption)',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: 'var(--space-1)',
        }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {iconLeft && (
          <span style={{ position: 'absolute', left: 10, color: 'var(--color-text-tertiary)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
            {iconLeft}
          </span>
        )}
        <input
          {...props}
          style={{
            width: '100%',
            background: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border)'}`,
            borderRadius: 'var(--radius-sm)',
            fontFamily: 'inherit',
            outline: 'none',
            transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
            paddingLeft: iconLeft ? 36 : s.padding.split(' ')[1],
            paddingRight: iconRight ? 36 : s.padding.split(' ')[1],
            ...s,
            ...inputStyle,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--color-border-focus)';
            e.currentTarget.style.boxShadow = '0 0 0 3px var(--color-primary-light)';
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error ? 'var(--color-error)' : 'var(--color-border)';
            e.currentTarget.style.boxShadow = 'none';
            props.onBlur?.(e);
          }}
        />
        {iconRight && (
          <span style={{ position: 'absolute', right: 10, color: 'var(--color-text-tertiary)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
            {iconRight}
          </span>
        )}
      </div>
      {helper && !error && (
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)', display: 'block' }}>
          {helper}
        </span>
      )}
      {error && (
        <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-error)', marginTop: 'var(--space-1)', display: 'block' }}>
          {error}
        </span>
      )}
    </div>
  );
}
