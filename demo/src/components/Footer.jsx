import React from 'react'

const links = [
  { label: 'FAQ', href: '#faq' },
  { label: 'Contact', href: '#contact' },
  { label: 'Privacy', href: '#privacy' },
  { label: 'Terms', href: '#terms' },
  { label: 'Status', href: '#status' }
]

export default function Footer() {
  return (
    <footer className="mt-20 border-t border-ink-100 bg-ink-50/60">
      <div className="mx-auto max-w-5xl px-5 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <p className="text-xs text-ink-500 order-2 sm:order-1">
          © {new Date().getFullYear()} drop2.app — made for sending files, not storing them.
        </p>
        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 order-1 sm:order-2">
          {links.map(l => (
            <a key={l.href} href={l.href} className="text-xs font-medium link-soft">{l.label}</a>
          ))}
        </nav>
      </div>
    </footer>
  )
}