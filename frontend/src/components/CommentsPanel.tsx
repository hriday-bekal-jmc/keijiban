import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { initials as initialsOf, useAddComment } from '../lib/postMeta'
import { UserHoverCard } from './UserHoverCard'
import type { Comment } from '../types'

const COLORS = ['#7A5C30','#C05A18','#1E5FA8','#1A7A48','#6B35A8','#C07090']

interface AvatarProps {
  name: string
  avatarUrl?: string | null
  size?: number
  idx?: number
}

function Avatar({ name, avatarUrl, size = 28, idx = 0 }: AvatarProps) {
  const initials = initialsOf(name)
  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={name}
        className="rounded-full flex-shrink-0 object-cover"
        style={{ width: size, height: size }} />
    )
  }
  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-extrabold flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.33, background: COLORS[idx % COLORS.length] }}
    >
      {initials}
    </div>
  )
}

interface CommentsPanelProps {
  postId: string
  postTitle: string
  onClose: () => void
}

export default function CommentsPanel({ postId, postTitle, onClose }: CommentsPanelProps) {
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string>('')

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200) }, [])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const { data, isLoading } = useQuery<{ comments: Comment[] }>({
    queryKey: ['comments', postId],
    queryFn: () => api.get(`/posts/${postId}/comments`),
    staleTime: 15_000,
  })
  const comments: Comment[] = data?.comments ?? []

  const addComment = useAddComment(postId, { onClear: () => setDraft('') })

  const submit = () => {
    if (!draft.trim() || addComment.isPending) return
    addComment.mutate(draft.trim())
  }

  const initials = initialsOf(user?.full_name)

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(58,42,26,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <motion.div
          key="panel"
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 50 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
          className="w-full sm:max-w-lg flex flex-col rounded-t-3xl sm:rounded-3xl overflow-hidden"
          style={{
            background: '#FFFDF7',
            border: '1px solid #E4D4B8',
            maxHeight: '80vh',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid #E4D4B8' }}>
            <div>
              <div className="font-extrabold text-[14px] text-brand-dark">コメント</div>
              <div className="text-[11px] text-brand-muted truncate max-w-[240px]">{postTitle}</div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center text-brand-muted hover:text-brand-dark"
              style={{ background: '#F0E8D8' }}
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>

          {/* Comment list */}
          <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-4">
            {isLoading && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!isLoading && comments.length === 0 && (
              <div className="text-center py-10">
                <div className="text-3xl mb-2">💬</div>
                <div className="text-[13px] text-brand-muted">最初のコメントを投稿しよう</div>
              </div>
            )}

            {comments.map((c, i) => (
              <motion.div
                key={c.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                className="flex gap-2.5 items-start"
              >
                <UserHoverCard userId={c.author_id} userName={c.author_name}>
                  <Avatar name={c.author_name} avatarUrl={c.author_avatar} size={28} idx={i} />
                </UserHoverCard>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                    <span className="font-bold text-[12.5px] text-brand-dark">{c.author_name}</span>
                    {c.author_vibe_emoji && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5"
                        style={{ background: '#FDE8D0', color: '#C05A18' }}
                        title={c.author_vibe_label ?? undefined}
                      >
                        {c.author_vibe_emoji}
                        {c.author_vibe_label && <span className="hidden sm:inline">{c.author_vibe_label}</span>}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] text-brand-mid leading-relaxed">{c.content}</div>
                  <div className="text-[10.5px] text-brand-muted mt-0.5">
                    {new Date(c.created_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          {/* Input */}
          <div
            className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
            style={{ borderTop: '1px solid #E4D4B8' }}
          >
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.full_name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold text-[10px] flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #E87040, #F5A460)' }}
              >
                {initials}
              </div>
            )}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="コメントを追加…"
              className="flex-1 bg-transparent outline-none text-[13px] text-brand-dark placeholder-brand-muted"
            />
            <button
              onClick={submit}
              disabled={!draft.trim() || addComment.isPending}
              className="text-[13px] font-extrabold transition-opacity"
              style={{ color: '#E8732A', opacity: draft.trim() ? 1 : 0.4 }}
            >
              送信
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
