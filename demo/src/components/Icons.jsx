import React from 'react'

const base = (props) => ({
  width: 18, height: 18, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round', strokeLinejoin: 'round', ...props
})

export const UploadIcon = (p) => (
  <svg {...base(p)}><path d="M12 16V4M12 4l-4 4M12 4l4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
)
export const FileIcon = (p) => (
  <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>
)
export const ChevronDown = (p) => (
  <svg {...base(p)}><path d="M6 9l6 6 6-6"/></svg>
)
export const Check = (p) => (
  <svg {...base(p)}><path d="M5 12l5 5L20 7"/></svg>
)
export const Shield = (p) => (
  <svg {...base(p)}><path d="M12 3l8 4v6c0 5-3.5 7-8 8-4.5-1-8-3-8-8V7z"/><path d="M9 12l2 2 4-4"/></svg>
)
export const Mail = (p) => (
  <svg {...base(p)}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>
)
export const Copy = (p) => (
  <svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
)
export const Clock = (p) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
)
export const Lock = (p) => (
  <svg {...base(p)}><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
)
export const Sparkle = (p) => (
  <svg {...base(p)}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>
)
export const Trash = (p) => (
  <svg {...base(p)}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>
)
export const Link = (p) => (
  <svg {...base(p)}><path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/></svg>
)
export const ArrowRight = (p) => (
  <svg {...base(p)}><path d="M5 12h14M13 6l6 6-6 6"/></svg>
)
export const Globe = (p) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 4 3 14 0 18M12 3c-3 4-3 14 0 18"/></svg>
)
export const Refresh = (p) => (
  <svg {...base(p)}><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 4v4h-4"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 20v-4h4"/></svg>
)