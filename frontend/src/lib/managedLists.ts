import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api } from './api'

/** The admin-curated lists. Adding one: add it here and mount it in the API. */
export type ListKind = 'departments' | 'branches' | 'categories'

export const LIST_KINDS: ListKind[] = ['departments', 'branches', 'categories']

/**
 * One cache key per list, shared by every reader AND by the admin editor.
 *
 * This previously differed per call site — the admin editor cached under
 * ['/branches'] while the feed and composer used ['branches'] — so they were
 * separate cache entries and invalidating after an edit never reached the
 * pickers. A new 拠点 or カテゴリ only appeared after a full page reload.
 */
export const listKey = (kind: ListKind) => ['managed-list', kind] as const

interface ManagedRow {
  id: string
  name: string
  color?: string
  sort_order: number
  is_active: boolean
}

/**
 * Reads a managed list. staleTime is deliberately finite (not Infinity): with
 * Infinity, React Query will not refetch on window focus, so a change made in
 * another tab or by another admin would never surface on its own.
 */
export function useManagedList<T extends ManagedRow = ManagedRow>(kind: ListKind) {
  return useQuery<{ items: T[] }>({
    queryKey: listKey(kind),
    queryFn: () => api.get(`/${kind}`),
    staleTime: 60_000,
  })
}

/** Convenience for pickers, which only ever want the enabled rows in order. */
export function useActiveList<T extends ManagedRow = ManagedRow>(kind: ListKind): T[] {
  const { data } = useManagedList<T>(kind)
  return (data?.items ?? []).filter(i => i.is_active)
}

/**
 * Refresh everything a list edit can affect: the list itself, and the content
 * that embeds its names/colours. Called after every create/update/delete so a
 * new entry is usable immediately, with no reload.
 */
export function refreshAfterListChange(qc: QueryClient, kind: ListKind): void {
  qc.invalidateQueries({ queryKey: listKey(kind) })
  // Posts embed category names/colours and the branch name
  qc.invalidateQueries({ queryKey: ['posts'] })
  qc.invalidateQueries({ queryKey: ['post'] })
  qc.invalidateQueries({ queryKey: ['pinned-posts'] })
  qc.invalidateQueries({ queryKey: ['bookmarks'] })
  // Admin user rows show department and branch names
  qc.invalidateQueries({ queryKey: ['admin-users'] })
}

/** Hook form, for components that already hold a client. */
export function useRefreshList() {
  const qc = useQueryClient()
  return (kind: ListKind) => refreshAfterListChange(qc, kind)
}
