import React from 'react'
import Logo from './Logo'

export default function Header() {
  return (
    <header className="sticky top-0 z-30 backdrop-blur-md bg-ink-50/70 border-b border-ink-100">
      <div className="mx-auto max-w-5xl px-5 h-14 flex items-center justify-between">
        <Logo />
        <nav className="flex items-center gap-1.5">
          <a href="#how" className="hidden sm:inline-flex px-3 py-2 text-sm font-medium link-soft">How it works</a>
          <a href="#pricing" className="hidden sm:inline-flex px-3 py-2 text-sm font-medium link-soft">Pricing</a>
          <a href="/login" className="btn-ghost text-sm py-2 px-3.5">Log in</a>
        </nav>
      </div>
    </header>
  )
}