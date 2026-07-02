import { useState, useRef, useEffect, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Bookmark, Heart, MessageSquare } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { stripMarkdown } from '../lib/markdown'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { postTypeMeta, initials as initialsOf, patchPostCaches, useAddComment } from '../lib/postMeta'
import CommentsPanel from './CommentsPanel'
import ViewersModal from './ViewersModal'
import { UserHoverCard } from './UserHoverCard'

// Lazy — keeps tiptap out of the main bundle (only loads when editing)
const PostComposer = lazy(() => import('./PostComposer'))
import { colorFor } from '../lib/colors'
import type { Post, Attachment } from '../types'

// ── helpers ──────────────────────────────────────────────────────────────────

interface TypeBadgeProps {
  type: string
}

function TypeBadge({ type }: TypeBadgeProps) {
  const { bg, color, label } = postTypeMeta(type)
  return (
    <span
      className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap flex-shrink-0"
      style={{ background: bg, color }}
    >
      {label}
    </span>
  )
}

interface InitialAvatarProps {
  name: string
  avatarUrl?: string | null
  color?: string
  size?: number
  ring?: boolean
}

function InitialAvatar({ name, avatarUrl, color = 'linear-gradient(135deg, #E8732A, #F5A460)', size = 36, ring = true }: InitialAvatarProps) {
  const initials = initialsOf(name)

  if (avatarUrl) {
    return (
      <div
        className="flex-shrink-0 rounded-full overflow-hidden"
        style={{
          width: size, height: size,
          boxShadow: ring ? '0 0 0 2px #FFFDF7, 0 0 0 3.5px #E8A86A' : undefined,
        }}
      >
        <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </div>
    )
  }

  return (
    <div
      className="flex items-center justify-center text-white font-extrabold flex-shrink-0 rounded-full"
      style={{
        width: size, height: size,
        background: ring ? 'linear-gradient(135deg, #E8732A, #F5A460)' : color,
        padding: ring ? 2 : 0,
        boxShadow: ring ? '0 0 0 2px #FFFDF7' : undefined,
        fontSize: size < 30 ? 9 : size < 40 ? 12 : 15,
      }}
    >
      {ring ? (
        <div
          className="w-full h-full rounded-full flex items-center justify-center border-2"
          style={{ background: color, borderColor: '#FFFDF7' }}
        >
          {initials}
        </div>
      ) : initials}
    </div>
  )
}

// Heart/comment icons come from lucide (identical paths to the previous
// hand-rolled SVGs); the 3-dot menu keeps its slightly larger filled dots.
function HeartIcon({ filled, size = 23 }: { filled: boolean; size?: number }) {
  return <Heart size={size} strokeWidth={2} fill={filled ? '#E8732A' : 'none'} color={filled ? '#E8732A' : '#3A2A1A'} />
}

function CommentIcon({ size = 22 }: { size?: number }) {
  return <MessageSquare size={size} strokeWidth={2} color="#3A2A1A" />
}

interface DotsIconProps {
  size?: number
}

function DotsIcon({ size = 16 }: DotsIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
    </svg>
  )
}

// ── PostCard ──────────────────────────────────────────────────────────────────

interface PostCardProps {
  post: Post
  viewMode: 'scroll' | 'board'
  onRead?: (id: string) => void
}

export default function PostCard({ post, viewMode, onRead }: PostCardProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const toast = useToast()
  const cardRef = useRef<HTMLDivElement>(null)
  const goToPost = () => {
    onRead?.(post.id)
    // Never nest modal backgrounds: use the feed root, not the current modal URL.
    const existingBg = (location.state as { background?: unknown } | null)?.background
    navigate(`/posts/${post.id}`, { state: { background: existingBg ?? location } })
  }

  // Warm both the detail data and the lazy PostDetail chunk on hover so the
  // modal opens instantly on click.
  const prefetchDetail = () => {
    void import('../pages/PostDetail')
    void queryClient.prefetchQuery({
      queryKey: ['post', post.id],
      queryFn: () => api.get(`/posts/${post.id}`),
      staleTime: 30_000,
    })
  }
  const [liked, setLiked] = useState<boolean>(post.liked_by_me)
  const [likesCount, setLikesCount] = useState<number>(Number(post.likes_count))
  const [bookmarked, setBookmarked] = useState<boolean>(post.is_bookmarked_by_me ?? false)
  const [commentsOpen, setCommentsOpen] = useState<boolean>(false)
  const [commentDraft, setCommentDraft] = useState<string>('')
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [viewersOpen, setViewersOpen] = useState<boolean>(false)
  const [editOpen, setEditOpen] = useState<boolean>(false)
  const [editedPost, setEditedPost] = useState<Post>(post)

  // Keep editedPost in sync when React Query delivers fresh post data
  useEffect(() => {
    if (!editOpen) setEditedPost(post)
  }, [post, editOpen])

  const [heartKey, setHeartKey] = useState<number>(0)
  const [showHeart, setShowHeart] = useState<boolean>(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const lastTapRef = useRef<number>(0)
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleCardClick = (e: React.MouseEvent) => {
    const now = Date.now()
    const delta = now - lastTapRef.current
    lastTapRef.current = now

    if (delta < 300 && delta > 0) {
      // Double-tap: cancel pending navigation, fire like
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current)
        singleTapTimerRef.current = null
      }
      // Trigger like if not already liked
      if (!liked) {
        likeMutation.mutate(true)
      }
      // Always show the heart burst
      setHeartKey(k => k + 1)
      setShowHeart(true)
      setTimeout(() => setShowHeart(false), 900)
    } else {
      // Single tap: delay navigation so a second tap can cancel it
      singleTapTimerRef.current = setTimeout(() => {
        goToPost()
      }, 310)
    }
  }

  // Mark as read after 1.5s dwell in viewport
  useEffect(() => {
    if (!onRead) return
    const el = cardRef.current
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer = setTimeout(() => onRead(post.id), 1500)
        } else {
          if (timer) clearTimeout(timer)
        }
      },
      { threshold: 0.6 }
    )
    observer.observe(el)
    return () => { observer.disconnect(); if (timer) clearTimeout(timer) }
  }, [post.id, onRead])

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const addComment = useAddComment(post.id, {
    onClear: () => setCommentDraft(''),
    onSuccess: () => toast.success('コメントを送信しました'),
    onError: () => toast.error('コメントの送信に失敗しました'),
  })

  const submitInlineComment = () => {
    if (!commentDraft.trim() || addComment.isPending) return
    addComment.mutate(commentDraft.trim())
  }

  const imageAttachments: Attachment[] = post.attachments?.filter(a => a.thumbnail_path) ?? []
  const hasImage = imageAttachments.length > 0
  const fileAttachments: Attachment[] = post.attachments?.filter(a => !a.thumbnail_path) ?? []

  const patchFeedLike = (nextLiked: boolean, count: number) =>
    patchPostCaches(queryClient, post.id, p => ({ ...p, liked_by_me: nextLiked, likes_count: count }))

  // mutationFn receives `next` explicitly — avoids stale closure where liked may have
  // been updated by a re-render between onMutate and mutationFn execution.
  const likeMutation = useMutation({
    mutationFn: (next: boolean) => next
      ? api.post(`/posts/${post.id}/like`)
      : api.delete(`/posts/${post.id}/like`),
    onMutate: (next: boolean) => {
      void queryClient.cancelQueries({ queryKey: ['posts'] })
      const prevLiked = liked
      const prevCount = likesCount
      const nextCount = next ? prevCount + 1 : prevCount - 1
      setLiked(next)
      setLikesCount(nextCount)
      patchFeedLike(next, nextCount)
      return { prevLiked, prevCount }
    },
    onError: (_err, _next, ctx) => {
      if (!ctx) return
      setLiked(ctx.prevLiked)
      setLikesCount(ctx.prevCount)
      patchFeedLike(ctx.prevLiked, ctx.prevCount)
      toast.error('いいねに失敗しました')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['post', post.id] })
      queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
    },
  })

  const bookmarkMutation = useMutation({
    mutationFn: (save: boolean) => save
      ? api.post(`/bookmarks/${post.id}`)
      : api.delete(`/bookmarks/${post.id}`),
    onMutate: (save) => setBookmarked(save),
    onError: (_err, save) => {
      setBookmarked(!save)
      toast.error('保存に失敗しました')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
    },
  })

  const pinMutation = useMutation({
    mutationFn: () => post.is_pinned
      ? api.delete(`/admin/posts/${post.id}/pin`)
      : api.post(`/admin/posts/${post.id}/pin`),
    onMutate: () => {
      const next = !post.is_pinned
      patchPostCaches(queryClient, post.id, p => ({ ...p, is_pinned: next }))
      setMenuOpen(false)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['pinned-posts'] })
    },
    onError: () => {
      patchPostCaches(queryClient, post.id, p => ({ ...p, is_pinned: post.is_pinned }))
      toast.error('ピン留めに失敗しました')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/posts/${post.id}`),
    onSuccess: () => {
      setMenuOpen(false)
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
      queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
    },
    onError: () => toast.error('削除に失敗しました'),
  })

  const isEdited = new Date(editedPost.updated_at).getTime() - new Date(editedPost.created_at).getTime() > 60_000

  // ── SCROLL (Instagram) VIEW ──────────────────────────────────────────────
  if (viewMode === 'scroll') {
    return (
      <div
        className="mb-3.5 overflow-hidden"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', borderRadius: 12, contain: 'layout', touchAction: 'pan-y' }}
        onMouseEnter={prefetchDetail}
      >
        {/* Pinned banner */}
        {post.is_pinned && (
          <div className="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] font-bold" style={{ background: '#FDE8D0', color: '#B84A0E', borderBottom: '1px solid #F0C898' }}>
            📌 ピン留め
          </div>
        )}

        {/* Header */}
        <div className="flex items-center gap-2.5 px-3.5 py-3">
          <UserHoverCard userId={post.author_id} userName={post.author_name}>
            <InitialAvatar name={post.author_name} avatarUrl={post.author_avatar} color="#7A5C30" ring />
          </UserHoverCard>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[13px] text-brand-dark">{post.author_name}</div>
            <div className="text-[11px] text-brand-muted">
              {post.author_dept} · {post.visibility_scope === 'COMPANY_WIDE' ? '全社' : '部署内'} · {new Date(post.created_at).toLocaleDateString('ja-JP')}
            </div>
          </div>
          {post.event_date && (
            <div className="flex flex-col items-center px-2 py-1 rounded-xl flex-shrink-0" style={{ background: '#E8732A', color: '#FFFDF7', minWidth: 36 }}>
              <span className="text-[9px] font-bold leading-none">{new Date(post.event_date).toLocaleDateString('ja-JP', { month: 'short' })}</span>
              <span className="text-[16px] font-extrabold leading-none">{new Date(post.event_date).getDate()}</span>
            </div>
          )}
          <TypeBadge type={post.post_type} />
          <div className="relative ml-1" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
              className="text-brand-muted hover:text-brand-dark"
            >
              <DotsIcon />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-7 z-50 rounded-2xl overflow-hidden shadow-xl"
                style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', minWidth: 160 }}
              >
                {(user?.id === post.author_id || user?.role === 'admin') && (
                  <button
                    onClick={() => { setEditOpen(true); setMenuOpen(false) }}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-left hover:bg-[#FDE8D0] transition-colors"
                    style={{ color: '#3A2A1A' }}
                  >
                    ✏️ 編集する
                  </button>
                )}
                {user?.role === 'admin' && (
                  <button
                    onClick={() => pinMutation.mutate()}
                    disabled={pinMutation.isPending}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-left hover:bg-[#FDE8D0] transition-colors"
                    style={{ color: '#B84A0E' }}
                  >
                    📌 {post.is_pinned ? 'ピン留めを解除' : 'ピン留めする'}
                  </button>
                )}
                {(user?.id === post.author_id || user?.role === 'admin') && (
                  <button
                    onClick={() => { if (confirm('この投稿を削除しますか？')) deleteMutation.mutate() }}
                    disabled={deleteMutation.isPending}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-[13px] font-semibold text-left hover:bg-[#FDE8D0] transition-colors"
                    style={{ color: '#C0392B' }}
                  >
                    🗑️ 削除する
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content area */}
        {hasImage ? (
          <div
            onClick={() => goToPost()}
            className="cursor-pointer overflow-hidden"
            style={{ borderTop: '1px solid #E4D4B8', borderBottom: '1px solid #E4D4B8' }}
          >
            {imageAttachments.length === 1 && (
              <img
                src={imageAttachments[0].thumbnail_path!}
                alt={post.title}
                className="w-full object-cover"
                style={{ height: 290 }}
              />
            )}
            {imageAttachments.length === 2 && (
              <div className="flex gap-0.5" style={{ height: 250 }}>
                {imageAttachments.map((a, i) => (
                  <img key={a.id} src={a.thumbnail_path!} alt={String(i + 1)} className="flex-1 object-cover" />
                ))}
              </div>
            )}
            {imageAttachments.length === 3 && (
              <div>
                <img src={imageAttachments[0].thumbnail_path!} alt="1" className="w-full object-cover" style={{ height: 200 }} />
                <div className="flex gap-0.5 mt-0.5" style={{ height: 140 }}>
                  <img src={imageAttachments[1].thumbnail_path!} alt="2" className="flex-1 object-cover" />
                  <img src={imageAttachments[2].thumbnail_path!} alt="3" className="flex-1 object-cover" />
                </div>
              </div>
            )}
            {imageAttachments.length >= 4 && (
              <div className="grid grid-cols-2 gap-0.5" style={{ height: 280 }}>
                {imageAttachments.slice(0, 4).map((a, i) => (
                  <div key={a.id} className="relative overflow-hidden" style={{ height: 140 }}>
                    <img src={a.thumbnail_path!} alt={String(i + 1)} className="w-full h-full object-cover" />
                    {i === 3 && imageAttachments.length > 4 && (
                      <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(58,42,26,0.58)' }}>
                        <span className="text-white font-extrabold" style={{ fontSize: 26 }}>+{imageAttachments.length - 4}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div
            onClick={() => goToPost()}
            className="w-full flex items-center justify-center px-6 py-7 cursor-pointer"
            style={{
              minHeight: 240,
              background: 'linear-gradient(145deg, #FAF5EC 0%, #FDE8D0 100%)',
              borderTop: '1px solid #E4D4B8',
              borderBottom: '1px solid #E4D4B8',
            }}
          >
            <div className="text-center max-w-[300px]">
              <TypeBadge type={post.post_type} />
              <h3
                className="font-extrabold text-brand-dark mt-3.5 mb-2.5 leading-snug"
                style={{ fontSize: 21, letterSpacing: '-0.4px' }}
              >
                {editedPost.title}
              </h3>
              {editedPost.tags.length > 0 && (
                <div className="text-[12.5px] font-semibold" style={{ color: '#E8732A' }}>
                  {editedPost.tags.slice(0, 3).map(t => `#${t}`).join('  ')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Action bar */}
        <div className="flex items-center gap-1 px-2 pt-1.5 pb-1">
          <button
            onClick={(e) => { e.stopPropagation(); likeMutation.mutate(!liked) }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] transition-transform active:scale-75"
          >
            <HeartIcon filled={liked} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setCommentsOpen(true) }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] transition-transform active:scale-75"
          >
            <CommentIcon />
          </button>
          <div className="flex-1" />
          <button
            onClick={(e) => { e.stopPropagation(); bookmarkMutation.mutate(!bookmarked) }}
            className="flex items-center justify-center min-w-[44px] min-h-[44px] transition-transform active:scale-75"
          >
            <Bookmark
              size={21}
              strokeWidth={2}
              fill={bookmarked ? '#E8732A' : 'none'}
              color={bookmarked ? '#E8732A' : '#3A2A1A'}
            />
          </button>
        </div>

        {/* Likes */}
        <div className="px-3.5 pb-1 font-extrabold text-[13px] text-brand-dark">
          {likesCount} いいね
        </div>

        {/* Viewer row — visible to all once at least 1 view */}
        {Number(post.views_count) > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setViewersOpen(true) }}
            className="flex items-center gap-2 px-3.5 pb-1.5 transition-opacity hover:opacity-70"
          >
            {/* Stacked avatars */}
            <div className="flex items-center">
              {(post.top_viewers ?? []).slice(0, 3).map((v, i) => (
                <div
                  key={v.id}
                  className="rounded-full border-2 overflow-hidden flex-shrink-0"
                  style={{
                    width: 20, height: 20,
                    marginLeft: i > 0 ? -6 : 0,
                    zIndex: 3 - i,
                    position: 'relative',
                    borderColor: '#FFFDF7',
                    background: colorFor(v.id),
                  }}
                >
                  {v.avatar_url
                    ? <img src={v.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : null
                  }
                </div>
              ))}
            </div>
            {/* Count label */}
            <span className="text-[11.5px] font-semibold" style={{ color: '#A8906E' }}>
              {Number(post.views_count) <= 3
                ? `${post.views_count}人が閲覧`
                : `and ${Number(post.views_count) - 3}+ more`
              }
            </span>
          </button>
        )}

        {viewersOpen && createPortal(
          <ViewersModal
            postId={post.id}
            totalViews={Number(post.views_count)}
            onClose={() => setViewersOpen(false)}
          />,
          document.body
        )}

        {/* Caption / body */}
        {hasImage ? (
          <>
            <div className="px-3.5 pb-1 text-[13px] text-brand-dark leading-relaxed" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              <span className="font-extrabold mr-1">{post.author_name}</span>
              <span className="font-bold text-brand-mid mr-1">{editedPost.title}</span>
              {(() => {
                const txt = stripMarkdown(editedPost.content)
                const MAX = 100
                return txt.length > MAX
                  ? <>{txt.slice(0, MAX)}… <button onClick={(e) => { e.stopPropagation(); goToPost() }} className="font-semibold" style={{ color: '#E8732A' }}>もっと見る</button></>
                  : txt
              })()}
            </div>
            {editedPost.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 px-3.5 pb-1.5">
                {editedPost.tags.map(t => (
                  <span key={t} onClick={(e) => { e.stopPropagation(); navigate(`/?tag=${encodeURIComponent(t)}`) }} className="text-[12.5px] font-semibold cursor-pointer hover:opacity-70 transition-opacity" style={{ color: '#4080D0' }}>#{t}</span>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {(() => {
              const txt = stripMarkdown(editedPost.content)
              const MAX = 140
              const truncated = txt.length > MAX
              return (
                <div className="px-3.5 pb-1 text-[13px] text-brand-mid leading-relaxed" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                  {truncated ? txt.slice(0, MAX) : txt}
                  {truncated && (
                    <>…{' '}<button onClick={(e) => { e.stopPropagation(); goToPost() }} className="font-semibold" style={{ color: '#E8732A' }}>もっと見る</button></>
                  )}
                </div>
              )
            })()}
            {editedPost.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 px-3.5 pb-2">
                {editedPost.tags.map(t => (
                  <span key={t} onClick={(e) => { e.stopPropagation(); navigate(`/?tag=${encodeURIComponent(t)}`) }} className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full cursor-pointer hover:opacity-70 transition-opacity" style={{ background: '#F0E8D8', color: '#7A5C30' }}>#{t}</span>
                ))}
              </div>
            )}
          </>
        )}

        {/* Non-image file attachments */}
        {fileAttachments.map(a => (
          <a
            key={a.id}
            href={a.drive_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-3.5 mb-2 flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] font-semibold text-brand-dark"
            style={{ background: '#F0E8D8', border: '1px solid #E4D4B8' }}
          >
            📎 {a.file_name}
            <span className="ml-auto text-brand-muted font-normal text-[11px]">
              {(a.size_bytes / 1024 / 1024).toFixed(1)} MB
            </span>
          </a>
        ))}

        {/* Comments link */}
        {Number(post.comments_count) > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setCommentsOpen(true) }}
            className="block px-3.5 pb-1 text-[13px] text-brand-muted hover:text-brand-dark text-left w-full"
          >
            コメント{post.comments_count}件を見る
          </button>
        )}

        {/* Inline comment input */}
        <div
          className="flex items-center gap-2.5 px-3.5 py-2.5"
          style={{ borderTop: '1px solid #E4D4B8' }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            placeholder="コメントを追加…"
            value={commentDraft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCommentDraft(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') submitInlineComment() }}
            className="flex-1 bg-transparent outline-none text-[13px] text-brand-dark placeholder-brand-muted"
          />
          <button
            onClick={submitInlineComment}
            disabled={!commentDraft.trim() || addComment.isPending}
            className="text-[13px] font-bold transition-opacity"
            style={{ color: '#E8732A', opacity: commentDraft.trim() ? 1 : 0.5 }}
          >
            送信
          </button>
        </div>

        {commentsOpen && createPortal(
          <CommentsPanel
            postId={post.id}
            postTitle={post.title}
            onClose={() => setCommentsOpen(false)}
          />,
          document.body
        )}

        {/* Timestamp + edited indicator */}
        <div className="px-3.5 pb-2.5 flex items-center gap-1.5 text-[10px] text-[#C0A880] uppercase tracking-wide">
          {new Date(editedPost.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
          {isEdited && <span style={{ color: '#A8906E' }}>· 編集済み</span>}
        </div>

        {editOpen && createPortal(
          <Suspense fallback={null}>
            <PostComposer
              editPost={editedPost}
              onClose={() => setEditOpen(false)}
              onSaved={(updated) => { setEditedPost(updated) }}
            />
          </Suspense>,
          document.body
        )}
      </div>
    )
  }

  // ── BOARD VIEW ───────────────────────────────────────────────────────────
  const isLiked = liked

  return (
    <div
      ref={cardRef}
      onClick={handleCardClick}
      onMouseEnter={prefetchDetail}
      className="relative flex flex-col gap-2.5 cursor-pointer transition-shadow duration-200 hover:shadow-lg"
      style={{
        background: '#FFFDF7',
        border: '1px solid #E4D4B8',
        borderRadius: 18,
        padding: '18px',
      }}
    >
      {/* Double-tap heart burst */}
      <AnimatePresence>
        {showHeart && (
          <motion.div
            key={heartKey}
            className="absolute inset-0 flex items-center justify-center pointer-events-none z-20"
            style={{ borderRadius: 18 }}
          >
            <motion.svg
              viewBox="0 0 24 24"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: [0, 1.5, 1.3], opacity: [0, 1, 1] }}
              exit={{ scale: 1.8, opacity: 0, y: -40 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              style={{ width: 80, height: 80, filter: 'drop-shadow(0 4px 24px rgba(232,115,42,0.5))' }}
            >
              <path
                d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"
                fill="rgba(232,115,42,0.92)"
                stroke="none"
              />
            </motion.svg>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Author */}
      <div className="flex items-center gap-2">
        <UserHoverCard userId={post.author_id} userName={post.author_name}>
          <InitialAvatar name={post.author_name} avatarUrl={post.author_avatar} color="#7A5C30" size={32} ring={false} />
        </UserHoverCard>
        <div className="flex-1 min-w-0">
          <div className="font-bold text-[12px] text-brand-dark truncate">{post.author_name}</div>
          <div className="text-[10.5px] text-brand-muted">{post.author_dept} · {new Date(post.created_at).toLocaleDateString('ja-JP')}</div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(o => !o) }}
          className="text-brand-muted hover:text-brand-dark"
        >
          <DotsIcon size={14} />
        </button>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <TypeBadge type={post.post_type} />
        {editedPost.tags.map(t => (
          <span key={t} onClick={(e) => { e.stopPropagation(); navigate(`/?tag=${encodeURIComponent(t)}`) }} className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-full cursor-pointer hover:opacity-70 transition-opacity" style={{ background: '#F0E8D8', color: '#7A5C30' }}>#{t}</span>
        ))}
      </div>

      {/* Title */}
      <h3 className="font-extrabold text-brand-dark leading-snug" style={{ fontSize: 14.5, letterSpacing: '-0.2px' }}>
        {editedPost.title}
      </h3>

      {/* Preview */}
      <p className="text-[12.5px] text-brand-mid leading-relaxed line-clamp-3 flex-1">
        {stripMarkdown(editedPost.content)}
      </p>

      {/* Actions */}
      <div
        className="flex items-center gap-1 pt-2.5 mt-auto"
        style={{ borderTop: '1px solid #EAD8BC' }}
      >
        <button
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); likeMutation.mutate(!isLiked) }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold transition-all active:scale-90"
          style={{
            background: isLiked ? '#FDE8D0' : 'transparent',
            color: isLiked ? '#E8732A' : '#A8906E',
          }}
        >
          <HeartIcon filled={isLiked} size={14} />
          {likesCount}
        </button>
        <button
          onClick={(e: React.MouseEvent) => { e.stopPropagation(); setCommentsOpen(true) }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold transition-all active:scale-90"
          style={{ color: '#A8906E' }}
        >
          <CommentIcon size={14} />
          {post.comments_count}
        </button>
      </div>

      {commentsOpen && createPortal(
        <CommentsPanel
          postId={post.id}
          postTitle={post.title}
          onClose={() => setCommentsOpen(false)}
        />,
        document.body
      )}
    </div>
  )
}
