import React from 'react'
import { useState } from 'react'
import AdvancedOptions from './AdvancedOptions'
import { UploadIcon, FileIcon, ChevronDown, Clock, Check } from './Icons'

const expirations = [
  { id: 'download', label: 'After download', short: 'delete after download' },
  { id: '2d',       label: 'After 2 days',    short: '2 days' },
  { id: '10d',      label: 'After 10 days',   short: '10 days' }
]

function formatBytes(n) {
  if (!n) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export default function UploadForm({ onUploaded }) {
  const [file, setFile] = useState(null)
  const [exp, setExp] = useState('2d')
  const [expanded, setExpanded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [advanced, setAdvanced] = useState({
    pin: false, pinValue: '', unlisted: false, notify: false, singleUse: false
  })
  const inputRef = React.useRef(null)

  const tooBig = file && file.size > 10 * 1024 * 1024

  const selectFile = (f) => {
    if (!f) return
    setFile(f)
  }

  const submit = () => {
    if (!file || tooBig) return
    // demo: fabricate a share outcome
    const link = `https://drop2.app/d/${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 6)}`
    onUploaded({
      fileName: file.name,
      fileSize: file.size,
      exp,
      advanced,
      link,
      createdAt: Date.now()
    })
  }

  return (
    <div className="card overflow-hidden animate-fadeIn">
      {/* Header strip */}
      <div className="px-6 pt-6 pb-4 border-b border-ink-100">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-mint-50 text-mint-600">
            <UploadIcon />
          </span>
          <div>
            <h2 className="text-base font-semibold text-ink-800 leading-tight">Send a file</h2>
            <p className="text-xs text-ink-500">Up to 10 MiB anonymously — no account needed.</p>
          </div>
        </div>
      </div>

      {/* Dropzone */}
      <div className="p-6">
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault(); setDragging(false)
            if (e.dataTransfer.files?.[0]) selectFile(e.dataTransfer.files[0])
          }}
          className={`group relative cursor-pointer rounded-x3 border-2 border-dashed px-5 py-8 text-center transition
            ${dragging ? 'border-mint-400 bg-mint-50/60' : 'border-ink-200 hover:border-mint-300 hover:bg-ink-50/60'}
            ${file ? 'py-5' : ''}`}
        >
          <input ref={inputRef} type="file" className="hidden"
            onChange={e => selectFile(e.target.files?.[0])} />

          {file ? (
            <div className="flex items-center gap-3 text-left">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-mint-50 text-mint-600 ring-1 ring-mint-100">
                <FileIcon width={20} height={20} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink-800">{file.name}</p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {formatBytes(file.size)}
                  {tooBig && <span className="text-red-500 font-medium"> · exceeds 10 MiB limit</span>}
                </p>
              </div>
              {!tooBig && (
                <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2.5 py-1 text-xs font-medium text-mint-600">
                  <Check width={14} height={14} /> ready
                </span>
              )}
              <button type="button" onClick={e => { e.stopPropagation(); setFile(null) }}
                className="text-xs font-medium text-ink-400 hover:text-ink-700 px-2 py-1">
                change
              </button>
            </div>
          ) : (
            <>
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ink-100 text-ink-500 group-hover:text-mint-600 transition">
                <UploadIcon width={22} height={22} />
              </span>
              <p className="mt-3 text-sm font-semibold text-ink-700">Choose a file</p>
              <p className="mt-1 text-xs text-ink-500">or drag & drop it here</p>
            </>
          )}
        </div>

        {/* Expiration */}
        <div className="mt-5">
          <label className="text-xs font-semibold text-ink-600 uppercase tracking-wide flex items-center gap-1.5">
            <Clock width={14} height={14} /> Delete
          </label>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {expirations.map(e => {
              const active = exp === e.id
              return (
                <button key={e.id} type="button" onClick={() => setExp(e.id)}
                  className={`rounded-x2 px-3 py-2.5 text-sm font-medium transition text-center
                    ${active
                      ? 'bg-mint-600 text-white shadow-soft'
                      : 'bg-white text-ink-700 ring-1 ring-ink-200 hover:bg-ink-50'}`}>
                  {e.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Advanced */}
        <div className="mt-5 rounded-x2 border border-ink-100 overflow-hidden bg-ink-50/40">
          <button type="button" onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-ink-700 hover:bg-ink-50 transition">
            <span className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-white text-ink-500 ring-1 ring-ink-200">
                <SparkleSmall />
              </span>
              Advanced options
            </span>
            <ChevronDown className={`text-ink-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
          <div className={`grid transition-all duration-300 ease-out
            ${expanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
            <div className="overflow-hidden">
              <div className="px-4 pb-2 pt-1">
                <AdvancedOptions opts={advanced} set={setAdvanced} />
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-500 hidden sm:block">
            Files are end-to-end encrypted and never analyzed.
          </p>
          <button onClick={submit} disabled={!file || tooBig}
            className="btn-primary w-full sm:w-auto px-5 py-3">
            Send securely
          </button>
        </div>
      </div>
    </div>
  )
}

function SparkleSmall() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>
    </svg>
  )
}