import { useState, useRef, useCallback, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api'

export interface PublicUser {
  id: string
  full_name: string
  avatar_url: string | null
  role: string
  can_post: boolean
  department_name: string
  vibe_emoji: string | null
  vibe_label: string | null
  posts_count: number
  comments_made: number
}

interface UserHoverCardProps {
  userId: string
  userName: string
  children: ReactNode
}

const COLORS = ['#7A5C30','#C05A18','#1E5FA8','#1A7A48','#6B35A8','#C07090']

function colorFor(id: string) {
  let n = 0
  for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i)) % COLORS.length
  return COLORS[n]
}

export function UserHoverCard({ userId, userName, children }: UserHoverCardProps) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const [visible, setVisible] = useState(false)
  const [pos, setPos]         = useState({ top: 0, left: 0 })

  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)

  // Fetch once per session — staleTime: Infinity means never re-fetch while data exists.
  // gcTime: 30 min keeps it in memory between hovers without re-requesting.
  // To force a refresh (e.g. after avatar change), invalidate ['user-preview', userId].
  const { data } = useQuery<{ user: PublicUser }>({
    queryKey: ['user-preview', userId],
    queryFn: () => api.get(`/users/${userId}`),
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000,
    enabled: visible,
  })

  const cancelHide = useCallback(() => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null }
  }, [])

  const scheduleHide = useCallback(() => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null }
    // 120ms grace period — cursor moving from trigger → card won't dismiss it
    hideTimer.current = setTimeout(() => setVisible(false), 120)
  }, [])

  const handleTriggerEnter = useCallback(() => {
    cancelHide()
    showTimer.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect  = triggerRef.current.getBoundingClientRect()
        const cardW = 216
        const left  = Math.min(rect.left, window.innerWidth - cardW - 12)
        setPos({ top: rect.bottom + 6, left: Math.max(8, left) })
      }
      setVisible(true)
    }, 450)
  }, [cancelHide])

  const handleTriggerLeave = useCallback(() => {
    if (showTimer.current) { clearTimeout(showTimer.current); showTimer.current = null }
    scheduleHide()
  }, [scheduleHide])

  const openPanel = (e: React.MouseEvent) => {
    e.stopPropagation()
    cancelHide()
    setVisible(false)
    // Never nest modal backgrounds: if we're already inside a modal (e.g. PostDetail at /posts/:id),
    // use that modal's own background (the feed root) — not the current modal URL.
    const existingBg = (location.state as { background?: unknown } | null)?.background
    navigate(`/users/${userId}`, { state: { background: existingBg ?? location } })
  }

  const user     = data?.user
  const initials = (user?.full_name ?? userName).split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleTriggerEnter}
        onMouseLeave={handleTriggerLeave}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="inline-flex cursor-pointer"
      >
        {children}
      </div>

      <AnimatePresence>
        {visible && (
          <motion.div
            key="hover-card"
            initial={{ opacity: 0, y: 6, scale: 0.93 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.93, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
            className="fixed z-[200] w-54 rounded-2xl p-3.5 shadow-2xl"
            style={{
              top: pos.top,
              left: pos.left,
              width: 216,
              background: '#FFFDF7',
              border: '1px solid #E4D4B8',
              pointerEvents: 'auto',
            }}
          >
            {/* Avatar + name row */}
            <div className="flex items-center gap-2.5 mb-2.5">
              {user?.avatar_url ? (
                <img
                  src={user.avatar_url}
                  alt={user.full_name}
                  className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                  style={{ boxShadow: '0 0 0 2.5px #F4EDDA' }}
                />
              ) : (
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-extrabold text-[12px] flex-shrink-0"
                  style={{ background: user ? colorFor(user.id) : '#C05A18', boxShadow: '0 0 0 2.5px #F4EDDA' }}
                >
                  {initials}
                </div>
              )}
              <div className="min-w-0">
                <div className="font-extrabold text-[12.5px] text-brand-dark truncate leading-tight">
                  {user?.full_name ?? userName}
                </div>
                <div className="text-[10px] text-brand-muted truncate">{user?.department_name ?? '…'}</div>
              </div>
            </div>

            {/* Vibe */}
            {user?.vibe_emoji && (
              <div
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full mb-2 text-[10.5px] font-semibold"
                style={{ background: '#FDE8D0', color: '#C05A18' }}
              >
                <span>{user.vibe_emoji}</span>
                <span>{user.vibe_label}</span>
              </div>
            )}

            {/* CTA */}
            <button
              onClick={openPanel}
              className="w-full py-2 rounded-xl text-[11px] font-extrabold active:scale-95 transition-transform"
              style={{ background: '#3A2A1A', color: '#FFFDF7' }}
            >
              プロフィールを見る →
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
