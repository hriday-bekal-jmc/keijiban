import { QueryClient, keepPreviousData } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      // Coming back to the tab picks up anything that changed while it was
      // hidden, so nothing needs a manual reload. The feed opts out with
      // staleTime: Infinity — it is SSE-driven and refetching it would reset
      // the infinite query to page 1 under a scrolled user.
      refetchOnWindowFocus: true,
      placeholderData: keepPreviousData,
    },
  },
})
