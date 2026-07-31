import { useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { NotificationSkeleton } from '../components/Skeletons'
import { initials as initialsOf } from '../lib/postMeta'
import type { Notification } from '../types'

const PER_PAGE = 30

const AVATAR_COLORS = ['#7A5C30', '#C05A18', '#1E5FA8', '#1A7A48', '#6B35A8']

type NotificationType = 'NEW_POST' | 'NEW_COMMENT' | 'LIKE'

const TYPE_LABEL: Record<NotificationType, (actor: string) => React.ReactNode> = {
  NEW_POST:    (actor) => <><span className="font-bold">{actor}</span><span className="text-brand-mid"> が新しい投稿をしました</span></>,
  NEW_COMMENT: (actor) => <><span className="font-bold">{actor}</span><span className="text-brand-mid"> がコメントしました</span></>,
  LIKE:        (actor) => <><span className="font-bold">{actor}</span><span className="text-brand-mid"> があなたの投稿にいいねしました</span></>,
}

const TYPE_ICON: Record<NotificationType, string> = {
  NEW_POST:    '📢',
  NEW_COMMENT: '💬',
  LIKE:        '❤️',
}

interface NotificationsResponse {
  notifications: Notification[]
}

export default function Notifications() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const [filter, setFilter] = useState<'unread' | 'all'>('all')

  // Paginated list under the ['notifications', ...] prefix so existing
  // invalidations (SSE NOTIFICATION events, mark-read) refresh it too.
  // Older notifications stay reachable via もっと見る instead of being cut
  // off at the backend's single-page cap.
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<NotificationsResponse>({
    queryKey: ['notifications', 'list'],
    queryFn: ({ pageParam }) => api.get(`/notifications?limit=${PER_PAGE}&offset=${(pageParam as number) * PER_PAGE}`),
    getNextPageParam: (last, pages) => last.notifications.length === PER_PAGE ? pages.length : undefined,
    initialPageParam: 0,
    staleTime: 30_000,
  })

  const markAll = useMutation<void, Error, void>({
    mutationFn: () => api.post('/notifications/read', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const markOne = useMutation<void, Error, string>({
    mutationFn: (id: string) => api.post('/notifications/read', { ids: [id] }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const all: Notification[] = data?.pages.flatMap(p => p.notifications) ?? []
  const unread = all.filter((n: Notification) => !n.read_at)
  const notifications = filter === 'unread' ? unread : all

  const handleClick = (n: Notification) => {
    if (!n.read_at) markOne.mutate(n.id)
    navigate(`/posts/${n.post_id}`, { state: { background: location } })
  }

  return (
    <div className="max-w-[960px] mx-auto px-4 pt-0">
      {/* Sticky bar */}
      <div
        className="sticky z-40 flex items-center justify-between py-3 mb-4"
        style={{
          top: 56,
          background: 'rgba(244,237,218,0.96)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(200,175,130,0.30)',
        }}
      >
        <div className="flex items-center gap-2 font-extrabold text-[17px] text-brand-dark" style={{ letterSpacing: '-0.4px' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: '#E8732A' }} />
          通知
          {unread.length > 0 && (
            <span
              className="ml-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full text-white"
              style={{ background: '#E8732A' }}
            >
              {unread.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 未読 / すべて filter */}
          <div className="flex gap-1 p-0.5 rounded-full" style={{ background: 'rgba(58,42,26,0.08)' }}>
            {([['all', 'すべて'], ['unread', '未読']] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setFilter(id)}
                className="px-3 py-1 rounded-full text-[11.5px] font-bold transition-colors"
                style={filter === id
                  ? { background: '#FFFDF7', color: '#E8732A', boxShadow: '0 1px 4px rgba(60,30,10,0.08)' }
                  : { color: '#8A7A68' }}
              >
                {label}
              </button>
            ))}
          </div>
          {unread.length > 0 && (
            <button
              onClick={() => markAll.mutate()}
              className="text-[12px] font-bold px-3 py-1.5 rounded-full transition-colors"
              style={{ color: '#E8732A' }}
              onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.style.background = '#FDE8D0'}
              onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => e.currentTarget.style.background = 'transparent'}
            >
              すべて既読
            </button>
          )}
        </div>
      </div>

      <div className="max-w-[560px] mx-auto">
        {isLoading && (
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map(i => <NotificationSkeleton key={i} />)}
          </div>
        )}

        {!isLoading && notifications.length === 0 && (
          <div className="text-center py-20">
            <div className="text-5xl mb-4">{filter === 'unread' ? '✅' : '🔔'}</div>
            <div className="font-extrabold text-brand-dark text-base mb-2">
              {filter === 'unread' ? '未読の通知はありません' : '通知はありません'}
            </div>
            <div className="text-brand-muted text-[13px]">
              {filter === 'unread' ? 'すべて既読になっています' : '新しい通知が届くとここに表示されます'}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 kb-list">
          {notifications.map((n: Notification, i: number) => {
            const isUnread = !n.read_at
            const color = AVATAR_COLORS[i % AVATAR_COLORS.length]
            const initials = initialsOf(n.actor_name)
            const labelFn = TYPE_LABEL[n.type as NotificationType] ?? TYPE_LABEL.NEW_POST
            const icon = TYPE_ICON[n.type as NotificationType] ?? '🔔'

            return (
              <div
                key={n.id}
                onClick={() => handleClick(n)}
                className="flex items-start gap-3 px-4 py-3.5 rounded-2xl cursor-pointer transition-all"
                style={{
                  background: isUnread ? '#FDE8D0' : '#FFFDF7',
                  border: `1px solid ${isUnread ? '#F0C898' : '#E4D4B8'}`,
                }}
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.boxShadow = '0 3px 14px rgba(100,60,10,0.09)'}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Avatar with type icon badge */}
                <div className="relative flex-shrink-0">
                  {(n as { actor_avatar?: string | null }).actor_avatar ? (
                    <img
                      src={(n as { actor_avatar?: string | null }).actor_avatar!}
                      alt={n.actor_name ?? ''}
                      className="w-11 h-11 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white font-extrabold text-[13px]"
                      style={{ background: color }}
                    >
                      {initials}
                    </div>
                  )}
                  <div
                    className="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px]"
                    style={{ background: '#FFFDF7', border: '1.5px solid #E4D4B8' }}
                  >
                    {icon}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-brand-dark leading-snug mb-0.5">
                    {labelFn(n.actor_name ?? '誰か')}
                  </div>
                  <div className="text-[12px] font-semibold mb-1 truncate" style={{ color: '#E8732A' }}>
                    {n.post_title}
                  </div>
                  <div className="text-[11px] text-brand-muted">
                    {new Date(n.created_at).toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>

                {isUnread && (
                  <div className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: '#E8732A' }} />
                )}
              </div>
            )
          })}
        </div>

        {/* Load older notifications */}
        {hasNextPage && (
          <div className="flex justify-center mt-4">
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="px-5 py-2 rounded-full text-[12px] font-bold disabled:opacity-50 transition-opacity"
              style={{ background: '#F0E8D8', color: '#7A5C30' }}
            >
              {isFetchingNextPage ? '読み込み中…' : 'もっと見る'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
