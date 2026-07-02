import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { api } from '../lib/api'
import type { User } from '../types'

export type { User }

interface AuthContextValue {
  user: User | null | undefined
  login: () => void
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

  // Re-fetch from /auth/me so the full profile (including department_name, vibe, etc.)
  // is always loaded from the canonical source, not from the login response body.
  const login = useCallback((): void => { fetchMe() }, [fetchMe])

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
