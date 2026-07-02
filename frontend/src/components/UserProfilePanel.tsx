import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { X, Heart, MessageCircle, Pin } from 'lucide-react'
import { api } from '../lib/api'
import { colorFor } from '../lib/colors'
import { postTypeColor, initials as initialsOf } from '../lib/postMeta'
import type { PublicUser } from './UserHoverCard'

interface ProfilePost {
  id: string
  title: string
  post_type: string
  created_at: string
  likes_count: number
  comments_count: number
  is_pinned: boolean
}

// ── shared inner content ──────────────────────────────────────────────────────

interface PanelBodyProps {
  user: PublicUser | undefined
  posts: ProfilePost[]
  initials: string
  isLoading: boolean
  rootBg: unknown
  navigate: ReturnType<typeof useNavigate>
}

function PanelBody({ user, posts, initials, isLoading, rootBg, navigate }: PanelBodyProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      {isLoading && (
        <div className="flex justify-center py-16">
          <div className="w-7 h-7 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {user && (
        <>
          {/* Hero */}
          <div className="flex flex-col items-center text-center px-5 pt-6 pb-5">
            {/* Avatar ring */}
            <div className="mb-3">
              <div
                className="w-20 h-20 rounded-full p-[3px]"
                style={{ background: `linear-gradient(135deg, ${colorFor(user.id)}, #F5A460)`, boxShadow: '0 0 0 3px #F4EDDA' }}
              >
                <div
                  className="w-full h-full rounded-full flex items-center justify-center text-white font-extrabold text-xl border-2"
                  style={{ background: colorFor(user.id), borderColor: '#FFFDF7' }}
                >
                  {initials}
                </div>
              </div>
            </div>

            <div className="font-extrabold text-[18px] text-brand-dark mb-1" style={{ letterSpacing: '-0.4px' }}>
              {user.full_name}
            </div>

            <span
              className="inline-block text-[11px] font-bold px-3 py-1 rounded-full mb-3"
              style={{ background: '#FDE8D0', color: '#C05A18' }}
            >
              {user.department_name}
            </span>

            {/* Vibe */}
            {user.vibe_emoji && (
              <div
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-bold mb-3"
                style={{ background: '#FDE8D0', color: '#C05A18', border: '1.5px solid #E8732A' }}
              >
                <span>{user.vibe_emoji}</span>
                <span>{user.vibe_label}</span>
              </div>
            )}

            {/* Stats */}
            <div className="flex w-full max-w-xs rounded-2xl overflow-hidden" style={{ border: '1px solid #E4D4B8' }}>
              {(user.can_post
                ? [
                    { value: user.posts_count, label: '今月の投稿' },
                    { value: user.comments_made, label: '今月のコメ' },
                  ]
                : [
                    { value: user.comments_made, label: '今月のコメ' },
                    { value: '👀', label: '閲覧者' },
                  ]
              ).map(({ value, label }, i) => (
                <div
                  key={label}
                  className="flex-1 flex flex-col items-center py-3"
                  style={{
                    background: '#FFFDF7',
                    borderRight: i === 0 ? '1px solid #E4D4B8' : undefined,
                  }}
                >
                  <div className="font-extrabold text-[18px] text-brand-dark" style={{ letterSpacing: '-0.4px' }}>{value}</div>
                  <div className="text-[10.5px] text-brand-muted font-semibold">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Posts section */}
          {user.can_post && (
            <div className="px-4 pb-5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#E8732A' }} />
                <span className="font-extrabold text-[13px] text-brand-dark">最近の投稿</span>
                {posts.length > 0 && (
                  <span className="text-brand-muted font-semibold text-[11px]">({posts.length})</span>
                )}
              </div>

              {posts.length === 0 ? (
                <div className="text-center py-10 rounded-2xl" style={{ background: '#F4EDDA' }}>
                  <div className="text-3xl mb-2">✍️</div>
                  <div className="text-[12px] text-brand-muted">まだ投稿がありません</div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {posts.map((post, i) => (
                    <motion.div
                      key={post.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: Math.min(i * 0.04, 0.24), duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      onClick={() => navigate(`/posts/${post.id}`, { state: { background: rootBg } })}
                      className="cursor-pointer rounded-xl p-3 flex flex-col gap-1.5"
                      style={{ background: '#FAFAF5', border: '1px solid #E4D4B8' }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ background: postTypeColor(post.post_type) }} />
                        {post.is_pinned && <Pin size={9} color="#E8732A" strokeWidth={2.5} />}
                      </div>
                      <div
                        className="font-extrabold text-[11.5px] text-brand-dark leading-snug"
                        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {post.title}
                      </div>
                      <div className="text-[9.5px] text-brand-muted">
                        {new Date(post.created_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                      </div>
                      <div className="flex items-center gap-2 mt-auto">
                        <span className="flex items-center gap-0.5 text-[9.5px] text-brand-muted">
                          <Heart size={9} strokeWidth={2} /> {post.likes_count}
                        </span>
                        <span className="flex items-center gap-0.5 text-[9.5px] text-brand-muted">
                          <MessageCircle size={9} strokeWidth={2} /> {post.comments_count}
                        </span>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Non-poster message */}
          {!user.can_post && (
            <div className="px-4 pb-6">
              <div className="text-center py-8 rounded-2xl" style={{ background: '#F4EDDA', border: '1px solid #E4D4B8' }}>
                <div className="text-3xl mb-2">💬</div>
                <div className="font-extrabold text-brand-dark text-[13px] mb-1">アクティブな閲覧者</div>
                <div className="text-[11px] text-brand-muted">
                  いいねやコメントで<br />チームに貢献しています
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── main export ───────────────────────────────────────────────────────────────

export default function UserProfilePanel({ standalone = false }: { standalone?: boolean }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const rootBg = (location.state as { background?: unknown } | null)?.background ?? { pathname: '/' }

  const { data: userData, isLoading } = useQuery<{ user: PublicUser }>({
    queryKey: ['user-preview', id],
    queryFn: () => api.get(`/users/${id}`),
    staleTime: 5 * 60 * 1000,
    enabled: !!id,
  })

  const { data: postsData } = useQuery<{ posts: ProfilePost[] }>({
    queryKey: ['user-posts-panel', id],
    queryFn: () => api.get(`/users/${id}/posts?limit=12`),
    staleTime: 2 * 60 * 1000,
    enabled: !!id,
  })

  const user = userData?.user
  const posts = postsData?.posts ?? []
  const initials = initialsOf(user?.full_name)
  const bodyProps = { user, posts, initials, isLoading, rootBg, navigate }

  const close = () => standalone ? navigate('/', { replace: true }) : navigate(-1)

  // Standalone — rendered as a normal page section (direct URL access)
  if (standalone) {
    return (
      <div className="max-w-md mx-auto px-4 py-6">
        <div
          className="rounded-3xl overflow-hidden flex flex-col"
          style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
        >
          <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid #F0E8D8' }}>
            <div className="font-extrabold text-[14px] text-brand-dark">メンバー</div>
            <button
              onClick={close}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ background: '#F0E8D8', color: '#A8906E' }}
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
          <PanelBody {...bodyProps} />
        </div>
      </div>
    )
  }

  // Modal overlay — rendered over the feed when navigated from within the app
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(58,42,26,0.5)', backdropFilter: 'blur(8px)' }}
      onClick={close}
    >
      <motion.div
        initial={{ y: 60, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 60, opacity: 0, scale: 0.97 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', maxHeight: '88vh' }}
      >
        {/* Close bar */}
        <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid #F0E8D8' }}>
          <div className="font-extrabold text-[14px] text-brand-dark">メンバー</div>
          <button
            onClick={close}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: '#F0E8D8', color: '#A8906E' }}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
        <PanelBody {...bodyProps} />
      </motion.div>
    </motion.div>
  )
}
