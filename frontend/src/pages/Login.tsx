import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { api, ApiError } from '../lib/api'
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
            // Retry once on a transient failure: the API can be momentarily
            // unreachable during a restart or rolling deploy, and the user
            // should not have to click sign-in a second time. Rejections
            // (401 bad token, 403 wrong domain, 429 rate limit) are final and
            // are never retried — verifying the same id token again is safe.
            try {
              await api.post('/auth/google', { idToken: credential })
            } catch (err) {
              if (!(err instanceof ApiError) || !err.isTransient) throw err
              await new Promise(r => setTimeout(r, 800))
              await api.post('/auth/google', { idToken: credential })
            }
            login()
          } catch (err) {
            console.error('Login failed:', err)
            // Server-provided messages (rate limit, domain restriction) are
            // meaningful — show them. Transport failures get a friendly retry
            // message rather than a raw "HTTP 500".
            const msg = err instanceof ApiError && !err.isTransient
              ? err.message
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

        {/* ⚠️ TEST-ONLY LOGIN — remove this block and TestLogin below. See TEST_LOGIN.md.
            import.meta.env.DEV is false in `npm run build`, so this is dead code
            eliminated from the production bundle — it cannot ship by accident. */}
        {import.meta.env.DEV && <TestLogin onDone={login} />}
      </div>
    </div>
  )
}

// ⚠️ TEST-ONLY LOGIN — everything below this line is removable in one delete.
function TestLogin({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [users, setUsers] = useState<TestUser[]>([])

  // The picker is a convenience — the email box works on its own if it fails.
  useEffect(() => {
    api.get('/test-login/users')
      .then(d => setUsers((d as { users: TestUser[] }).users))
      .catch(() => { /* backend gate is off; the email box still shows */ })
  }, [])

  const submit = async (value: string) => {
    if (!value.trim()) return
    setErr(null)
    setBusy(true)
    try {
      await api.post('/test-login', { email: value.trim() })
      onDone()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'テストログインに失敗しました')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full flex flex-col gap-2 pt-4" style={{ borderTop: '1px dashed #E4D4B8' }}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide text-center" style={{ color: '#C05A18' }}>
        ⚠️ テストログイン（開発用）
      </div>

      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void submit(email) }}>
        <input
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="user@jmc-ltd.co.jp"
          className="flex-1 min-w-0 px-3 py-2 rounded-xl text-[13px] text-brand-dark outline-none"
          style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          className="px-4 py-2 rounded-xl text-[13px] font-extrabold text-white disabled:opacity-40 flex-shrink-0"
          style={{ background: '#3A2A1A' }}
        >
          {busy ? '…' : 'ログイン'}
        </button>
      </form>

      {users.length > 0 && (
        <select
          value=""
          onChange={e => { setEmail(e.target.value); void submit(e.target.value) }}
          className="w-full px-3 py-2 rounded-xl text-[12px] text-brand-dark outline-none"
          style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
        >
          <option value="">ユーザーを選んで即ログイン…</option>
          {users.map(u => (
            <option key={u.id} value={u.email}>
              {u.full_name}（{u.role === 'admin' ? '管理者' : u.department_name}
              {u.branch_name ? ` / ${u.branch_name}` : ' / 拠点なし'}
              {u.can_post ? '' : ' / 投稿不可'}）
            </option>
          ))}
        </select>
      )}

      {err && (
        <div className="text-[11.5px] font-semibold text-center" style={{ color: '#C05A18' }}>{err}</div>
      )}
    </div>
  )
}

interface TestUser {
  id: string
  email: string
  full_name: string
  role: 'member' | 'admin'
  department_name: string
  branch_name: string | null
  can_post: boolean
}
