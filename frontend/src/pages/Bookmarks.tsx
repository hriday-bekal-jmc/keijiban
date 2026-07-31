import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bookmark, Calendar, Pin } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { postTypeMeta } from '../lib/postMeta'
import { swap, SPRING } from '../lib/motion'

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

// ── compact post row ──────────────────────────────────────────────────────────

/** Skeleton block that matches the row rhythm, so the swap doesn't jolt. */
function RowSkeletons({ n = 3 }: { n?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: '#E4D4B8' }} />
      ))}
    </div>
  )
}

interface PostRowProps {
  post: SavedPost
  action?: React.ReactNode
}

// No initial/animate here on purpose: `variants` alone makes the row inherit
// its parent list's state, so the stagger is driven by one timeline instead of
// each row computing its own delay and drifting out of step.
function PostRow({ post, action }: PostRowProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const tc = postTypeMeta(post.post_type)

  return (
    <div
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
    </div>
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

  const remove = useMutation<void, Error, string, { prev?: { bookmarks: SavedPost[] } }>({
    mutationFn: (postId) => api.delete(`/bookmarks/${postId}`),
    // Optimistic removal — otherwise the row sits there until a full refetch
    // completes, which reads as lag for what should be an instant action.
    onMutate: (postId) => {
      const prev = queryClient.getQueryData<{ bookmarks: SavedPost[] }>(['bookmarks'])
      queryClient.setQueryData(['bookmarks'], (old: { bookmarks: SavedPost[] } | undefined) =>
        old ? { bookmarks: old.bookmarks.filter(b => b.id !== postId) } : old)
      return { prev }
    },
    onError: (_err, _postId, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['bookmarks'], ctx.prev)
      toast.error('解除に失敗しました')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
    },
    onSuccess: () => toast.success('保存を解除しました'),
  })

  const items = data?.bookmarks ?? []
  const state = isLoading ? 'loading' : items.length === 0 ? 'empty' : 'list'

  return (
    <AnimatePresence mode="wait">
      {state === 'loading' && (
        <motion.div key="loading" variants={swap} initial="hidden" animate="show" exit="exit">
          <RowSkeletons />
        </motion.div>
      )}

      {state === 'empty' && (
        <motion.div key="empty" variants={swap} initial="hidden" animate="show" exit="exit"
          className="text-center py-20">
          <div className="text-5xl mb-4">🔖</div>
          <div className="font-extrabold text-brand-dark text-base mb-2">保存した投稿がありません</div>
          <div className="text-brand-muted text-[13px]">投稿の右下のブックマークアイコンで保存できます</div>
        </motion.div>
      )}

      {state === 'list' && (
    <motion.div key="list" variants={swap} initial="hidden" animate="show" exit="exit"
      className="flex flex-col gap-2 kb-list">
      {items.map(p => (
        <PostRow
          key={p.id}
          post={p}
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
    </motion.div>
      )}
    </AnimatePresence>
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

  const events = data?.events ?? []
  const now = new Date()
  const upcoming = events.filter(e => e.event_date && new Date(e.event_date) >= now)
  const past     = events.filter(e => e.event_date && new Date(e.event_date) < now)
  const state = isLoading ? 'loading' : events.length === 0 ? 'empty' : 'list'

  // Entrance comes from the parent's `kb-list` class, same as PostRow — this
  // tab used to slide in on a different axis from every other list.
  const EventItem = ({ e }: { e: SavedPost }) => {
    const d = new Date(e.event_date!)
    const tc = postTypeMeta(e.post_type)
    const isToday = d.toDateString() === now.toDateString()

    return (
      <div
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
      </div>
    )
  }

  return (
    <AnimatePresence mode="wait">
      {state === 'loading' && (
        <motion.div key="loading" variants={swap} initial="hidden" animate="show" exit="exit">
          <RowSkeletons />
        </motion.div>
      )}

      {state === 'empty' && (
        <motion.div key="empty" variants={swap} initial="hidden" animate="show" exit="exit"
          className="text-center py-20">
          <div className="text-5xl mb-4">📅</div>
          <div className="font-extrabold text-brand-dark text-base mb-2">イベントがありません</div>
          <div className="text-brand-muted text-[13px]">投稿作成時にイベント日時を設定するとここに表示されます</div>
        </motion.div>
      )}

      {state === 'list' && (
        <motion.div key="list" variants={swap} initial="hidden" animate="show" exit="exit"
          className="flex flex-col gap-6">
          {upcoming.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 font-bold text-[12px] text-brand-muted uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#22c55e' }} />
                今後のイベント
              </div>
              <div className="flex flex-col gap-3 kb-list">
                {upcoming.map(e => <EventItem key={e.id} e={e} />)}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3 font-bold text-[12px] text-brand-muted uppercase tracking-wide">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#B8A890' }} />
                過去のイベント
              </div>
              <div className="flex flex-col gap-3 opacity-60 kb-list">
                {past.map(e => <EventItem key={e.id} e={e} />)}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
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

  const unpin = useMutation<void, Error, string, { prev?: PinnedResponse }>({
    mutationFn: (id) => api.delete(`/admin/posts/${id}/pin`),
    onMutate: (id) => {
      const prev = queryClient.getQueryData<PinnedResponse>(['pinned-posts'])
      queryClient.setQueryData(['pinned-posts'], (old: PinnedResponse | undefined) =>
        old ? { posts: old.posts.filter(p => p.id !== id) } : old)
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['pinned-posts'], ctx.prev)
      toast.error('ピン留めの解除に失敗しました')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['pinned-posts'] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
    onSuccess: () => toast.success('ピン留めを解除しました'),
  })

  const items = data?.posts ?? []
  const state = isLoading ? 'loading' : items.length === 0 ? 'empty' : 'list'

  return (
    <AnimatePresence mode="wait">
      {state === 'loading' && (
        <motion.div key="loading" variants={swap} initial="hidden" animate="show" exit="exit">
          <RowSkeletons n={2} />
        </motion.div>
      )}

      {state === 'empty' && (
        <motion.div key="empty" variants={swap} initial="hidden" animate="show" exit="exit"
          className="text-center py-20">
          <div className="text-5xl mb-4">📌</div>
          <div className="font-extrabold text-brand-dark text-base mb-2">ピン留めされた投稿がありません</div>
          {isAdmin && (
            <div className="text-brand-muted text-[13px]">フィードの投稿メニューからピン留めできます</div>
          )}
        </motion.div>
      )}

      {state === 'list' && (
    <motion.div key="list" variants={swap} initial="hidden" animate="show" exit="exit"
      className="flex flex-col gap-2 kb-list">
      {items.map(p => (
        <PostRow
          key={p.id}
          post={p}
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
    </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

type TabId = 'saved' | 'events' | 'pinned'

const TABS: { id: TabId; label: string; Icon: typeof Bookmark }[] = [
  { id: 'saved',  label: '保存済み', Icon: Bookmark },
  { id: 'events', label: 'イベント', Icon: Calendar },
  { id: 'pinned', label: 'ピン留め', Icon: Pin },
]

export default function Bookmarks({ initialTab = 'saved' }: { initialTab?: TabId }) {
  const [tab, setTab] = useState<TabId>(initialTab)

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
                transition={SPRING}
                className="relative flex-1 flex items-center justify-center gap-1.5 py-2 rounded-[9px] text-[12px] font-bold"
                style={{ color: active ? '#E8732A' : '#8A7A68' }}
              >
                {active && (
                  <motion.span
                    layoutId="bookmark-tab-pill"
                    className="absolute inset-0 rounded-[9px]"
                    style={{ background: '#FFFDF7', boxShadow: '0 1px 4px rgba(60,30,10,0.08)' }}
                    transition={SPRING}
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

      {/* Tab content — rendered directly, with no wrapper AnimatePresence.
          Each tab already crossfades its own loading/empty/list states, so
          wrapping them in a second mode="wait" made every switch pay two
          sequential exits before anything appeared. That stacking is what
          felt janky. Now switching unmounts the old tab at once and the new
          tab's list staggers itself in. */}
      <div className="max-w-[600px] mx-auto">
        {tab === 'saved'  && <SavedTab />}
        {tab === 'events' && <EventsTab />}
        {tab === 'pinned' && <PinnedTab />}
      </div>
    </div>
  )
}
