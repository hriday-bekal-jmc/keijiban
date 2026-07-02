import { Search, BookOpen, Shield } from 'lucide-react'
import { initials as initialsOf } from '../lib/postMeta'
import type { User } from '../types'

interface AppHeaderProps {
  user: User | null | undefined
  searchQuery: string
  onSearch: (q: string) => void
  onSearchClear: () => void
  onAdmin?: () => void
}

export default function AppHeader({ user, searchQuery, onSearch, onSearchClear, onAdmin }: AppHeaderProps) {
  const initials = initialsOf(user?.full_name)

  return (
    <div
      className="sticky top-0 z-50"
      style={{ background: 'rgba(244,237,218,0.96)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(200,175,130,0.38)' }}
    >
      <div className="max-w-[960px] mx-auto h-14 flex items-center gap-2 sm:gap-3 px-4">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div
            className="w-8 h-8 rounded-[9px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #E8732A, #F5A460)', boxShadow: '0 2px 10px rgba(232,115,42,0.34)' }}
          >
            <BookOpen size={15} strokeWidth={2.4} color="white" />
          </div>
          <span className="hidden sm:block font-extrabold text-base tracking-tight text-brand-dark" style={{ letterSpacing: '-0.4px' }}>
            JMC Board
          </span>
        </div>

        {/* Search */}
        <div className="flex-1 relative min-w-0">
          <Search
            size={13}
            strokeWidth={2.5}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            color="#A8906E"
          />
          <input
            type="text"
            placeholder="検索…"
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const v = e.target.value
              if (v) onSearch(v)
              else onSearchClear()
            }}
            className="w-full pl-8 pr-4 py-1.5 rounded-full text-[13px] text-brand-dark outline-none transition-all"
            style={{
              background: '#FFFDF7',
              border: '1.5px solid #E4D4B8',
            }}
            onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#E8732A'}
            onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#E4D4B8'}
          />
        </div>

        {/* Right: dept badge (desktop only) + admin + avatar */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {user?.role === 'admin' && onAdmin && (
            <button
              onClick={onAdmin}
              className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
              style={{ background: '#FDE8D0', color: '#C05A18' }}
              title="管理パネル"
            >
              <Shield size={13} strokeWidth={2.5} />
            </button>
          )}
          {user?.department_name && (
            <div
              className="hidden sm:block text-[10.5px] font-bold px-3 py-0.5 rounded-full max-w-[120px] truncate"
              style={{ background: '#FDE8D0', color: '#C05A18' }}
            >
              {user.department_name}
            </div>
          )}
          {user?.avatar_url ? (
            <img
              src={user.avatar_url}
              alt={user.full_name}
              className="w-8 h-8 rounded-full object-cover cursor-pointer flex-shrink-0"
              style={{ boxShadow: '0 2px 8px rgba(232,115,42,0.28)' }}
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold text-[11px] cursor-pointer flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #E87040, #F5A460)', boxShadow: '0 2px 8px rgba(232,115,42,0.28)' }}
            >
              {initials}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
