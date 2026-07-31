import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { refreshAfterListChange, type ListKind } from '../lib/managedLists'

interface SSEEvent {
  type: 'NEW_POST' | 'LIKE' | 'UNLIKE' | 'NEW_COMMENT' | 'DELETE_POST' | 'PIN_POST' | 'NOTIFICATION'
      | 'MASTER_DATA' | 'PING' | 'CONNECTED'
  postId?: string
  count?: number
  isPinned?: boolean
  kind?: ListKind
}

// Server pings every 25s (see backend sse.ts). If nothing has arrived in this
// long, the socket is a zombie — TCP can stay "open" after a laptop sleeps or
// a mobile tab is backgrounded without ever firing onerror.
const STALE_AFTER_MS = 60_000
const STALE_CHECK_INTERVAL_MS = 15_000

type InfinitePostsData = {
  pages: Array<{ posts: Array<Record<string, unknown>>; nextCursor: unknown }>
  pageParams: unknown[]
}

// Patches a single post across all cached pages of the infinite feed query.
// Zero network requests — surgical in-memory update.
function patchPostInFeed(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string,
  patch: (p: Record<string, unknown>) => Record<string, unknown>
) {
  queryClient.setQueriesData({ queryKey: ['posts'] }, (old: unknown) => {
    const data = old as InfinitePostsData | undefined
    if (!data?.pages) return old
    return {
      ...data,
      pages: data.pages.map(page => ({
        ...page,
        posts: page.posts.map(p => (p.id === postId ? patch(p) : p)),
      })),
    }
  })
}

// Removes a post from all cached pages. Zero network requests.
function removePostFromFeed(
  queryClient: ReturnType<typeof useQueryClient>,
  postId: string
) {
  queryClient.setQueriesData({ queryKey: ['posts'] }, (old: unknown) => {
    const data = old as InfinitePostsData | undefined
    if (!data?.pages) return old
    return {
      ...data,
      pages: data.pages.map(page => ({
        ...page,
        posts: page.posts.filter(p => p.id !== postId),
      })),
    }
  })
  // Also clear any open detail view for this post
  queryClient.removeQueries({ queryKey: ['posts', postId] })
}

export function useSSE(): void {
  const queryClient = useQueryClient()
  const fallbackRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sseRef = useRef<EventSource | null>(null)
  const lastMessageRef = useRef<number>(Date.now())
  const masterDataTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const stopFallback = (): void => {
      if (!fallbackRef.current) return
      clearInterval(fallbackRef.current)
      fallbackRef.current = null
    }

    const startFallback = (): void => {
      if (fallbackRef.current) return
      // SSE down — poll notifications only (cheap query, not the full feed)
      fallbackRef.current = setInterval(() => {
        if (document.visibilityState === 'visible') {
          queryClient.invalidateQueries({ queryKey: ['notifications'] })
        }
      }, 60_000)
    }

    // (Re)creates the connection. Caller is responsible for closing any prior
    // EventSource first — reused for both the initial connect and zombie recovery.
    const connect = (): void => {
      const sse = new EventSource('/api/stream')
      sseRef.current = sse
      lastMessageRef.current = Date.now()

      sse.onopen = (): void => {
        stopFallback()
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      }

      sse.onmessage = (e: MessageEvent<string>): void => {
        lastMessageRef.current = Date.now()
        const ev: SSEEvent = JSON.parse(e.data)

        switch (ev.type) {

          // ── New post ────────────────────────────────────────────────────────
          // Don't auto-insert: we don't have the full post object in the event,
          // and silently scrolling users' feeds is jarring. Show a pill instead;
          // when the user clicks it we invalidate and refetch only the first page.
          case 'NEW_POST':
            queryClient.setQueryData(['newPostsAvailable'], true)
            break

          // ── Like / Unlike ───────────────────────────────────────────────────
          // Patch count in-place — authoritative value from DB, zero requests.
          case 'LIKE':
          case 'UNLIKE':
            if (ev.postId && ev.count !== undefined) {
              patchPostInFeed(queryClient, ev.postId, p => ({ ...p, likes_count: ev.count }))
              // 'post' (singular) matches PostDetail's queryKey: ['post', id]
              queryClient.invalidateQueries({ queryKey: ['post', ev.postId] })
              // likes_received in profile-stats changes when someone likes/unlikes your post
              queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
            }
            break

          // ── New comment ─────────────────────────────────────────────────────
          case 'NEW_COMMENT':
            if (ev.postId && ev.count !== undefined) {
              patchPostInFeed(queryClient, ev.postId, p => ({ ...p, comments_count: ev.count }))
              queryClient.invalidateQueries({ queryKey: ['comments', ev.postId] })
              queryClient.invalidateQueries({ queryKey: ['post', ev.postId] })
            }
            break

          // ── Delete post ─────────────────────────────────────────────────────
          // Remove from all cached pages immediately. Every connected user sees
          // it disappear with no polling or manual refresh.
          case 'DELETE_POST':
            if (ev.postId) {
              removePostFromFeed(queryClient, ev.postId)
              // posts_count drops if it was your post; profile-posts list changes too
              queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
              queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
            }
            break

          // ── Pin / Unpin ──────────────────────────────────────────────────────
          case 'PIN_POST':
            if (ev.postId && ev.isPinned !== undefined) {
              // Patch every loaded page in-place — SSE gives us the authoritative value
              // so no network round-trip needed. invalidateQueries(['posts']) would reset
              // the infinite query back to page 1, causing blank space for scrolled users.
              patchPostInFeed(queryClient, ev.postId, p => ({ ...p, is_pinned: ev.isPinned }))
              queryClient.invalidateQueries({ queryKey: ['post', ev.postId] })
              queryClient.invalidateQueries({ queryKey: ['pinned-posts'] })
            }
            break

          // ── Master data (部署 / 拠点 / カテゴリ) ─────────────────────────────
          // An admin changed a list. Everyone's pickers and filters refresh in
          // place. Coalesced because a drag-reorder issues several PUTs in a
          // row and each one announces.
          case 'MASTER_DATA':
            if (ev.kind) {
              const kind = ev.kind
              clearTimeout(masterDataTimer.current)
              masterDataTimer.current = setTimeout(
                () => refreshAfterListChange(queryClient, kind), 300)
            }
            break

          // ── Notification ────────────────────────────────────────────────────
          case 'NOTIFICATION':
            queryClient.invalidateQueries({ queryKey: ['notifications'] })
            break

          // PING/CONNECTED: no-op besides the lastMessageRef bump above —
          // their only job is proving the connection is alive.
        }
      }

      sse.onerror = (): void => startFallback()
    }

    // Force-close and reopen — used when the connection looks alive to the
    // browser (no onerror fired) but nothing has come through in a while.
    const forceReconnect = (): void => {
      sseRef.current?.close()
      connect()
    }

    connect()

    const staleCheck = setInterval(() => {
      if (Date.now() - lastMessageRef.current > STALE_AFTER_MS) forceReconnect()
    }, STALE_CHECK_INTERVAL_MS)

    // Timers are throttled/suspended in background tabs, so the interval above
    // may not fire promptly — check immediately when the tab regains focus
    // (the common case: laptop woke from sleep, phone app resumed).
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && Date.now() - lastMessageRef.current > STALE_AFTER_MS) {
        forceReconnect()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(staleCheck)
      clearTimeout(masterDataTimer.current)
      document.removeEventListener('visibilitychange', onVisible)
      sseRef.current?.close()
      stopFallback()
    }
  }, [queryClient])
}
