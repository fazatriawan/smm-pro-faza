import React from 'react';

export default function Avatar({ name = '', src, size = 32, style = {} }) {
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const fontSize = size * 0.35;

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
          ...style,
        }}
      />
    );
  }

  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: 'var(--color-primary-light)',
      color: 'var(--color-primary-dark)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize,
      fontWeight: 600,
      flexShrink: 0,
      userSelect: 'none',
      ...style,
    }}>
      {initials || '?'}
    </div>
  );
}
