import { useState } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from './contexts/AuthContext'
import { useSSE } from './hooks/useSSE'
import Login from './pages/Login'
import Feed from './pages/Feed'
import Notifications from './pages/Notifications'
import Profile from './pages/Profile'
import PostDetail from './pages/PostDetail'
import AdminPanel from './pages/AdminPanel'
import Bookmarks from './pages/Bookmarks'
import Navigation from './components/Navigation'
import AppHeader from './components/AppHeader'
import PostComposer from './components/PostComposer'
import UserProfilePanel from './components/UserProfilePanel'
import { useQuery } from '@tanstack/react-query'
import { api } from './lib/api'
import type { Location } from 'react-router-dom'

function AppShell() {
  const [activeTab, setActiveTab]       = useState<string>('feed')
  const [searchQuery, setSearchQuery]   = useState<string>('')
  const [composerOpen, setComposerOpen] = useState<boolean>(false)
  const { user } = useAuth()
  const location = useLocation()
  useSSE()

  // Background location set by PostCard/Notifications when navigating to a post
  // from within the app — keeps the feed mounted while modal overlays it
  const background = (location.state as { background?: Location } | null)?.background

  const { data: notifData } = useQuery<unknown, Error, number>({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications'),
    select: (d: any) => (d.notifications as Array<{ read_at: string | null }>).filter(n => !n.read_at).length,
  })
  const unreadCount = notifData ?? 0

  const renderPage = () => {
    switch (activeTab) {
      case 'feed':
      case 'search':
        return <Feed searchQuery={searchQuery} activeTab={activeTab} onCompose={() => setComposerOpen(true)} />
      case 'notifications':
        return <Notifications />
      case 'profile':
        return <Profile />
      case 'admin':
        return <AdminPanel />
      case 'bookmarks':
        return <Bookmarks />
      default:
        return <Feed searchQuery={searchQuery} activeTab={activeTab} onCompose={() => setComposerOpen(true)} />
    }
  }

  return (
    <>
      {/* Main shell — always rendered; when background exists the Routes below
          receives the background location so the feed stays visible */}
      <Routes location={background ?? location}>
        <Route path="/posts/:id" element={
          <div className="min-h-screen bg-brand-cream">
            <AppHeader
              user={user}
              searchQuery={searchQuery}
              onSearch={q => { setSearchQuery(q); setActiveTab('search') }}
              onSearchClear={() => { setSearchQuery(''); setActiveTab('feed') }}
              onAdmin={() => setActiveTab('admin')}
            />
            <main className="pb-32"><PostDetail /></main>
            <Navigation
              activeTab={activeTab}
              setActiveTab={tab => { setActiveTab(tab); if (tab !== 'search') setSearchQuery('') }}
              unreadCount={unreadCount}
              onCompose={() => setComposerOpen(true)}
              canPost={user?.can_post ?? true}
            />
          </div>
        } />
        <Route path="/" element={
          <div className="min-h-screen bg-brand-cream">
            <AppHeader
              user={user}
              searchQuery={searchQuery}
              onSearch={q => { setSearchQuery(q); setActiveTab('search') }}
              onSearchClear={() => { setSearchQuery(''); setActiveTab('feed') }}
              onAdmin={() => setActiveTab('admin')}
            />
            <main className="pb-32">
              <AnimatePresence mode="popLayout">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, y: 8, scale: 0.995 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.995 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                >
                  {renderPage()}
                </motion.div>
              </AnimatePresence>
            </main>
            <Navigation
              activeTab={activeTab}
              setActiveTab={tab => { setActiveTab(tab); if (tab !== 'search') setSearchQuery('') }}
              unreadCount={unreadCount}
              onCompose={() => setComposerOpen(true)}
              canPost={user?.can_post ?? true}
            />
            {composerOpen && user?.can_post && <PostComposer onClose={() => setComposerOpen(false)} />}
          </div>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Modal overlays — only rendered when navigated from within the app */}
      {background && (
        <Routes>
          <Route path="/posts/:id"  element={<PostDetail asModal />} />
          <Route path="/users/:id"  element={<UserProfilePanel />} />
        </Routes>
      )}
    </>
  )
}

export default function App() {
  const { user } = useAuth()

  if (user === undefined) {
    return (
      <div className="min-h-screen bg-brand-cream flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Login />
  return <AppShell />
}
