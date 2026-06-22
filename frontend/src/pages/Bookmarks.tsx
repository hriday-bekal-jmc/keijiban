import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bookmark, Calendar, Pin } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'

// ── shared types ─────────────────────────────────────────────────────────────

interface SavedPost {
  id: string
  title: string
  content: string
  post_type: string
  event_date: string | null
  is_pinned: boolean
  author_name: string
  author_dept: string
  created_at: string
  bookmarked_at?: string
  likes_count: number
  comments_count: number
}

// ── type badge colors ─────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, { bg: string; color: string; label: string }> = {
  ANNOUNCEMENT: { bg: '#FDE8D0', color: '#B84A0E', label: '📢 お知らせ' },
  KNOWLEDGE:    { bg: '#D8EAF8', color: '#1E5FA8', label: '📚 ナレッジ' },
  DAILY_REPORT: { bg: '#D6F0E4', color: '#1A7A48', label: '📊 日報' },
  CHAT:         { bg: '#F0E8F8', color: '#6B35A8', label: '💬 雑談' },
  DEPARTMENT:   { bg: '#E8F0E0', color: '#2E6818', label: '🏢 部署' },
}

// ── compact post row ──────────────────────────────────────────────────────────

interface PostRowProps {
  post: SavedPost
  action?: React.ReactNode
  idx?: number
}

function PostRow({ post, action, idx = 0 }: PostRowProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const tc = TYPE_COLOR[post.post_type] ?? TYPE_COLOR.CHAT

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(idx * 0.04, 0.3) }}
      onClick={() => navigate(`/posts/${post.id}`, { state: { background: location } })}
      className="flex items-start gap-3 px-4 py-3.5 rounded-2xl cursor-pointer transition-all"
      style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.boxShadow = '0 3px 14px rgba(100,60,10,0.09)'}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Type colour bar */}
      <div className="w-1 self-stretch rounded-full flex-shrink-0" style={{ background: tc.color, minHeight: 36 }} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: tc.bg, color: tc.color }}>
            {tc.label}
          </span>
          {post.event_date && (
            <span className="text-[9.5px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1" style={{ background: '#FDE8D0', color: '#B84A0E' }}>
              📅 {new Date(post.event_date).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <div className="font-extrabold text-brand-dark text-[13.5px] leading-snug mb-1 truncate" style={{ letterSpacing: '-0.2px' }}>
          {post.title}
        </div>
        <div className="text-[11px] text-brand-muted">
          {post.author_name} · {post.author_dept} · {new Date(post.created_at).toLocaleDateString('ja-JP')}
        </div>
      </div>

      {action && (
        <div onClick={(e) => e.stopPropagation()}>
          {action}
        </div>
      )}
    </motion.div>
  )
}

// ── saved posts tab ───────────────────────────────────────────────────────────

function SavedTab() {
  const queryClient = useQueryClient()
  const toast = useToast()

  const { data, isLoading } = useQuery<{ bookmarks: SavedPost[] }>({
    queryKey: ['bookmarks'],
    queryFn: () => api.get('/bookmarks'),
    staleTime: 30_000,
  })

  const remove = useMutation<void, Error, string>({
    mutationFn: (postId) => api.delete(`/bookmarks/${postId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
      toast.success('保存を解除しました')
    },
  })

  if (isLoading) return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: '#E4D4B8' }} />
      ))}
    </div>
  )

  const items = data?.bookmarks ?? []

  if (items.length === 0) return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4">🔖</div>
      <div className="font-extrabold text-brand-dark text-base mb-2">保存した投稿がありません</div>
      <div className="text-brand-muted text-[13px]">投稿の右下のブックマークアイコンで保存できます</div>
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      {items.map((p, i) => (
        <PostRow
          key={p.id}
          post={p}
          idx={i}
          action={
            <button
              onClick={() => remove.mutate(p.id)}
              className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors flex-shrink-0"
              style={{ background: '#F0E8D8', color: '#A8906E' }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#FDE8D0'; e.currentTarget.style.color = '#E8732A' }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#F0E8D8'; e.currentTarget.style.color = '#A8906E' }}
            >
              解除
            </button>
          }
        />
      ))}
    </div>
  )
}

// ── events tab ────────────────────────────────────────────────────────────────

function EventsTab() {
  const { data, isLoading } = useQuery<{ events: SavedPost[] }>({
    queryKey: ['events'],
    queryFn: () => api.get('/bookmarks/events'),
    staleTime: 60_000,
  })
  const navigate = useNavigate()
  const location = useLocation()

  if (isLoading) return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: '#E4D4B8' }} />
      ))}
    </div>
  )

  const events = data?.events ?? []
  const now = new Date()
  const upcoming = events.filter(e => e.event_date && new Date(e.event_date) >= now)
  const past     = events.filter(e => e.event_date && new Date(e.event_date) < now)

  if (events.length === 0) return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4">📅</div>
      <div className="font-extrabold text-brand-dark text-base mb-2">イベントがありません</div>
      <div className="text-brand-muted text-[13px]">投稿作成時にイベント日時を設定するとここに表示されます</div>
    </div>
  )

  const EventItem = ({ e, i }: { e: SavedPost; i: number }) => {
    const d = new Date(e.event_date!)
    const tc = TYPE_COLOR[e.post_type] ?? TYPE_COLOR.CHAT
    const isToday = d.toDateString() === now.toDateString()

    return (
      <motion.div
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: Math.min(i * 0.04, 0.3) }}
        className="flex items-start gap-3 cursor-pointer"
        onClick={() => navigate(`/posts/${e.id}`, { state: { background: location } })}
      >
        {/* Date block */}
        <div
          className="flex-shrink-0 w-12 flex flex-col items-center justify-center rounded-2xl py-2 px-1"
          style={{
            background: isToday ? '#E8732A' : '#FFFDF7',
            border: `1.5px solid ${isToday ? '#E8732A' : '#E4D4B8'}`,
            color: isToday ? '#FFFDF7' : '#3A2A1A',
          }}
        >
          <span className="text-[10px] font-bold leading-none mb-0.5">
            {d.toLocaleDateString('ja-JP', { month: 'short' })}
          </span>
          <span className="text-[20px] font-extrabold leading-none">{d.getDate()}</span>
          <span className="text-[9px] font-semibold leading-none mt-0.5 opacity-70">
            {d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Content */}
        <div
          className="flex-1 min-w-0 px-4 py-3 rounded-2xl transition-all"
          style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
          onMouseEnter={(e2: React.MouseEvent<HTMLDivElement>) => e2.currentTarget.style.boxShadow = '0 3px 14px rgba(100,60,10,0.09)'}
          onMouseLeave={(e2: React.MouseEvent<HTMLDivElement>) => e2.currentTarget.style.boxShadow = 'none'}
        >
          <span className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: tc.bg, color: tc.color }}>
            {tc.label}
          </span>
          <div className="font-extrabold text-brand-dark text-[13.5px] leading-snug mt-1.5 mb-1 truncate" style={{ letterSpacing: '-0.2px' }}>
            {e.title}
          </div>
          <div className="text-[11px] text-brand-muted">{e.author_name} · {e.author_dept}</div>
        </div>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {upcoming.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3 font-bold text-[12px] text-brand-muted uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e' }} />
            今後のイベント
          </div>
          <div className="flex flex-col gap-3">
            {upcoming.map((e, i) => <EventItem key={e.id} e={e} i={i} />)}
          </div>
        </div>
      )}

      {past.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3 font-bold text-[12px] text-brand-muted uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#B8A890' }} />
            過去のイベント
          </div>
          <div className="flex flex-col gap-3 opacity-60">
            {past.map((e, i) => <EventItem key={e.id} e={e} i={i} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ── pinned tab ────────────────────────────────────────────────────────────────

interface PinnedResponse {
  posts: (SavedPost & { is_pinned: boolean })[]
}

function PinnedTab() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const isAdmin = user?.role === 'admin'

  const { data, isLoading } = useQuery<PinnedResponse>({
    queryKey: ['pinned-posts'],
    queryFn: () => api.get('/posts/pinned'),
    staleTime: 60_000,
  })

  const unpin = useMutation<void, Error, string>({
    mutationFn: (id) => api.delete(`/admin/posts/${id}/pin`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pinned-posts'] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      toast.success('ピン留めを解除しました')
    },
    onError: () => toast.error('ピン留めの解除に失敗しました'),
  })

  if (isLoading) return (
    <div className="flex flex-col gap-2">
      {[0, 1].map(i => (
        <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: '#E4D4B8' }} />
      ))}
    </div>
  )

  const items = data?.posts ?? []

  if (items.length === 0) return (
    <div className="text-center py-20">
      <div className="text-5xl mb-4">📌</div>
      <div className="font-extrabold text-brand-dark text-base mb-2">ピン留めされた投稿がありません</div>
      {isAdmin && (
        <div className="text-brand-muted text-[13px]">フィードの投稿メニューからピン留めできます</div>
      )}
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      {items.map((p, i) => (
        <PostRow
          key={p.id}
          post={p}
          idx={i}
          action={isAdmin ? (
            <button
              onClick={() => unpin.mutate(p.id)}
              className="text-[11px] font-bold px-3 py-1.5 rounded-full transition-colors flex-shrink-0 whitespace-nowrap"
              style={{ background: '#F0E8D8', color: '#A8906E' }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#FDE8D0'; e.currentTarget.style.color = '#E8732A' }}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = '#F0E8D8'; e.currentTarget.style.color = '#A8906E' }}
            >
              解除
            </button>
          ) : undefined}
        />
      ))}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

type TabId = 'saved' | 'events' | 'pinned'

const TABS: { id: TabId; label: string; Icon: typeof Bookmark }[] = [
  { id: 'saved',  label: '保存済み', Icon: Bookmark },
  { id: 'events', label: 'イベント', Icon: Calendar },
  { id: 'pinned', label: 'ピン留め', Icon: Pin },
]

export default function Bookmarks() {
  const [tab, setTab] = useState<TabId>('saved')

  return (
    <div className="max-w-[960px] mx-auto px-4 pt-0">
      {/* Sticky header */}
      <div
        className="sticky z-40 py-3 mb-4"
        style={{
          top: 56,
          background: 'rgba(244,237,218,0.96)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(200,175,130,0.30)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 font-extrabold text-[17px] text-brand-dark" style={{ letterSpacing: '-0.4px' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: '#E8732A' }} />
            保存・イベント
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1" style={{ background: 'rgba(58,42,26,0.06)', borderRadius: 12, padding: 3 }}>
          {TABS.map(({ id, label, Icon }) => {
            const active = tab === id
            return (
              <motion.button
                key={id}
                onClick={() => setTab(id)}
                whileTap={{ scale: 0.93 }}
                transition={{ type: 'spring', stiffness: 480, damping: 30, mass: 0.7 }}
                className="relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-[12px] font-bold"
                style={{ color: active ? '#E8732A' : '#8A7A68' }}
              >
                {active && (
                  <motion.span
                    layoutId="bookmark-tab-pill"
                    className="absolute inset-0 rounded-[9px]"
                    style={{ background: '#FFFDF7', boxShadow: '0 1px 4px rgba(60,30,10,0.08)' }}
                    transition={{ type: 'spring', stiffness: 480, damping: 30, mass: 0.7 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  <Icon size={13} strokeWidth={active ? 2.5 : 2} />
                  {label}
                </span>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-[600px] mx-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
          >
            {tab === 'saved'  && <SavedTab />}
            {tab === 'events' && <EventsTab />}
            {tab === 'pinned' && <PinnedTab />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
