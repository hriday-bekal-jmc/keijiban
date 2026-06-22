import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Heart, MessageCircle, Bookmark, Send, X } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { UserHoverCard } from '../components/UserHoverCard'
import { renderMarkdown } from '../lib/markdown'
import type { Post, Comment } from '../types'

// ── constants ─────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { bg: string; color: string; label: string }> = {
  ANNOUNCEMENT: { bg: '#FDE8D0', color: '#B84A0E', label: '📢 お知らせ' },
  KNOWLEDGE:    { bg: '#D8EAF8', color: '#1E5FA8', label: '📚 ナレッジ' },
  DAILY_REPORT: { bg: '#D6F0E4', color: '#1A7A48', label: '📊 日報' },
  CHAT:         { bg: '#F0E8F8', color: '#6B35A8', label: '💬 雑談' },
  DEPARTMENT:   { bg: '#E8F0E0', color: '#2E6818', label: '🏢 部署' },
}

const AVATAR_COLORS = ['#7A5C30','#C05A18','#1E5FA8','#1A7A48','#6B35A8','#C07090','#2E6818']

// ── helpers ───────────────────────────────────────────────────────────────────

function initials(name: string | undefined): string {
  return (name ?? '').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase() || '?'
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

interface AvatarProps { name: string | undefined; avatarUrl?: string | null; size?: number; colorIdx?: number; gradient?: boolean }
function Avatar({ name, avatarUrl, size = 36, colorIdx = 0, gradient = false }: AvatarProps) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? ''}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-extrabold flex-shrink-0"
      style={{
        width: size, height: size, fontSize: size * 0.33,
        background: gradient
          ? 'linear-gradient(135deg, #E87040, #F5A460)'
          : AVATAR_COLORS[colorIdx % AVATAR_COLORS.length],
      }}
    >
      {initials(name)}
    </div>
  )
}

interface TypeBadgeProps { type: string }
function TypeBadge({ type }: TypeBadgeProps) {
  const { bg, color, label } = TYPE_CONFIG[type] ?? TYPE_CONFIG.CHAT
  return (
    <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full flex-shrink-0" style={{ background: bg, color }}>
      {label}
    </span>
  )
}

function PostSkeleton() {
  return (
    <div className="animate-pulse space-y-4 p-5">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-full bg-[#E4D4B8]" />
        <div className="space-y-1.5 flex-1">
          <div className="h-3.5 bg-[#E4D4B8] rounded w-32" />
          <div className="h-3 bg-[#E4D4B8] rounded w-20" />
        </div>
      </div>
      <div className="h-7 bg-[#E4D4B8] rounded w-3/4" />
      <div className="space-y-2.5">
        {[0,1,2,3].map(i => <div key={i} className="h-3.5 bg-[#E4D4B8] rounded" style={{ width: i === 3 ? '65%' : '100%' }} />)}
      </div>
    </div>
  )
}

interface CommentItemProps { comment: Comment; idx: number }
function CommentItem({ comment, idx }: CommentItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(idx * 0.04, 0.25) }}
      className="flex gap-2.5 items-start"
    >
      <UserHoverCard userId={comment.author_id} userName={comment.author_name}>
        <Avatar name={comment.author_name} size={30} colorIdx={idx} />
      </UserHoverCard>
      <div className="flex-1 min-w-0">
        <div className="px-3 py-2 rounded-2xl rounded-tl-sm text-[12.5px] leading-relaxed" style={{ background: '#F0E8D8' }}>
          <span className="font-extrabold text-brand-dark mr-1.5">{comment.author_name}</span>
          <span style={{ color: '#5A4030' }}>{comment.content}</span>
        </div>
        <div className="text-[10px] text-brand-muted mt-1 ml-1">{formatDate(comment.created_at)}</div>
      </div>
    </motion.div>
  )
}

// ── main content ──────────────────────────────────────────────────────────────

interface ContentProps { id: string; asModal: boolean; onClose: () => void }

function PostDetailContent({ id, asModal, onClose }: ContentProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const commentsEndRef = useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState('')
  const [liked, setLiked] = useState<boolean | null>(null)
  const [likesCount, setLikesCount] = useState<number | null>(null)
  const [bookmarked, setBookmarked] = useState<boolean | null>(null)
  const [lightbox, setLightbox] = useState<number | null>(null)

  const { data: postData, isLoading: postLoading, isError } = useQuery<{ post: Post }>({
    queryKey: ['post', id],
    queryFn: () => api.get(`/posts/${id}`),
    staleTime: 30_000,
  })

  const { data: commentsData, isLoading: commentsLoading } = useQuery<{ comments: Comment[] }>({
    queryKey: ['comments', id],
    queryFn: () => api.get(`/posts/${id}/comments`),
    staleTime: 15_000,
  })

  const post = postData?.post
  const comments = commentsData?.comments ?? []

  useEffect(() => {
    if (post && liked === null) {
      setLiked(post.liked_by_me)
      setLikesCount(Number(post.likes_count))
      setBookmarked(post.is_bookmarked_by_me ?? false)
    }
  }, [post, liked])

  // Escape closes modal (or lightbox if open)
  useEffect(() => {
    const imgCount = post?.attachments?.filter((a: any) => a.thumbnail_path).length ?? 0
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (lightbox !== null) { setLightbox(null); return }
        if (asModal) onClose()
      }
      if (lightbox !== null) {
        if (e.key === 'ArrowLeft'  && lightbox > 0)            setLightbox(l => l! - 1)
        if (e.key === 'ArrowRight' && lightbox < imgCount - 1) setLightbox(l => l! + 1)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [asModal, onClose, lightbox, post])

  // Scroll to bottom when new comments arrive
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments.length])

  const likeMutation = useMutation({
    mutationFn: (isLiked: boolean) => isLiked
      ? api.post(`/posts/${id}/like`)
      : api.delete(`/posts/${id}/like`),
    onMutate: (isLiked) => {
      setLiked(isLiked)
      setLikesCount(c => isLiked ? (c ?? 0) + 1 : (c ?? 0) - 1)
      // Mirror into feed cache so PostCard board/scroll views stay in sync
      queryClient.setQueriesData({ queryKey: ['posts'] }, (old: any) => {
        if (!old?.pages) return old
        return {
          ...old,
          pages: old.pages.map((page: any) => ({
            ...page,
            posts: page.posts.map((p: any) =>
              p.id === id
                ? { ...p, liked_by_me: isLiked, likes_count: isLiked ? Number(p.likes_count) + 1 : Number(p.likes_count) - 1 }
                : p
            ),
          })),
        }
      })
      // Mirror into profile-posts cache for the mini-card grid
      queryClient.setQueriesData({ queryKey: ['profile-posts'] }, (old: any) => {
        if (!old?.posts) return old
        return {
          ...old,
          posts: old.posts.map((p: any) =>
            p.id === id
              ? { ...p, likes_count: isLiked ? Number(p.likes_count) + 1 : Number(p.likes_count) - 1 }
              : p
          ),
        }
      })
    },
    onError: (_err, isLiked) => {
      setLiked(!isLiked)
      setLikesCount(c => isLiked ? (c ?? 0) - 1 : (c ?? 0) + 1)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['post', id] })
      queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
    },
  })

  const bookmarkMutation = useMutation({
    mutationFn: (save: boolean) => save
      ? api.post(`/bookmarks/${id}`)
      : api.delete(`/bookmarks/${id}`),
    onMutate: (save) => setBookmarked(save),
    onError: (_err, save) => setBookmarked(!save),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
    },
  })

  const addComment = useMutation<Comment, Error, string>({
    mutationFn: (content) => api.post(`/posts/${id}/comments`, { content }),
    onMutate: async (content) => {
      await queryClient.cancelQueries({ queryKey: ['comments', id] })
      queryClient.setQueryData(['comments', id], (old: { comments: Comment[] } | undefined) => ({
        comments: [...(old?.comments ?? []), {
          id: `opt-${Date.now()}`, content,
          created_at: new Date().toISOString(),
          author_id: user?.id ?? '',
          author_name: user?.full_name ?? '',
          author_avatar: null,
        }],
      }))
      setDraft('')
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', id] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
    },
  })

  const submit = () => {
    if (draft.trim() && !addComment.isPending) addComment.mutate(draft.trim())
  }

  const hasComments = comments.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 h-14 flex-shrink-0"
        style={{
          borderBottom: '1px solid rgba(200,175,130,0.3)',
          background: 'rgba(244,237,218,0.97)',
          backdropFilter: 'blur(16px)',
        }}
      >
        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
          style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', color: '#3A2A1A' }}
        >
          {asModal ? <X size={15} strokeWidth={2.5} /> : <ChevronLeft size={18} strokeWidth={2.5} />}
        </button>
        <div className="flex-1 min-w-0">
          {post && (
            <div className="font-extrabold text-[15px] text-brand-dark truncate" style={{ letterSpacing: '-0.3px' }}>
              {post.title}
            </div>
          )}
        </div>
        {post && <TypeBadge type={post.post_type} />}
      </div>

      {/* ── Two-column body ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* LEFT — post content, scrollable */}
        <div className="flex-1 overflow-y-auto min-w-0" style={{ borderRight: '1px solid #E4D4B8' }}>
          <div className="px-6 py-6 max-w-[680px]">

            {postLoading && <PostSkeleton />}

            {isError && (
              <div className="text-center py-16">
                <div className="text-4xl mb-3">😕</div>
                <div className="font-extrabold text-brand-dark">投稿が見つかりません</div>
              </div>
            )}

            {post && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>

                {/* Author row */}
                <div className="flex items-center gap-3 mb-5">
                  <UserHoverCard userId={post.author_id} userName={post.author_name}>
                    <Avatar name={post.author_name} avatarUrl={(post as any).author_avatar} size={46} gradient />
                  </UserHoverCard>
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold text-[14.5px] text-brand-dark">{post.author_name}</div>
                    <div className="text-[11.5px] text-brand-muted">
                      {post.author_dept} · {post.visibility_scope === 'COMPANY_WIDE' ? '全社' : '部署内'} · {formatDate(post.created_at)}
                    </div>
                  </div>
                  <TypeBadge type={post.post_type} />
                </div>

                {/* Pinned banner */}
                {post.is_pinned && (
                  <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl mb-4 text-[11.5px] font-bold" style={{ background: '#FDE8D0', color: '#B84A0E' }}>
                    📌 ピン留め
                  </div>
                )}

                {/* Event badge */}
                {post.event_date && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-4" style={{ background: '#FDE8D0', color: '#B84A0E' }}>
                    <span className="text-lg">📅</span>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">イベント日時</div>
                      <div className="text-[13px] font-extrabold">{formatDate(post.event_date)}</div>
                    </div>
                  </div>
                )}

                {/* Title */}
                <h1
                  className="font-extrabold text-brand-dark leading-snug mb-4"
                  style={{ fontSize: 26, letterSpacing: '-0.6px', lineHeight: 1.25 }}
                >
                  {post.title}
                </h1>

                {/* Content */}
                <div
                  className="text-[14.5px] leading-[1.85] mb-5"
                  style={{ color: '#3A2A1A', fontWeight: 450, overflowWrap: 'break-word', wordBreak: 'break-word', minWidth: 0 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
                />

                {/* Image gallery — skip images already embedded inline in content */}
                {(() => {
                  // Find thumbnail_path URLs referenced by markdown image syntax in content
                  const inlinePaths = new Set(
                    [...post.content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
                  )
                  const imgs: any[] = (post.attachments?.filter((a: any) => a.thumbnail_path && !inlinePaths.has(a.thumbnail_path)) ?? [])
                  const files: any[] = post.attachments?.filter((a: any) => !a.thumbnail_path) ?? []
                  if (imgs.length === 0 && files.length === 0) return null
                  return (
                    <div className="mb-5">
                      {/* Images — responsive grid matching PostCard layouts */}
                      {imgs.length > 0 && (
                        <div className="mb-2 rounded-2xl overflow-hidden" style={{ border: '1px solid #E4D4B8' }}>
                          {imgs.length === 1 && (
                            <img
                              src={imgs[0].thumbnail_path}
                              alt={imgs[0].file_name}
                              className="w-full object-cover cursor-zoom-in"
                              style={{ maxHeight: 520 }}
                              onClick={() => setLightbox(0)}
                            />
                          )}
                          {imgs.length === 2 && (
                            <div className="flex gap-0.5" style={{ height: 320 }}>
                              {imgs.map((a: any, i: number) => (
                                <img key={a.id} src={a.thumbnail_path} alt={String(i + 1)} className="flex-1 object-cover cursor-zoom-in" onClick={() => setLightbox(i)} />
                              ))}
                            </div>
                          )}
                          {imgs.length === 3 && (
                            <div>
                              <img src={imgs[0].thumbnail_path} alt="1" className="w-full object-cover cursor-zoom-in" style={{ height: 240 }} onClick={() => setLightbox(0)} />
                              <div className="flex gap-0.5 mt-0.5" style={{ height: 200 }}>
                                <img src={imgs[1].thumbnail_path} alt="2" className="flex-1 object-cover cursor-zoom-in" onClick={() => setLightbox(1)} />
                                <img src={imgs[2].thumbnail_path} alt="3" className="flex-1 object-cover cursor-zoom-in" onClick={() => setLightbox(2)} />
                              </div>
                            </div>
                          )}
                          {imgs.length >= 4 && (
                            <div className="grid grid-cols-2 gap-0.5">
                              {imgs.slice(0, Math.min(imgs.length, 4)).map((a: any, i: number) => (
                                <div key={a.id} className="relative overflow-hidden" style={{ height: 200 }}>
                                  <img src={a.thumbnail_path} alt={String(i + 1)} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightbox(i)} />
                                  {i === 3 && imgs.length > 4 && (
                                    <div className="absolute inset-0 flex items-center justify-center cursor-zoom-in" style={{ background: 'rgba(58,42,26,0.58)' }} onClick={() => setLightbox(3)}>
                                      <span className="text-white font-extrabold" style={{ fontSize: 30 }}>+{imgs.length - 4}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {/* Non-image files */}
                      {files.map((a: any) => (
                        <a
                          key={a.id}
                          href={a.drive_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 px-4 py-3 rounded-xl text-[13px] font-semibold text-brand-dark transition-colors mb-1.5"
                          style={{ background: '#F0E8D8', border: '1px solid #E4D4B8' }}
                        >
                          📎 {a.file_name}
                          <span className="ml-auto text-brand-muted font-normal text-[11px]">
                            {(a.size_bytes / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </a>
                      ))}

                      {/* Lightbox */}
                      {lightbox !== null && (() => {
                        const imgs2: any[] = post.attachments?.filter((a: any) => a.thumbnail_path) ?? []
                        return (
                          <div
                            className="fixed inset-0 z-[300] flex items-center justify-center"
                            style={{ background: 'rgba(0,0,0,0.93)' }}
                            onClick={() => setLightbox(null)}
                          >
                            {/* Prev */}
                            {lightbox > 0 && (
                              <button
                                onClick={e => { e.stopPropagation(); setLightbox(l => l! - 1) }}
                                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xl"
                                style={{ background: 'rgba(255,255,255,0.15)' }}
                              >‹</button>
                            )}
                            {/* Next */}
                            {lightbox < imgs2.length - 1 && (
                              <button
                                onClick={e => { e.stopPropagation(); setLightbox(l => l! + 1) }}
                                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xl"
                                style={{ background: 'rgba(255,255,255,0.15)' }}
                              >›</button>
                            )}
                            {/* Close */}
                            <button
                              onClick={() => setLightbox(null)}
                              className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-white"
                              style={{ background: 'rgba(255,255,255,0.15)' }}
                            >
                              <X size={16} strokeWidth={2.5} />
                            </button>
                            {/* Image */}
                            <img
                              src={imgs2[lightbox].thumbnail_path}
                              alt={imgs2[lightbox].file_name}
                              className="rounded-xl object-contain"
                              style={{ maxWidth: '90vw', maxHeight: '88vh' }}
                              onClick={e => e.stopPropagation()}
                            />
                            {/* Drive link */}
                            <a
                              href={imgs2[lightbox].drive_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="absolute bottom-4 text-[11px] font-semibold px-3 py-1.5 rounded-full"
                              style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.75)' }}
                            >
                              {lightbox + 1} / {imgs2.length} · Google Drive で開く →
                            </a>
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}

                {/* Tags */}
                {post.tags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-5">
                    {post.tags.map((t: string) => (
                      <span key={t} className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: '#FDE8D0', color: '#C05A18' }}>
                        #{t}
                      </span>
                    ))}
                  </div>
                )}

                {/* Action bar */}
                <div
                  className="flex items-center gap-1 pt-4"
                  style={{ borderTop: '1px solid #F0E8D8' }}
                >
                  <button
                    onClick={() => likeMutation.mutate(!liked)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-bold transition-all active:scale-90"
                    style={{
                      background: liked ? '#FDE8D0' : 'transparent',
                      color: liked ? '#E8732A' : '#A8906E',
                    }}
                  >
                    <Heart size={16} strokeWidth={2} fill={liked ? '#E8732A' : 'none'} color={liked ? '#E8732A' : '#A8906E'} />
                    {likesCount ?? 0} いいね
                  </button>
                  <button
                    onClick={() => inputRef.current?.focus()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-bold transition-colors"
                    style={{ color: '#A8906E' }}
                  >
                    <MessageCircle size={16} strokeWidth={2} color="#A8906E" />
                    {comments.length} コメント
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => bookmarkMutation.mutate(!bookmarked)}
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all active:scale-90"
                    style={{ color: bookmarked ? '#E8732A' : '#A8906E' }}
                  >
                    <Bookmark
                      size={16}
                      strokeWidth={2}
                      fill={bookmarked ? '#E8732A' : 'none'}
                      color={bookmarked ? '#E8732A' : '#A8906E'}
                    />
                  </button>
                </div>
              </motion.div>
            )}
          </div>
        </div>

        {/* RIGHT — comments panel */}
        <div className="flex flex-col flex-shrink-0" style={{ width: hasComments ? 320 : 240 }}>

          {/* Comments header */}
          <div
            className="px-4 py-3 flex-shrink-0 flex items-center gap-2"
            style={{ borderBottom: '1px solid #F0E8D8' }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#E8732A' }} />
            <span className="font-extrabold text-[13px] text-brand-dark">
              コメント{commentsLoading ? '' : ` (${comments.length})`}
            </span>
          </div>

          {/* Comments list — scrollable */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {commentsLoading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#E8732A', borderTopColor: 'transparent' }} />
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[140px] text-center py-6">
                <div className="text-3xl mb-2 opacity-50">💬</div>
                <div className="text-[12px] text-brand-muted font-semibold">最初のコメントを投稿しよう</div>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {comments.map((c, i) => <CommentItem key={c.id} comment={c} idx={i} />)}
                <div ref={commentsEndRef} />
              </div>
            )}
          </div>

          {/* Comment input — sticky at bottom of right panel */}
          <div
            className="flex-shrink-0 px-3 py-3"
            style={{ borderTop: '1px solid #E4D4B8', background: 'rgba(244,237,218,0.95)', backdropFilter: 'blur(12px)' }}
          >
            <div
              className="flex items-center gap-2 px-3 py-2 rounded-2xl"
              style={{ background: '#FFFDF7', border: '1.5px solid #E4D4B8' }}
            >
              <Avatar name={user?.full_name} avatarUrl={user?.avatar_url} size={26} gradient />
              <input
                ref={inputRef}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                placeholder="コメントを追加…"
                className="flex-1 bg-transparent outline-none text-[12.5px] text-brand-dark placeholder-brand-muted"
              />
              <button
                onClick={submit}
                disabled={!draft.trim() || addComment.isPending}
                className="w-6 h-6 rounded-full flex items-center justify-center transition-all disabled:opacity-35"
                style={{ background: draft.trim() ? '#E8732A' : '#E4D4B8' }}
              >
                <Send size={11} strokeWidth={2.5} color="#FFFFFF" style={{ transform: 'rotate(-45deg)', marginLeft: 1 }} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── exported component ────────────────────────────────────────────────────────

interface PostDetailProps { asModal?: boolean }

export default function PostDetail({ asModal = false }: PostDetailProps) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const close = () => navigate(-1)

  if (!id) return null

  if (asModal) {
    return (
      <AnimatePresence>
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ background: 'rgba(58,42,26,0.5)', backdropFilter: 'blur(6px)' }}
          onClick={close}
        >
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            onClick={e => e.stopPropagation()}
            className="w-full flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden"
            style={{
              background: '#F4EDDA',
              maxWidth: 'min(96vw, 920px)',
              height: 'min(88vh, 820px)',
            }}
          >
            <PostDetailContent id={id} asModal onClose={close} />
          </motion.div>
        </motion.div>
      </AnimatePresence>
    )
  }

  return (
    <div className="h-screen flex flex-col" style={{ background: '#F4EDDA' }}>
      <PostDetailContent id={id} asModal={false} onClose={close} />
    </div>
  )
}
