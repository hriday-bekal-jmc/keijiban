import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Heart, MessageCircle, Bookmark, Send, X } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { UserHoverCard } from '../components/UserHoverCard'
import { renderMarkdown } from '../lib/markdown'
import { postTypeMeta, initials, formatRelative, patchPostCaches, useAddComment } from '../lib/postMeta'
import type { Post, Comment } from '../types'

// ── helpers ───────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#7A5C30','#C05A18','#1E5FA8','#1A7A48','#6B35A8','#C07090','#2E6818']

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
  const { bg, color, label } = postTypeMeta(type)
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
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(idx * 0.035, 0.22) }}
      className="flex gap-3 items-start group"
    >
      <UserHoverCard userId={comment.author_id} userName={comment.author_name}>
        <div className="flex-shrink-0 mt-0.5">
          <Avatar name={comment.author_name} size={32} colorIdx={idx} />
        </div>
      </UserHoverCard>
      <div className="flex-1 min-w-0 pb-3" style={{ borderBottom: '1px solid #F0E8D8' }}>
        <p className="text-[13px] leading-[1.6]" style={{ color: '#3A2A1A' }}>
          <span className="font-extrabold mr-1.5">{comment.author_name}</span>
          <span style={{ color: '#5A4030', fontWeight: 400 }}>{comment.content}</span>
        </p>
        <div className="text-[10.5px] mt-1 font-medium" style={{ color: '#B8A890' }}>
          {formatRelative(comment.created_at)}
        </div>
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

  // Record view once when post loads (fire-and-forget; API ignores author's own views)
  useEffect(() => {
    if (!id) return
    api.post(`/posts/${id}/view`, {}).catch(() => {})
  }, [id])

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
      // Mirror into feed + profile caches so PostCard views stay in sync
      patchPostCaches(queryClient, id, p => ({
        ...p,
        liked_by_me: isLiked,
        likes_count: isLiked ? Number(p.likes_count) + 1 : Number(p.likes_count) - 1,
      }))
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

  const addComment = useAddComment(id, { onClear: () => setDraft('') })

  const submit = () => {
    if (draft.trim() && !addComment.isPending) addComment.mutate(draft.trim())
  }

  const hasComments = comments.length > 0

  // ── shared comment input JSX ──
  const commentInputJSX = (
    <div className="flex items-center gap-3">
      <Avatar name={user?.full_name} avatarUrl={user?.avatar_url} size={30} gradient />
      <div className="flex-1 flex items-center gap-2 px-3.5 py-2 rounded-full" style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}>
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder="コメントを追加…"
          className="flex-1 bg-transparent outline-none text-[13px] text-brand-dark placeholder-brand-muted min-w-0"
        />
        <AnimatePresence>
          {draft.trim() && (
            <motion.button
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.12 }}
              onClick={submit}
              disabled={addComment.isPending}
              className="text-[12px] font-extrabold flex-shrink-0 disabled:opacity-50"
              style={{ color: '#E8732A' }}
            >
              送信
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  )

  // ── mobile-only comments list JSX ──
  const commentsListJSX = commentsLoading ? (
    <div className="flex justify-center py-8">
      <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#E8732A', borderTopColor: 'transparent' }} />
    </div>
  ) : comments.length === 0 ? (
    <div className="flex flex-col items-center justify-center text-center py-8">
      <div className="text-3xl mb-2 opacity-50">💬</div>
      <div className="text-[12px] text-brand-muted font-semibold">最初のコメントを投稿しよう</div>
    </div>
  ) : (
    <div className="flex flex-col">
      {comments.map((c, i) => <CommentItem key={c.id} comment={c} idx={i} />)}
      <div ref={commentsEndRef} />
    </div>
  )

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

      {/* ── Body: mobile = single scroll column, sm+ = two columns ── */}
      <div className="flex-1 flex flex-col sm:flex-row overflow-y-auto sm:overflow-hidden">

        {/* Post content — full width on mobile, left column on desktop */}
        <div className="min-w-0 sm:flex-1 sm:overflow-y-auto sm:border-r sm:border-[#E4D4B8]">
          <div className="px-4 sm:px-6 py-5 sm:py-6 sm:max-w-[680px]">

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
                    <Avatar name={post.author_name} avatarUrl={(post as any).author_avatar} size={44} gradient />
                  </UserHoverCard>
                  <div className="flex-1 min-w-0">
                    <div className="font-extrabold text-[14px] text-brand-dark truncate">{post.author_name}</div>
                    <div className="text-[11px] text-brand-muted truncate">
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
                  style={{ fontSize: 22, letterSpacing: '-0.5px', lineHeight: 1.28 }}
                >
                  {post.title}
                </h1>

                {/* Content */}
                <div
                  className="text-[14px] leading-[1.85] mb-5"
                  style={{ color: '#3A2A1A', fontWeight: 450, overflowWrap: 'break-word', wordBreak: 'break-word', minWidth: 0 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(post.content) }}
                />

                {/* Image gallery — skip images already embedded inline in content */}
                {(() => {
                  const inlinePaths = new Set(
                    [...post.content.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1])
                  )
                  const imgs: any[] = (post.attachments?.filter((a: any) => a.thumbnail_path && !inlinePaths.has(a.thumbnail_path)) ?? [])
                  const files: any[] = post.attachments?.filter((a: any) => !a.thumbnail_path) ?? []
                  if (imgs.length === 0 && files.length === 0) return null
                  return (
                    <div className="mb-5">
                      {imgs.length > 0 && (
                        <div className="mb-2 rounded-2xl overflow-hidden" style={{ border: '1px solid #E4D4B8' }}>
                          {imgs.length === 1 && (
                            <img src={imgs[0].thumbnail_path} alt={imgs[0].file_name} className="w-full object-cover cursor-zoom-in" style={{ maxHeight: 480 }} onClick={() => setLightbox(0)} />
                          )}
                          {imgs.length === 2 && (
                            <div className="flex gap-0.5" style={{ height: 280 }}>
                              {imgs.map((a: any, i: number) => (
                                <img key={a.id} src={a.thumbnail_path} alt={String(i + 1)} className="flex-1 object-cover cursor-zoom-in" onClick={() => setLightbox(i)} />
                              ))}
                            </div>
                          )}
                          {imgs.length === 3 && (
                            <div>
                              <img src={imgs[0].thumbnail_path} alt="1" className="w-full object-cover cursor-zoom-in" style={{ height: 200 }} onClick={() => setLightbox(0)} />
                              <div className="flex gap-0.5 mt-0.5" style={{ height: 160 }}>
                                <img src={imgs[1].thumbnail_path} alt="2" className="flex-1 object-cover cursor-zoom-in" onClick={() => setLightbox(1)} />
                                <img src={imgs[2].thumbnail_path} alt="3" className="flex-1 object-cover cursor-zoom-in" onClick={() => setLightbox(2)} />
                              </div>
                            </div>
                          )}
                          {imgs.length >= 4 && (
                            <div className="grid grid-cols-2 gap-0.5">
                              {imgs.slice(0, Math.min(imgs.length, 4)).map((a: any, i: number) => (
                                <div key={a.id} className="relative overflow-hidden" style={{ height: 170 }}>
                                  <img src={a.thumbnail_path} alt={String(i + 1)} className="w-full h-full object-cover cursor-zoom-in" onClick={() => setLightbox(i)} />
                                  {i === 3 && imgs.length > 4 && (
                                    <div className="absolute inset-0 flex items-center justify-center cursor-zoom-in" style={{ background: 'rgba(58,42,26,0.58)' }} onClick={() => setLightbox(3)}>
                                      <span className="text-white font-extrabold" style={{ fontSize: 28 }}>+{imgs.length - 4}</span>
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
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
                            {lightbox > 0 && (
                              <button onClick={e => { e.stopPropagation(); setLightbox(l => l! - 1) }} className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xl" style={{ background: 'rgba(255,255,255,0.15)' }}>‹</button>
                            )}
                            {lightbox < imgs2.length - 1 && (
                              <button onClick={e => { e.stopPropagation(); setLightbox(l => l! + 1) }} className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-xl" style={{ background: 'rgba(255,255,255,0.15)' }}>›</button>
                            )}
                            <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center text-white" style={{ background: 'rgba(255,255,255,0.15)' }}>
                              <X size={16} strokeWidth={2.5} />
                            </button>
                            <img src={imgs2[lightbox].thumbnail_path} alt={imgs2[lightbox].file_name} className="rounded-xl object-contain" style={{ maxWidth: '90vw', maxHeight: '88vh' }} onClick={e => e.stopPropagation()} />
                            <a href={imgs2[lightbox].drive_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="absolute bottom-4 text-[11px] font-semibold px-3 py-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.75)' }}>
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
                <div className="flex items-center gap-1 pt-4" style={{ borderTop: '1px solid #F0E8D8' }}>
                  <button
                    onClick={() => likeMutation.mutate(!liked)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-bold transition-all active:scale-90"
                    style={{ background: liked ? '#FDE8D0' : 'transparent', color: liked ? '#E8732A' : '#A8906E' }}
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
                    <Bookmark size={16} strokeWidth={2} fill={bookmarked ? '#E8732A' : 'none'} color={bookmarked ? '#E8732A' : '#A8906E'} />
                  </button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Mobile-only: comments + input flow inline after post — Instagram style */}
          {!postLoading && !isError && (
            <div className="sm:hidden" style={{ borderTop: '1px solid #E4D4B8' }}>
              {/* Section header */}
              <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #F0E8D8' }}>
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#E8732A' }} />
                <span className="font-extrabold text-[13px] text-brand-dark">
                  コメント{commentsLoading ? '' : ` (${comments.length})`}
                </span>
              </div>

              {/* Comments list */}
              <div className="px-4 py-4">
                {commentsListJSX}
              </div>

              {/* Comment input — part of scroll, at the very bottom */}
              <div className="px-4 pb-8 pt-2" style={{ borderTop: '1px solid #F0E8D8' }}>
                {commentInputJSX}
              </div>
            </div>
          )}
        </div>

        {/* Desktop-only: right comments panel */}
        <div className="hidden sm:flex flex-col flex-shrink-0" style={{ width: 340, borderLeft: '1px solid #EDE4D0', background: '#FFFDF7' }}>
          {/* Panel header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #F0E8D8' }}>
            <div className="flex items-center gap-2">
              <MessageCircle size={15} color="#E8732A" strokeWidth={2.5} />
              <span className="font-extrabold text-[14px] text-brand-dark" style={{ letterSpacing: '-0.2px' }}>
                コメント
              </span>
              {!commentsLoading && comments.length > 0 && (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FDE8D0', color: '#E8732A' }}>
                  {comments.length}
                </span>
              )}
            </div>
          </div>

          {/* Comments list */}
          <div className="flex-1 overflow-y-auto">
            {commentsLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-5 h-5 border-2 rounded-full animate-spin" style={{ borderColor: '#E8732A', borderTopColor: 'transparent' }} />
              </div>
            ) : comments.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center h-full min-h-[120px] px-6">
                <div className="text-[36px] mb-3 opacity-30">💬</div>
                <div className="text-[13px] font-semibold" style={{ color: '#B8A890' }}>まだコメントはありません</div>
                <div className="text-[11px] mt-1" style={{ color: '#C8B898' }}>最初のコメントを投稿しよう</div>
              </div>
            ) : (
              <div className="px-5 pt-4">
                {comments.map((c, i) => <CommentItem key={c.id} comment={c} idx={i} />)}
                <div ref={commentsEndRef} className="pb-4" />
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="flex-shrink-0 px-4 py-4" style={{ borderTop: '1px solid #F0E8D8', background: '#FFFDF7' }}>
            {commentInputJSX}
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
            className="w-full sm:max-w-[980px] flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden"
            style={{
              background: '#F4EDDA',
              height: 'min(96dvh, 860px)',
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
