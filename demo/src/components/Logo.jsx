import React from 'react'

export default function Logo({ size = 26, withText = true }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-grid place-items-center rounded-xl text-white shadow-soft"
        style={{
          width: size, height: size,
          background: 'linear-gradient(140deg,#34d27e,#069a4f)'
        }}
      >
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 16V4M12 4l-4 4M12 4l4 4"/>
          <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
        </svg>
      </span>
      {withText && (
        <span className="text-[15px] font-bold tracking-tight text-ink-800">
          drop2<span className="text-mint-600">.app</span>
        </span>
      )}
    </span>
  )
}