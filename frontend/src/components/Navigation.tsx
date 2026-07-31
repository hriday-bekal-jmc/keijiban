import { useLayoutEffect, useRef, useState } from 'react'
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

interface PillBox { x: number; y: number; width: number; height: number }

export default function Navigation({ activeTab, setActiveTab, unreadCount, onCompose, canPost = true }: NavigationProps) {
  // Which button the pill sits on.
  //
  // Not every screen has a button: 検索 and 管理 open from the header, and a post
  // opened by direct link belongs to no tab. On those the pill stays where it
  // was and fades out, rather than disappearing and reappearing elsewhere.
  const owner = useRef<string>(NAV.some(n => n.id === activeTab) ? activeTab : 'feed')
  if (NAV.some(n => n.id === activeTab)) owner.current = activeTab

  /*
   * The pill is one element positioned from the bar's own coordinates, rather
   * than a `layoutId` shared between the buttons.
   *
   * Shared-layout projection measures elements in document space. This bar is
   * position: fixed, and switching tabs usually changes the page height — going
   * from a scrolled feed to a short profile clamps scrollTop to 0. Framer
   * snapshots the outgoing pill before that scroll change and measures the
   * incoming one after, so the scroll distance ends up in the animation as
   * vertical travel: the pill visibly flew up from below the screen, but only
   * ever after scrolling, and never from the top of the page. `layoutRoot` did
   * not help.
   *
   * offsetLeft/offsetTop are relative to the bar (its `position: fixed` makes
   * it the offsetParent), so nothing here can be perturbed by page scroll.
   */
  const btnRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const [pill, setPill] = useState<PillBox | null>(null)

  useLayoutEffect(() => {
    const el = btnRefs.current[owner.current]
    if (!el) return

    const measure = (): void => setPill({
      x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight,
    })
    measure()

    // Button widths change when the labels appear at the `sm` breakpoint and
    // when the notification badge shows, so re-measure instead of assuming.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [owner.current, canPost, unreadCount > 0])

  const pillVisible = NAV.some(n => n.id === activeTab)

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
      {/* Sliding pill. Sits behind the buttons (they carry zIndex 1). */}
      {pill && (
        <motion.span
          className="absolute top-0 left-0 rounded-full"
          style={{ background: '#E8732A' }}
          initial={false}
          animate={{
            x: pill.x, y: pill.y,
            width: pill.width, height: pill.height,
            opacity: pillVisible ? 1 : 0,
          }}
          transition={PILL_SPRING}
        />
      )}

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
              className="relative w-10 h-10 rounded-full flex items-center justify-center text-white mx-1"
              style={{ background: '#3A2A1A', zIndex: 1 }}
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
            ref={el => { btnRefs.current[id] = el }}
            onClick={() => setActiveTab(id)}
            whileTap={{ scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 600, damping: 28 }}
            className="relative flex items-center gap-1.5 px-3.5 py-2 rounded-full text-sm font-bold"
            // No background on the button itself — the sliding pill provides it
            style={{ color: isActive ? '#FFFFFF' : '#A8906E', zIndex: 1 }}
          >
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
