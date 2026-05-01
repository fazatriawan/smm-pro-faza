import React from 'react';

export default function Skeleton({ width, height = 16, circle = false, style = {} }) {
  return (
    <div
      style={{
        width: width || '100%',
        height: circle ? height : height,
        borderRadius: circle ? '50%' : 'var(--radius-md)',
        background: 'var(--color-border)',
        animation: 'shimmer 1.5s ease-in-out infinite',
        ...style,
      }}
    />
  );
}
