import { motion, AnimatePresence } from 'framer-motion'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { api } from '../lib/api'
import { colorFor } from '../lib/colors'
import { initials, formatRelative } from '../lib/postMeta'

interface Viewer {
  id: string
  full_name: string
  avatar_url: string | null
  viewed_at: string
  liked: boolean
  commented: boolean
}

interface ViewersModalProps {
  postId: string
  totalViews: number
  onClose: () => void
}

export default function ViewersModal({ postId, totalViews, onClose }: ViewersModalProps) {
  const { data, isLoading } = useQuery<{ viewers: Viewer[]; total: number }>({
    queryKey: ['post-views', postId],
    queryFn: () => api.get(`/posts/${postId}/views`),
    staleTime: 30_000,
  })

  const viewers = data?.viewers ?? []

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center p-0 sm:p-4"
        style={{ background: 'rgba(58,42,26,0.45)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl flex flex-col"
          style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', maxHeight: 'calc(100dvh - 80px)' }}
        >
          {/* Header */}
          <div className="flex-shrink-0 flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #E4D4B8' }}>
            <div>
              <div className="font-extrabold text-[15px] text-brand-dark flex items-center gap-1.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#E8732A" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                </svg>
                {totalViews}人が閲覧
              </div>
              <div className="text-[11px] text-brand-muted mt-0.5">投稿を開いたユーザー</div>
            </div>
            <button
              onClick={onClose}
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: '#F0E8D8', color: '#A8906E' }}
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>

          {/* Viewer list */}
          <div className="flex-1 overflow-y-auto overscroll-contain">
            {isLoading ? (
              <div className="flex justify-center py-10">
                <div className="w-6 h-6 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
              </div>
            ) : viewers.length === 0 ? (
              <div className="text-center py-10 text-brand-muted text-[13px]">まだ閲覧者はいません</div>
            ) : (
              <div className="flex flex-col divide-y divide-[#F4EDDA]">
                {viewers.map((v, i) => {
                  const ini = initials(v.full_name)
                  return (
                    <motion.div
                      key={v.id}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.025, 0.2) }}
                      className="flex items-center gap-3 px-5 py-3"
                    >
                      {v.avatar_url ? (
                        <img src={v.avatar_url} alt={v.full_name}
                          className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
                      ) : (
                        <div
                          className="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-[11px] flex-shrink-0"
                          style={{ background: colorFor(v.id) }}
                        >
                          {ini}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-[13px] text-brand-dark truncate">{v.full_name}</div>
                        <div className="text-[10.5px] text-brand-muted">{formatRelative(v.viewed_at)}</div>
                      </div>

                      {/* Interaction badges */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {v.liked && (
                          <span
                            className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: '#FDE8D0', color: '#E8732A' }}
                          >
                            ❤️
                          </span>
                        )}
                        {v.commented && (
                          <span
                            className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                            style={{ background: '#D8EAF8', color: '#1E5FA8' }}
                          >
                            💬
                          </span>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
