import { useState, useEffect, useRef } from 'react'
import { useInfiniteQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import PostCard from '../components/PostCard'
import { PostCardSkeleton } from '../components/Skeletons'
import { useAuth } from '../contexts/AuthContext'
import { useReadPosts } from '../hooks/useReadPosts'
import type { User } from '../contexts/AuthContext'
import type { Post } from '../types'

// ── Filter chips ────────────────────────────────────────────────────────────
const FILTER_OPTIONS = [
  { id: 'all',          label: 'すべて' },
  { id: 'ANNOUNCEMENT', label: '📢 お知らせ' },
  { id: 'KNOWLEDGE',    label: '📚 ナレッジ' },
  { id: 'DAILY_REPORT', label: '📊 日報' },
  { id: 'CHAT',         label: '💬 雑談' },
  { id: 'DEPARTMENT',   label: '🏢 部署' },
]

interface FilterChipsProps {
  active: string
  onChange: (id: string) => void
}

const FILTER_SPRING = { type: 'spring', stiffness: 480, damping: 30, mass: 0.7 } as const

function FilterChips({ active, onChange }: FilterChipsProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 mb-3.5" style={{ scrollbarWidth: 'none' }}>
      {FILTER_OPTIONS.map(({ id, label }) => {
        const isActive = active === id
        return (
          <motion.button
            key={id}
            onClick={() => onChange(id)}
            whileTap={{ scale: 0.93 }}
            transition={FILTER_SPRING}
            className="relative whitespace-nowrap px-3.5 py-1.5 rounded-full text-[12px] font-bold flex-shrink-0"
            style={{
              color:  isActive ? '#FFFFFF' : '#6B5236',
              border: `1.5px solid ${isActive ? '#E8732A' : '#E4D4B8'}`,
              background: isActive ? 'transparent' : '#FFFDF7',
            }}
          >
            {isActive && (
              <motion.span
                layoutId="filter-pill"
                className="absolute inset-0 rounded-full"
                style={{ background: '#E8732A' }}
                transition={FILTER_SPRING}
              />
            )}
            <span className="relative z-10">{label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}

// ── Stories bar ─────────────────────────────────────────────────────────────
const STORY_COLORS = ['#7A5C30', '#C05A18', '#1E5FA8', '#1A7A48', '#6B35A8', '#C07090', '#2E6818']

interface StoriesBarProps {
  posts: Post[]
  read: Set<string>
  onRead: (id: string) => void
}

function StoriesBar({ posts, read, onRead }: StoriesBarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  // index within each author's posts that we'll navigate to next
  const [cursor, setCursor] = useState<Record<string, number>>({})

  // Group posts by author, preserving first-seen order
  const authorMap = new Map<string, { name: string; color: string; posts: Post[] }>()
  let colorIdx = 0
  for (const p of posts) {
    if (!authorMap.has(p.author_id)) {
      authorMap.set(p.author_id, {
        name: p.author_name,
        color: STORY_COLORS[colorIdx++ % STORY_COLORS.length],
        posts: [],
      })
    }
    authorMap.get(p.author_id)!.posts.push(p)
    if (authorMap.size >= 10) break
  }

  // Only show authors with at least one unread post
  const visible = [...authorMap.entries()].filter(([, { posts: ps }]) =>
    ps.some(p => !read.has(p.id))
  )

  if (visible.length === 0) return null

  const handleClick = (authorId: string, ps: Post[]) => {
    const unread = ps.filter(p => !read.has(p.id))
    if (unread.length === 0) return
    const idx = cursor[authorId] ?? 0
    const target = unread[idx % unread.length]
    onRead(target.id)
    setCursor(prev => ({ ...prev, [authorId]: (idx + 1) % unread.length }))
    navigate(`/posts/${target.id}`, { state: { background: location } })
  }

  return (
    <div
      className="p-3 mb-3.5 overflow-x-auto"
      style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', borderRadius: 12, scrollbarWidth: 'none' }}
    >
      <div className="flex gap-4 items-flex-start w-max">
        <AnimatePresence initial={false}>
          {visible.map(([authorId, { name, color, posts: ps }]) => {
            const unreadCount = ps.filter(p => !read.has(p.id)).length
            const initials = name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'
            return (
              <motion.div
                key={authorId}
                layout
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                onClick={() => handleClick(authorId, ps)}
                className="flex flex-col items-center gap-1 cursor-pointer flex-shrink-0 w-14 hover:opacity-75 transition-opacity"
              >
                <div className="relative">
                  {/* Ring — orange gradient = has unread */}
                  <div
                    className="w-[52px] h-[52px] rounded-full p-[2.5px]"
                    style={{
                      background: 'linear-gradient(135deg, #E8732A, #F5A460)',
                      boxShadow: '0 0 0 2px #F4EDDA',
                    }}
                  >
                    <div
                      className="w-full h-full rounded-full flex items-center justify-center text-white font-extrabold text-[15px] border-2 border-[#FFFDF7]"
                      style={{ background: color }}
                    >
                      {initials}
                    </div>
                  </div>

                  {/* Count badge — only if multiple unread */}
                  {unreadCount > 1 && (
                    <div
                      className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full flex items-center justify-center text-white font-extrabold text-[10px] px-1"
                      style={{ background: '#E8732A', border: '2px solid #F4EDDA' }}
                    >
                      {unreadCount}
                    </div>
                  )}
                </div>

                <div className="text-[10.5px] text-brand-dark font-semibold text-center whitespace-nowrap overflow-hidden text-ellipsis w-full">
                  {name?.split(' ')[0]}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}

// ── Right sidebar ────────────────────────────────────────────────────────────
interface SidebarProps {
  user: User | null | undefined
  posts: Post[]
  onTagClick: (tag: string) => void
}

function Sidebar({ user, posts, onTagClick }: SidebarProps) {
  const tagCounts: Record<string, number> = {}
  posts.forEach((p: Post) => p.tags?.forEach((t: string) => { tagCounts[t] = (tagCounts[t] || 0) + 1 }))
  const trending = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t)

  const initials = user?.full_name?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() ?? '?'

  return (
    <div className="hidden lg:flex flex-col w-64 gap-4 pt-0 flex-shrink-0">

      {/* Profile widget */}
      <div className="p-4 rounded-2xl" style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}>
        <div className="flex items-center gap-3 mb-4">
          {user?.avatar_url ? (
            <img src={user.avatar_url} alt={user.full_name ?? ''} className="w-12 h-12 rounded-2xl object-cover flex-shrink-0" />
          ) : (
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-extrabold text-[13px] flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #E87040, #F5A460)' }}
            >
              {initials}
            </div>
          )}
          <div>
            <div className="font-bold text-brand-dark text-[13px]">{user?.full_name}</div>
            <div className="text-brand-muted text-[11px]">{user?.department_name}</div>
          </div>
        </div>
      </div>

      {/* Trending tags */}
      {trending.length > 0 && (
        <div className="p-4 rounded-2xl" style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#E8732A' }} />
            <span className="font-bold text-[13px] text-brand-dark">トレンド</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {trending.map((tag: string) => (
              <span
                key={tag}
                onClick={() => onTagClick(tag)}
                className="px-2.5 py-1 rounded-xl text-[12px] font-semibold cursor-pointer transition-colors"
                style={{ background: '#F0E8D8', color: '#7A5C30', border: '1px solid #E4D4B8' }}
                onMouseEnter={(e: React.MouseEvent<HTMLSpanElement>) => { e.currentTarget.style.background = '#FDE8D0'; e.currentTarget.style.color = '#E8732A' }}
                onMouseLeave={(e: React.MouseEvent<HTMLSpanElement>) => { e.currentTarget.style.background = '#F0E8D8'; e.currentTarget.style.color = '#7A5C30' }}
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* System status */}
      <div className="p-4 rounded-2xl" style={{ background: 'linear-gradient(135deg, #FDE8D0, #FFF5EA)', border: '1px solid #F0C898' }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="font-bold text-[13px]" style={{ color: '#C05A18' }}>システム状態</span>
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
        </div>
        <p className="text-[11.5px] font-semibold" style={{ color: '#C05A18', opacity: 0.8 }}>
          全サービス正常 · SSE接続中
        </p>
      </div>
    </div>
  )
}

// ── Cursor type ──────────────────────────────────────────────────────────────
interface PageCursor {
  created_at: string
  id: string
}

interface PostsPage {
  posts: Post[]
  nextCursor?: PageCursor | null
}

// ── Feed props ───────────────────────────────────────────────────────────────
interface FeedProps {
  searchQuery?: string
  activeTab?: string
  onCompose?: () => void
}

// ── Feed ─────────────────────────────────────────────────────────────────────

export default function Feed({ searchQuery = '', activeTab, onCompose }: FeedProps) {
  const [viewMode, setViewMode] = useState<string>('scroll')
  const [activeFilter, setActiveFilter] = useState<string>('all')
  const [searchParams, setSearchParams] = useSearchParams()
  const tagFilter = searchParams.get('tag') ?? ''
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { read, markRead } = useReadPosts()
  const sentinelRef = useRef<HTMLDivElement>(null)

  const newPostsAvailable = queryClient.getQueryData<boolean>(['newPostsAvailable'])

  // viewMode (scroll/board) is intentionally NOT in queryKey — both views share
  // the same cached pages so switching between them makes zero network requests.
  // StoriesBar and read-state also derive from this same in-memory array.
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery<PostsPage, Error, { pages: PostsPage[] }, string[], PageCursor | null>({
    queryKey: ['posts', searchQuery, activeFilter, tagFilter],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (pageParam)    { params.set('cursor_created_at', pageParam.created_at); params.set('cursor_id', pageParam.id) }
      if (searchQuery)  params.set('q', searchQuery)
      if (activeFilter !== 'all') params.set('type', activeFilter)
      if (tagFilter)    params.set('tag', tagFilter)
      return api.get(`/posts?${params}`)
    },
    getNextPageParam: (last: PostsPage) => last.nextCursor ?? undefined,
    initialPageParam: null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,         // SSE is the only invalidation trigger — never auto-refetch
    gcTime:    5 * 60 * 1000,   // 5 min — keep pages in memory between tab switches
  })

  const posts: Post[] = data?.pages.flatMap((p: PostsPage) => p.posts) ?? []

  // Infinite scroll — trigger fetchNextPage when sentinel enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <div className="max-w-[960px] mx-auto px-4 pt-0 flex gap-6 items-start">

      {/* ── Main feed column ── */}
      <div className="flex-1 min-w-0">

        {/* Sticky controls bar */}
        <div
          className="sticky z-40 flex items-center justify-between py-3 mb-3.5"
          style={{
            top: 56,
            background: 'rgba(244,237,218,0.96)',
            backdropFilter: 'blur(16px)',
            borderBottom: '1px solid rgba(200,175,130,0.30)',
          }}
        >
          <div className="flex items-center gap-2 font-extrabold text-[17px] text-brand-dark" style={{ letterSpacing: '-0.4px' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: '#E8732A' }} />
            {searchQuery ? `"${searchQuery}" の結果` : 'フィード'}
          </div>

          <div
            className="flex items-center gap-0.5 p-0.5 rounded-full"
            style={{ background: 'rgba(58,42,26,0.08)' }}
          >
            {[
              { id: 'scroll', label: 'フィード', icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg> },
              { id: 'board',  label: 'ボード',    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg> },
            ].map(({ id, label, icon }) => {
              const isActive = viewMode === id
              return (
                <motion.button
                  key={id}
                  onClick={() => setViewMode(id)}
                  whileTap={{ scale: 0.9 }}
                  transition={FILTER_SPRING}
                  className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold"
                  style={{ color: isActive ? '#E8732A' : '#8A7A68' }}
                >
                  {isActive && (
                    <motion.span
                      layoutId="view-mode-pill"
                      className="absolute inset-0 rounded-full"
                      style={{ background: '#FFFDF7', boxShadow: '0 1px 4px rgba(60,30,10,0.08)' }}
                      transition={FILTER_SPRING}
                    />
                  )}
                  <span className="relative z-10 flex items-center gap-1.5">{icon} {label}</span>
                </motion.button>
              )
            })}
          </div>
        </div>

        {/* New posts pill */}
        {newPostsAvailable && (
          <div className="flex justify-center mb-3 animate-slideDown">
            <button
              onClick={() => {
            queryClient.setQueryData(['newPostsAvailable'], false)
            // Truncate to page 1 so invalidate only fetches 1 page, not however
            // many the user has scrolled through
            queryClient.setQueriesData({ queryKey: ['posts'] }, (old: unknown) => {
              const d = old as { pages?: unknown[]; pageParams?: unknown[] } | undefined
              if (!d?.pages?.length) return old
              return { pages: d.pages.slice(0, 1), pageParams: d.pageParams?.slice(0, 1) ?? [] }
            })
            queryClient.invalidateQueries({ queryKey: ['posts'] })
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
              className="flex items-center gap-1.5 text-white text-[12.5px] font-bold px-5 py-2.5 rounded-full transition-transform hover:-translate-y-0.5"
              style={{ background: '#E8732A', boxShadow: '0 4px 18px rgba(232,115,42,0.42)' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round"><polyline points="18 15 12 9 6 15" /></svg>
              新しい投稿があります
            </button>
          </div>
        )}

        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <FilterChips active={activeFilter} onChange={setActiveFilter} />
        </motion.div>

        {/* Active tag filter pill */}
        {tagFilter && (
          <div className="flex items-center gap-2 mb-3 -mt-1">
            <div
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-bold"
              style={{ background: '#FDE8D0', color: '#E8732A', border: '1px solid #F5B070' }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
              #{tagFilter}
              <button
                onClick={() => { const p = new URLSearchParams(searchParams); p.delete('tag'); setSearchParams(p) }}
                className="ml-0.5 font-bold hover:opacity-100 opacity-60 leading-none"
              >×</button>
            </div>
          </div>
        )}

        <AnimatePresence mode="popLayout" initial={false}>

          {/* ── Skeleton ── */}
          {isLoading && (
            <motion.div
              key="skeleton"
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
              className="max-w-[500px] mx-auto"
            >
              {[0, 1, 2].map(i => <PostCardSkeleton key={i} />)}
            </motion.div>
          )}

          {/* ── Empty ── */}
          {!isLoading && posts.length === 0 && (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="text-center py-16"
            >
              <div className="text-5xl mb-3">🔍</div>
              <div className="font-extrabold text-brand-dark text-base mb-1.5">投稿が見つかりません</div>
              <div className="text-[13px] text-brand-muted">検索ワードやフィルターを変更してください</div>
            </motion.div>
          )}

          {/* ── Scroll view ── */}
          {!isLoading && posts.length > 0 && viewMode === 'scroll' && (
            <motion.div key={`scroll-${searchQuery}-${activeFilter}`}>
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
              >
                <StoriesBar posts={posts} read={read} onRead={markRead} />
              </motion.div>
              <div className="max-w-[500px] mx-auto">
                {posts.map((post: Post, i: number) => (
                  <motion.div
                    key={post.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8, transition: { duration: 0.1 } }}
                    transition={{
                      duration: 0.28,
                      delay: Math.min((i % 8) * 0.055, 0.35),
                      ease: [0.25, 0.46, 0.45, 0.94],
                    }}
                  >
                    <PostCard post={post} viewMode="scroll" idx={i} onRead={markRead} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Board view ── */}
          {!isLoading && posts.length > 0 && viewMode === 'board' && (
            <motion.div key={`board-${searchQuery}-${activeFilter}`} className="grid grid-cols-2 gap-3">
              {posts.map((post: Post, i: number) => (
                <motion.div
                  key={post.id}
                  initial={{ opacity: 0, scale: 0.96, y: 10 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={{
                    duration: 0.24,
                    delay: Math.min((i % 8) * 0.045, 0.3),
                    ease: [0.25, 0.46, 0.45, 0.94],
                  }}
                >
                  <PostCard post={post} viewMode="board" idx={i} onRead={markRead} />
                </motion.div>
              ))}
            </motion.div>
          )}

        </AnimatePresence>

        {/* Intersection sentinel — triggers fetchNextPage automatically */}
        <div ref={sentinelRef} />

        {isFetchingNextPage && (
          <div className="max-w-[500px] mx-auto">
            <PostCardSkeleton />
          </div>
        )}

        {!isLoading && posts.length > 0 && !hasNextPage && (
          <div className="text-center py-9 text-[13px] font-medium text-[#B8A890]">
            今日のフィードはここまでです 🎉
          </div>
        )}
      </div>

      {/* ── Right sidebar ── */}
      <Sidebar user={user} posts={posts} onTagClick={(tag) => setSearchParams({ tag })} />
    </div>
  )
}
