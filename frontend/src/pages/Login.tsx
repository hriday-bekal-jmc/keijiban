import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../lib/api'
import { BookOpen } from 'lucide-react'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID

export default function Login() {
  const { login } = useAuth()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    const init = () => {
      if (!window.google?.accounts?.id || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: async ({ credential }: { credential: string }) => {
          setError(null)
          setLoading(true)
          try {
            await api.post('/auth/google', { idToken: credential })
            login()
          } catch (err) {
            console.error('Login failed:', err)
            // Server-provided messages (rate limit, domain restriction) are
            // meaningful — show them. Transport-level failures (HTTP 5xx,
            // network) get a friendly retry message instead of "HTTP 500".
            const msg = typeof err === 'string' && !/^(HTTP \d|Internal server error|Failed to fetch|NetworkError)/i.test(err)
              ? err
              : 'サーバーに接続できませんでした。数秒後にもう一度お試しください。'
            setError(msg)
          } finally {
            setLoading(false)
          }
        },
      })
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        width: 280,
        locale: 'ja',
      })
    }

    // The Google GSI script is async — the 'load' event has already fired
    // by the time React mounts in a Vite SPA, so we poll instead.
    if (window.google) {
      init()
      return () => { window.google?.accounts?.id?.cancel?.() }
    }
    const poll = setInterval(() => {
      if (window.google) { clearInterval(poll); init() }
    }, 50)
    return () => {
      clearInterval(poll)
      window.google?.accounts?.id?.cancel?.()
    }
  }, [login])

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4" style={{ background: '#F4EDDA' }}>
      <div
        className="flex flex-col items-center gap-8 w-full max-w-sm p-10 rounded-3xl"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', boxShadow: '0 4px 24px rgba(60,30,10,0.07)' }}
      >
        {/* Logo */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg, #E8732A, #F5A460)', boxShadow: '0 4px 16px rgba(232,115,42,0.34)' }}
        >
          <BookOpen size={28} strokeWidth={2.4} color="white" />
        </div>

        <div className="text-center">
          <h1 className="font-extrabold text-2xl text-brand-dark" style={{ letterSpacing: '-0.4px' }}>JMC Board</h1>
          <p className="text-brand-muted text-[13px] mt-1">JMC 社内掲示板</p>
        </div>

        {/* Keep button div always mounted so Google SDK never loses its container.
            Overlay the spinner so the button re-appears immediately after failure. */}
        <div style={{ position: 'relative', minHeight: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div ref={buttonRef} />
          {loading && (
            <div
              style={{
                position: 'absolute', inset: 0,
                background: '#FFFDF7',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              }}
            >
              <div className="w-4 h-4 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
              <span className="text-brand-muted text-[13px]">サインイン中…</span>
            </div>
          )}
        </div>

        {error && (
          <div className="w-full px-4 py-3 rounded-xl text-[12.5px] font-semibold text-center"
            style={{ background: '#FDE8D0', color: '#C05A18', border: '1px solid #F0C898' }}>
            {error}
          </div>
        )}

        <p className="text-[11.5px] text-brand-muted text-center">
          @jmc-ltd.co.jp アカウントでサインイン
        </p>
      </div>
    </div>
  )
}
