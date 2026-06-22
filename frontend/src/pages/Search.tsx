import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search as SearchIcon } from 'lucide-react'
import { api } from '../lib/api'
import PostCard from '../components/PostCard'
import type { Post } from '../types'

interface PostsSearchResponse {
  posts: Post[]
}

export default function Search() {
  const [q, setQ] = useState<string>('')
  const [submitted, setSubmitted] = useState<string>('')

  const { data, isLoading } = useQuery<PostsSearchResponse>({
    queryKey: ['posts', 'search', submitted],
    queryFn: () => api.get(`/posts?q=${encodeURIComponent(submitted)}&limit=30`),
    enabled: submitted.length > 0,
  })

  const posts: Post[] = data?.posts ?? []

  return (
    <div className="w-full max-w-2xl">
      <h2 className="text-2xl font-extrabold text-brand-dark mb-6">Search</h2>

      <form
        onSubmit={(e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); setSubmitted(q) }}
        className="flex gap-3 mb-8"
      >
        <div className="flex-1 relative">
          <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={q}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)}
            placeholder="Search posts..."
            className="w-full pl-11 pr-4 py-3 bg-white rounded-2xl border border-stone-200 focus:border-brand-orange focus:ring-2 focus:ring-brand-light outline-none text-sm text-brand-dark placeholder-stone-400 transition-all"
          />
        </div>
        <button
          type="submit"
          className="bg-brand-orange text-white px-6 py-3 rounded-2xl text-sm font-semibold hover:bg-orange-600 transition-colors"
        >
          Search
        </button>
      </form>

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {submitted && !isLoading && posts.length === 0 && (
        <div className="text-center py-12 text-stone-400 text-sm">
          No results for "{submitted}"
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        {posts.map(post => (
          <PostCard key={post.id} post={post} viewMode="board" />
        ))}
      </div>
    </div>
  )
}
