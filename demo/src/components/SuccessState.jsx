import React, { useState } from 'react'
import { Check, Copy, Refresh, Link as LinkIcon, Mail, Trash, Clock, Shield, Lock } from './Icons'

const expLabels = {
  download: 'deleted after first download',
  '2d':      'expires in 2 days',
  '10d':     'expires in 10 days'
}

function formatBytes(n) {
  const u = ['B', 'KiB', 'MiB', 'GiB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

export default function SuccessState({ data, onReset }) {
  const [copied, setCopied] = useState(false)
  const [email, setEmail] = useState({ recipients: '', message: '', sent: false })

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.link)
    } catch {}
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const sendEmail = (e) => {
    e.preventDefault()
    setEmail(s => ({ ...s, sent: true }))
  }

  return (
    <div className="animate-fadeIn space-y-4">
      {/* Confirmation hero */}
      <div className="card overflow-hidden">
        <div className="relative px-6 pt-8 pb-6 text-center bg-gradient-to-b from-mint-50/70 to-white">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-mint-500 text-white shadow-lift animate-pop">
            <Check width={28} height={28} />
          </span>
          <h2 className="mt-4 text-xl font-bold text-ink-800">Your file is ready to share</h2>
          <p className="mt-1 text-sm text-ink-500">Link will {expLabels[data.exp] || 'expire soon'}.</p>
        </div>

        {/* File summary */}
        <div className="px-6 py-5 border-t border-ink-100">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink-800 truncate">{data.fileName}</p>
              <p className="text-xs text-ink-500 mt-0.5">{formatBytes(data.fileSize)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {data.advanced.pin && (
                <span className="chip"><Lock width={12} height={12} /> PIN</span>
              )}
              {data.advanced.unlisted && (
                <span className="chip"><Shield width={12} height={12} /> unlisted</span>
              )}
              <span className="chip"><Clock width={12} height={12} /> {data.exp}</span>
            </div>
          </div>
        </div>

        {/* Share link */}
        <div className="px-6 pb-6">
          <label className="text-xs font-semibold text-ink-600 uppercase tracking-wide">Sharing link</label>
          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 flex items-center rounded-x2 ring-1 ring-ink-200 bg-ink-50/60 focus-within:ring-2 focus-within:ring-mint-300 pl-10">
              <LinkIcon width={16} height={16} className="absolute left-3 text-ink-400" />
              <input readOnly value={data.link}
                onFocus={e => e.target.select()}
                className="w-full bg-transparent px-3 py-3 text-sm font-mono text-ink-700 truncate focus:outline-none"
              />
            </div>
            <button onClick={copy}
              className={`btn-primary px-4 py-3 transition ${copied ? 'bg-mint-600 hover:bg-mint-700 active:bg-mint-700' : ''}`}>
              {copied ? <><Check width={16} height={16} /> Copied</> : <><Copy width={16} height={16} /> Copy link</>}
            </button>
          </div>
          <p className="mt-2 text-xs text-ink-500">
            Anyone with this link {data.advanced.unlisted ? '(and the URL)' : ''} can download until expiration.
          </p>
        </div>
      </div>

      {/* Email delivery — appears after upload */}
      <div className="card">
        <div className="flex items-center gap-2 px-6 pt-5 pb-4 border-b border-ink-100">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-mint-50 text-mint-600">
            <Mail />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-ink-800">Send to recipients</h3>
            <p className="text-xs text-ink-500">Optional — deliver the link by email now that it’s ready.</p>
          </div>
        </div>

        {email.sent ? (
          <div className="px-6 py-6 text-center animate-fadeIn">
            <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-mint-50 text-mint-600">
              <Check width={20} height={20} />
            </span>
            <p className="mt-3 text-sm font-medium text-ink-800">Delivery queued</p>
            <p className="text-xs text-ink-500 mt-1">Recipients will get the link shortly.</p>
          </div>
        ) : (
          <form onSubmit={sendEmail} className="px-6 py-5 space-y-3">
            <div>
              <label className="text-xs font-semibold text-ink-600">Recipients</label>
              <input
                type="text"
                value={email.recipients}
                onChange={e => setEmail(s => ({ ...s, recipients: e.target.value }))}
                placeholder="alice@example.com, bob@example.com"
                className="field mt-1.5"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-ink-600">Message (optional)</label>
              <textarea
                rows={3}
                value={email.message}
                onChange={e => setEmail(s => ({ ...s, message: e.target.value }))}
                placeholder="Here’s the file we discussed."
                className="field mt-1.5 resize-none"
              />
            </div>
            <div className="flex items-center justify-between pt-1">
              <p className="text-xs text-ink-500">Emails are sent privately — no tracking pixels.</p>
              <button type="submit" className="btn-primary px-4 py-2.5">Deliver link</button>
            </div>
          </form>
        )}
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onReset} className="btn-ghost py-2.5 px-4 text-sm">
          <Refresh width={15} height={15} /> Send another file
        </button>
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-400">
          <Trash width={13} height={13} /> You can delete this share at any time from the link page.
        </span>
      </div>
    </div>
  )
}