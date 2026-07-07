// Shared post-type metadata, tiny display helpers, and cross-cache patch
// helpers — previously copy-pasted across PostCard/PostDetail/Feed/Profile/
// Bookmarks/UserProfilePanel and friends.

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from './api'
import { useAuth } from '../contexts/AuthContext'

export interface PostTypeMeta { bg: string; color: string; label: string }

export const POST_TYPES: Record<string, PostTypeMeta> = {
  ANNOUNCEMENT: { bg: '#FDE8D0', color: '#B84A0E', label: '📢 お知らせ' },
  KNOWLEDGE:    { bg: '#D8EAF8', color: '#1E5FA8', label: '📚 ナレッジ' },
  DAILY_REPORT: { bg: '#D6F0E4', color: '#1A7A48', label: '📊 日報' },
  CHAT:         { bg: '#F0E8F8', color: '#6B35A8', label: '💬 雑談' },
  DEPARTMENT:   { bg: '#E8F0E0', color: '#2E6818', label: '🏢 部署' },
}

export const postTypeMeta = (type: string): PostTypeMeta => POST_TYPES[type] ?? POST_TYPES.CHAT

export const postTypeColor = (type: string): string => POST_TYPES[type]?.color ?? '#A8906E'

export const initials = (name?: string | null): string =>
  (name ?? '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'たった今'
  if (m < 60) return `${m}分前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}時間前`
  const d = Math.floor(h / 24)
  if (d < 7)  return `${d}日前`
  return new Date(iso).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })
}

/** Apply `patch` to one post in every feed page (['posts'] infinite cache)
 *  and the profile mini-grid (['profile-posts']). */
export function patchPostCaches(
  qc: QueryClient, postId: string, patch: (p: any) => any,
): void {
  qc.setQueriesData({ queryKey: ['posts'] }, (old: any) => {
    if (!old?.pages) return old
    return {
      ...old,
      pages: old.pages.map((page: any) => ({
        ...page,
        posts: page.posts.map((p: any) => (p.id === postId ? patch(p) : p)),
      })),
    }
  })
  qc.setQueriesData({ queryKey: ['profile-posts'] }, (old: any) => {
    if (!old?.posts) return old
    return { ...old, posts: old.posts.map((p: any) => (p.id === postId ? patch(p) : p)) }
  })
}

/** Optimistic add-comment mutation — inserts into ['comments', postId],
 *  rolls back on error, invalidates comment/post/stat caches. */
export function useAddComment(
  postId: string,
  opts?: { onClear?: () => void; onSuccess?: () => void; onError?: () => void },
) {
  const queryClient = useQueryClient()
  const { user } = useAuth()

  return useMutation<unknown, Error, string, { optimisticId: string }>({
    mutationFn: (content: string) => api.post(`/posts/${postId}/comments`, { content }),
    onMutate: async (content: string) => {
      await queryClient.cancelQueries({ queryKey: ['comments', postId] })
      const optimistic = {
        id: `opt-${Date.now()}`,
        content,
        created_at: new Date().toISOString(),
        author_id: user?.id,
        author_name: user?.full_name,
        author_avatar: user?.avatar_url ?? null,
      }
      queryClient.setQueryData(['comments', postId], (old: any) => ({
        comments: [...(old?.comments ?? []), optimistic],
      }))
      opts?.onClear?.()
      return { optimisticId: optimistic.id }
    },
    onSuccess: () => opts?.onSuccess?.(),
    onError: (_e, _v, ctx) => {
      queryClient.setQueryData(['comments', postId], (old: any) => ({
        comments: (old?.comments ?? []).filter((c: any) => c.id !== ctx?.optimisticId),
      }))
      opts?.onError?.()
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
    },
  })
}

/** Optimistic delete-comment mutation — removes from ['comments', postId]
 *  immediately, rolls back on error. */
export function useDeleteComment(postId: string) {
  const queryClient = useQueryClient()

  return useMutation<void, Error, string, { prev?: { comments: any[] } }>({
    mutationFn: (commentId: string) => api.delete(`/posts/${postId}/comments/${commentId}`),
    onMutate: (commentId: string) => {
      const prev = queryClient.getQueryData<{ comments: any[] }>(['comments', postId])
      queryClient.setQueryData(['comments', postId], (old: { comments: any[] } | undefined) =>
        old ? { comments: old.comments.filter(c => c.id !== commentId) } : old)
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(['comments', postId], ctx.prev)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', postId] })
      queryClient.invalidateQueries({ queryKey: ['posts'] })
    },
  })
}
