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
        callback: async ({ credential }: { credential: string }) => {
          setError(null)
          setLoading(true)
          try {
            const { user } = await api.post<{ user: Parameters<typeof login>[0] }>('/auth/google', { idToken: credential })
            login(user)
          } catch (err) {
            console.error('Login failed:', err)
            setError(typeof err === 'string' ? err : 'ログインに失敗しました。もう一度お試しください。')
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
    if (window.google) init()
    else window.addEventListener('load', init, { once: true })
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

        {loading ? (
          <div className="flex items-center gap-2 text-brand-muted text-[13px]">
            <div className="w-4 h-4 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
            サインイン中…
          </div>
        ) : (
          <div ref={buttonRef} />
        )}

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
