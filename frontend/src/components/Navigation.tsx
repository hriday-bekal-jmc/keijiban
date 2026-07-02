import { motion } from 'framer-motion'
import { Home, Bell, Plus, Bookmark, User, LucideIcon } from 'lucide-react'

interface NavItem {
  id: string
  Icon: LucideIcon
  label: string | null
  isCompose?: boolean
}

const NAV: NavItem[] = [
  { id: 'feed',          Icon: Home,     label: 'ホーム' },
  { id: 'notifications', Icon: Bell,     label: '通知' },
  { id: 'compose',       Icon: Plus,     label: null, isCompose: true },
  { id: 'bookmarks',     Icon: Bookmark, label: '保存' },
  { id: 'profile',       Icon: User,     label: 'プロフィール' },
]

interface NavigationProps {
  activeTab: string
  setActiveTab: (tab: string) => void
  unreadCount: number
  onCompose: () => void
  canPost?: boolean
}

// Bouncy spring — feels like a physical object sliding along the dock
const PILL_SPRING = { type: 'spring', stiffness: 500, damping: 32, mass: 0.8 } as const

export default function Navigation({ activeTab, setActiveTab, unreadCount, onCompose, canPost = true }: NavigationProps) {
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-50 flex items-center gap-1 px-2 py-1.5 rounded-full"
      style={{
        bottom: 'calc(1.75rem + env(safe-area-inset-bottom, 0px))',
        background: '#FFFDF7',
        border: '1px solid #E4D4B8',
        boxShadow: '0 8px 32px rgba(60,30,10,0.14)',
      }}
    >
      {NAV.map(({ id, Icon, label, isCompose }) => {
        if (isCompose) {
          // Hidden entirely when user lacks post permission
          if (!canPost) return null
          return (
            <motion.button
              key={id}
              onClick={onCompose}
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 600, damping: 28 }}
              className="w-10 h-10 rounded-full flex items-center justify-center text-white mx-1"
              style={{ background: '#3A2A1A' }}
            >
              <Icon size={20} strokeWidth={2.6} />
            </motion.button>
          )
        }

        const isActive = activeTab === id
        const showBadge = id === 'notifications' && unreadCount > 0

        return (
          <motion.button
            key={id}
            onClick={() => setActiveTab(id)}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 600, damping: 28 }}
            className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-bold"
            // No background on the button itself — the sliding pill provides it
            style={{ color: isActive ? '#FFFFFF' : '#A8906E', zIndex: 1 }}
          >
            {/* Sliding pill background — same layoutId across all buttons so
                Framer Motion physically moves one shared element between them */}
            {isActive && (
              <motion.span
                layoutId="nav-pill"
                className="absolute inset-0 rounded-full"
                style={{ background: '#E8732A' }}
                transition={PILL_SPRING}
              />
            )}

            <span className="relative z-10 flex items-center gap-1.5">
              <motion.span
                animate={{ scale: isActive ? 1.1 : 1 }}
                transition={PILL_SPRING}
              >
                <Icon size={18} strokeWidth={isActive ? 2.5 : 2} />
              </motion.span>
              <span className="hidden sm:block text-[12px]">{label}</span>
            </span>

            {showBadge && (
              <span
                className="absolute -top-1 -right-1 text-[9px] font-extrabold w-4 h-4 flex items-center justify-center rounded-full z-20"
                style={{
                  background: isActive ? '#FFFDF7' : '#E8732A',
                  color: isActive ? '#E8732A' : '#FFFDF7',
                  border: '2px solid #FFFDF7',
                }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
