import { useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import UploadForm from './components/UploadForm'
import SuccessState from './components/SuccessState'
import { Lock, Clock, Globe } from './components/Icons'

export default function App() {
  const [result, setResult] = useState(null)

  return (
    <div className="min-h-screen flex flex-col bg-ink-50">
      <Header />

      <main className="flex-1">
        {/* Hero — tightened, premium */}
        <section className="mx-auto max-w-2xl px-5 pt-14 sm:pt-20 pb-3 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-ink-900 leading-[1.05] animate-fade-in">
            Send large files,
            <br className="hidden sm:block" />
            <span className="relative whitespace-nowrap">
              <span className="bg-gradient-to-r from-mint-600 to-mint-400 bg-clip-text text-transparent">
                simply.
              </span>
            </span>
          </h1>
          <p className="mt-4 text-base sm:text-lg text-ink-500 max-w-md mx-auto animate-fade-in">
            Minimal file sharing. No account, no clutter — just a link that disappears when it should.
          </p>
        </section>

        {/* Upload widget */}
        <section className="mx-auto max-w-2xl px-5 mt-6">
          {result ? (
            <SuccessState data={result} onReset={() => setResult(null)} />
          ) : (
            <>
              <UploadForm onUploaded={setResult} />

              {/* Quiet trust strip — inline, aligned, no card clutter */}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-500">
                <span className="inline-flex items-center gap-1.5">
                  <Lock width={14} height={14} className="text-mint-600" /> Private by default
                </span>
                <span className="hidden sm:inline-flex items-center gap-1.5">
                  <Clock width={14} height={14} className="text-mint-600" /> You set the expiration
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Globe width={14} height={14} className="text-mint-600" /> Direct & anonymous
                </span>
              </div>
            </>
          )}
        </section>
      </main>

      <Footer />
    </div>
  )
}