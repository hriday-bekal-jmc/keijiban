import { QueryClient, keepPreviousData } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
    },
  },
})
