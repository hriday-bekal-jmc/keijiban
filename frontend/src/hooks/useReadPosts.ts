import { useState, useCallback } from 'react'

const KEY = 'kb_read_posts'

function load(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')) }
  catch { return new Set() }
}

export function useReadPosts() {
  const [read, setRead] = useState<Set<string>>(load)

  const markRead = useCallback((id: string) => {
    setRead(prev => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem(KEY, JSON.stringify([...next])) } catch { /* quota */ }
      return next
    })
  }, [])

  return { read, markRead }
}
