import { useAuth } from '../contexts/AuthContext'
import { initials as initialsOf } from '../lib/postMeta'

interface QuickComposerProps {
  onOpen: () => void
}

export default function QuickComposer({ onOpen }: QuickComposerProps) {
  const { user } = useAuth()
  const initials = initialsOf(user?.full_name)

  return (
    <div
      className="flex gap-2.5 p-3.5 mb-3 transition-shadow"
      style={{
        background: '#FFFDF7',
        border: '1px solid #E4D4B8',
        borderRadius: 14,
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.boxShadow = '0 2px 14px rgba(60,30,10,0.07)'}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Avatar */}
      {user?.avatar_url ? (
        <img src={user.avatar_url} alt={user.full_name ?? ''} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
      ) : (
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-[11.5px] flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, #E87040, #F5A460)' }}
        >
          {initials}
        </div>
      )}

      {/* Input area */}
      <div className="flex-1 min-w-0">
        <input
          type="text"
          placeholder="お知らせ、日報、アイデアをシェアしよう…"
          readOnly
          onClick={onOpen}
          className="w-full rounded-full px-4 py-2 text-[13px] text-brand-dark placeholder-brand-muted outline-none cursor-pointer transition-all"
          style={{ background: '#FAF5EC', border: '1.5px solid #E4D4B8' }}
          onFocus={(e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = '#E8732A'; e.target.style.background = '#FFFDF7' }}
          onBlur={(e: React.FocusEvent<HTMLInputElement>) => { e.target.style.borderColor = '#E4D4B8'; e.target.style.background = '#FAF5EC' }}
        />

        <div className="flex items-center justify-between mt-2.5 px-1">
          <div className="flex gap-0.5">
            {/* Image */}
            <button
              className="p-1.5 rounded-full transition-all text-brand-muted"
              style={{ }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#FDE8D0'; e.currentTarget.style.color = '#E8732A' }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            {/* Attach */}
            <button
              className="p-1.5 rounded-full transition-all text-brand-muted"
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#FDE8D0'; e.currentTarget.style.color = '#E8732A' }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>
          </div>
          <button
            onClick={onOpen}
            className="text-white text-[12.5px] font-bold px-4 py-1.5 rounded-full transition-all active:scale-95"
            style={{ background: '#3A2A1A' }}
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.style.background = '#1A1206'}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.style.background = '#3A2A1A'}
          >
            投稿
          </button>
        </div>
      </div>
    </div>
  )
}
