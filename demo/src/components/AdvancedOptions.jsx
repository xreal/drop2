import React from 'react'
import { Shield, Lock, Globe, Sparkle } from './Icons'

function Row({ icon: Icon, title, desc, children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block group">
      <div className="flex items-start gap-3 py-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-100 text-ink-600 group-hover:text-mint-600 transition">
          <Icon width={16} height={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-800">{title}</p>
          <p className="text-xs text-ink-500 mt-0.5">{desc}</p>
        </div>
        <div className="shrink-0">{children}</div>
      </div>
    </label>
  )
}

function Toggle({ checked, onChange, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition shadow-sm
        ${checked ? 'bg-mint-600' : 'bg-ink-200'}`}
    >
      <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow ring-1 ring-black/5 transition-transform
        ${checked ? 'translate-x-5' : ''}`} />
    </button>
  )
}

export default function AdvancedOptions({ opts, set }) {
  const setField = (k, v) => set({ ...opts, [k]: v })
  return (
    <div className="divide-y divide-ink-100">
      <Row icon={Shield} htmlFor="pin" title="PIN protect downloads"
        desc="Require a numeric PIN before anyone can download the file.">
        <Toggle id="pin" checked={opts.pin} onChange={v => setField('pin', v)} />
      </Row>
      {opts.pin && (
        <div className="animate-fadeIn px-3 pb-4 -mt-1">
          <div className="flex items-center gap-2 rounded-x2 bg-ink-50 p-2">
            <Lock width={16} height={16} className="text-ink-500" />
            <input
              type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
              value={opts.pinValue}
              onChange={e => setField('pinValue', e.target.value.replace(/\D/g, ''))}
              placeholder="Enter 4–6 digit PIN"
              className="field bg-white"
            />
          </div>
        </div>
      )}

      <Row icon={Globe} htmlFor="pub" title="Hide from public listings"
        desc="This link will only work if you have the exact URL.">
        <Toggle id="pub" checked={opts.unlisted} onChange={v => setField('unlisted', v)} />
      </Row>

      <Row icon={Sparkle} htmlFor="notify" title="Notify me when received"
        desc="Send me a confirmation when the file is first downloaded.">
        <Toggle id="notify" checked={opts.notify} onChange={v => setField('notify', v)} />
      </Row>

      <Row icon={Lock} htmlFor="once" title="Single-use download"
        desc="Auto-delete the moment one successful download completes.">
        <Toggle id="once" checked={opts.singleUse} onChange={v => setField('singleUse', v)} />
      </Row>
    </div>
  )
}