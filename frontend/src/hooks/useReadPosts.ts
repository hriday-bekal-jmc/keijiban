import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { patchPostCaches } from '../lib/postMeta'

// Long enough to coalesce a burst of scrolling into one request, short enough
// that a normal tab-close still flushes via the beacon path below.
const FLUSH_DELAY_MS = 1500

interface ReadablePost {
  id: string
  viewed_by_me?: boolean
}

/**
 * Read state is server-authoritative: the API returns `viewed_by_me` per post
 * (backed by post_views), so it follows the user across devices and survives
 * a cleared cache. This hook only adds the optimistic layer — ids marked in
 * this session read as read immediately, and are flushed to the server in one
 * batched request rather than one request per post.
 */
export function useReadPosts() {
  const queryClient = useQueryClient()
  const [locallyRead, setLocallyRead] = useState<Set<string>>(() => new Set())
  const pending = useRef<Set<string>>(new Set())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback((useBeacon = false) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const ids = [...pending.current]
    if (ids.length === 0) return
    pending.current.clear()

    // On tab-hide a normal fetch can be killed mid-flight; sendBeacon is the
    // platform's guaranteed-delivery path for exactly this case.
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/posts/views', new Blob([JSON.stringify({ ids })], { type: 'application/json' }))
      return
    }
    api.post('/posts/views', { ids }).catch(() => {
      // Re-queue so the next flush retries instead of dropping the reads
      ids.forEach(id => pending.current.add(id))
    })
  }, [])

  const markRead = useCallback((id: string) => {
    setLocallyRead(prev => (prev.has(id) ? prev : new Set(prev).add(id)))
    // Keep cached feed/profile copies in sync so the ring stays correct after
    // a tab switch remounts the feed from cache rather than refetching.
    patchPostCaches(queryClient, id, p => (p.viewed_by_me ? p : { ...p, viewed_by_me: true }))
    if (pending.current.has(id)) return
    pending.current.add(id)
    if (!timer.current) timer.current = setTimeout(() => flush(), FLUSH_DELAY_MS)
  }, [flush, queryClient])

  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true) }
    document.addEventListener('visibilitychange', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      flush(true)
    }
  }, [flush])

  /** Server truth first, then this session's optimistic marks. */
  const isRead = useCallback(
    (post: ReadablePost) => post.viewed_by_me === true || locallyRead.has(post.id),
    [locallyRead]
  )

  return { isRead, markRead }
}
