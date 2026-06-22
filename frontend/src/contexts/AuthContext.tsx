import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { api } from '../lib/api'

export interface User {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: 'member' | 'admin'
  can_post: boolean
  department_id: string
  department_name: string
  vibe_emoji: string | null
  vibe_label: string | null
}

interface AuthContextValue {
  user: User | null | undefined
  login: (userData: User) => void
  logout: () => Promise<void>
  refreshUser: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null | undefined>(undefined) // undefined = loading

  const fetchMe = useCallback((): void => {
    api.get<{ user: User }>('/auth/me')
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
  }, [])

  useEffect(() => {
    fetchMe()
    // Listen for 401 interceptor event
    const handleExpired = (): void => setUser(null)
    window.addEventListener('auth:expired', handleExpired)
    return () => window.removeEventListener('auth:expired', handleExpired)
  }, [fetchMe])

  const login = (userData: User): void => setUser(userData)

  const refreshUser = useCallback((): void => { fetchMe() }, [fetchMe])

  const logout = async (): Promise<void> => {
    await api.post('/auth/logout').catch(() => {})
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
