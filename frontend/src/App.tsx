import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from './contexts/AuthContext'
import { useSSE } from './hooks/useSSE'
import Login from './pages/Login'
import Feed from './pages/Feed'
import Notifications from './pages/Notifications'
import Profile from './pages/Profile'
import Bookmarks from './pages/Bookmarks'
import AdminPanel from './pages/AdminPanel'
import Navigation from './components/Navigation'
import AppHeader from './components/AppHeader'
import UserProfilePanel from './components/UserProfilePanel'

// Code-split the heavy screens: PostComposer pulls in all of tiptap (~half the
// bundle); PostDetail is prefetched on card hover; DotGrid carries gsap and
// loads after first paint. AdminPanel stays a static import on purpose — a
// lazy chunk suspending inside the tab AnimatePresence swallows the outgoing
// page's exit callback, leaving an invisible full-height ghost that keeps the
// document scrollable long past the real content.
const PostComposer = lazy(() => import('./components/PostComposer'))
const PostDetail   = lazy(() => import('./pages/PostDetail'))
const DotGrid      = lazy(() => import('./components/DotGrid'))
import { useQuery } from '@tanstack/react-query'
import { api } from './lib/api'
import type { Location } from 'react-router-dom'
import type { ReactNode } from 'react'

// iOS-style bottom blur — 8 stacked backdrop-filter strips with staggered
// gradient masks. Values precomputed from the old GradualBlur component's
// single usage (position bottom, 7rem, strength 2.5, divCount 8, bezier curve),
// pixel-identical output. Fallback for no-backdrop-filter lives in index.css.
const BLUR_STRIPS = [
  { mask: 'transparent 0%, black 12.5%, black 25%, transparent 37.5%',   blur: '0.210rem' },
  { mask: 'transparent 12.5%, black 25%, black 37.5%, transparent 50%',  blur: '0.352rem' },
  { mask: 'transparent 25%, black 37.5%, black 50%, transparent 62.5%',  blur: '0.552rem' },
  { mask: 'transparent 37.5%, black 50%, black 62.5%, transparent 75%',  blur: '0.781rem' },
  { mask: 'transparent 50%, black 62.5%, black 75%, transparent 87.5%',  blur: '1.011rem' },
  { mask: 'transparent 62.5%, black 75%, black 87.5%, transparent 100%', blur: '1.211rem' },
  { mask: 'transparent 75%, black 87.5%, black 100%',                    blur: '1.353rem' },
  { mask: 'transparent 87.5%, black 100%',                               blur: '1.406rem' },
]

function AppShell() {
  const [searchQuery, setSearchQuery]               = useState<string>('')
  const [composerOpen, setComposerOpen]             = useState<boolean>(false)
  const [bookmarksInitialTab, setBookmarksInitialTab] = useState<'saved' | 'events' | 'pinned'>('saved')
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  useSSE()

  // Tab is derived from the URL (?tab=), not local state. This is what makes
  // browser back/forward and page refresh behave correctly between tabs, and
  // what makes closing a post/user modal return to the exact tab it was
  // opened from — the modal's `background` location carries the ?tab= with it.
  const activeTab = new URLSearchParams(location.search).get('tab') ?? 'feed'
  const setActiveTab = (tab: string) => {
    if (tab === activeTab) return // avoid spamming history (e.g. onSearch fires per keystroke)
    navigate(tab === 'feed' ? '/' : `/?tab=${tab}`)
  }

  // Reset scroll position when switching tabs. Without this, switching from a
  // long feed (scrolled 2000px) to a short page (admin, profile) leaves the
  // viewport showing blank space below the content.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeTab])

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
        return <Feed searchQuery={searchQuery} onCompose={() => setComposerOpen(true)} onEventsMore={() => { setBookmarksInitialTab('events'); setActiveTab('bookmarks') }} />
      case 'notifications':
        return <Notifications />
      case 'profile':
        return <Profile />
      case 'admin':
        return <AdminPanel />
      case 'bookmarks':
        return <Bookmarks initialTab={bookmarksInitialTab} />
      default:
        return <Feed searchQuery={searchQuery} onCompose={() => setComposerOpen(true)} onEventsMore={() => { setBookmarksInitialTab('events'); setActiveTab('bookmarks') }} />
    }
  }

  // Shared page chrome (header + nav) around each route's content.
  // `extra` renders inside the shell after Navigation (composer overlay).
  const shell = (children: ReactNode, extra?: ReactNode) => (
    <div className="min-h-[100dvh]" style={{ position: 'relative', zIndex: 2 }}>
      <AppHeader
        user={user}
        searchQuery={searchQuery}
        onSearch={q => { setSearchQuery(q); setActiveTab('search') }}
        onSearchClear={() => { setSearchQuery(''); setActiveTab('feed') }}
        onAdmin={() => setActiveTab('admin')}
        onProfile={() => setActiveTab('profile')}
      />
      <main style={{ paddingBottom: 'calc(8rem + env(safe-area-inset-bottom, 0px))' }}>{children}</main>
      <Navigation
        activeTab={activeTab}
        setActiveTab={tab => { if (tab === 'bookmarks') setBookmarksInitialTab('saved'); setActiveTab(tab); if (tab !== 'search') setSearchQuery('') }}
        unreadCount={unreadCount}
        onCompose={() => setComposerOpen(true)}
        canPost={user?.can_post ?? true}
      />
      {extra}
    </div>
  )

  return (
    <>
      {/* Fixed dot-grid background.
          z-index: 1 — above the html/body background layer, below content (z:2).
          pointer-events: none; DotGrid.tsx listens on window so it still tracks
          the mouse even though the canvas is behind all content. */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
        {/* Own Suspense boundary: the shell must not blank while this
            decorative chunk (DotGrid + gsap) streams in after first paint */}
        <Suspense fallback={null}>
          <DotGrid
            dotSize={3}
            gap={20}
            baseColor="#e2cfa0"
            activeColor="#c9a84c"
            proximity={45}
            speedTrigger={600}
            shockRadius={65}
            shockStrength={2}
            maxSpeed={1500}
            resistance={750}
            returnDuration={1.5}
          />
        </Suspense>
      </div>

      {/* Main shell — always rendered; when background exists the Routes below
          receives the background location so the feed stays visible */}
      <Routes location={background ?? location}>
        <Route path="/posts/:id" element={shell(<Suspense fallback={null}><PostDetail /></Suspense>)} />
        {/* Standalone user profile — accessed via direct URL (no background state).
            In-app navigation uses the modal overlay in the {background} block below. */}
        <Route path="/users/:id" element={shell(<UserProfilePanel standalone />)} />
        <Route path="/" element={shell(
          <AnimatePresence mode="popLayout">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8, scale: 0.995, pointerEvents: 'none' }}
              animate={{ opacity: 1, y: 0, scale: 1, pointerEvents: 'auto' }}
              exit={{ opacity: 0, scale: 0.995, pointerEvents: 'none' }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {renderPage()}
            </motion.div>
          </AnimatePresence>,
          composerOpen && user?.can_post && (
            <Suspense fallback={null}>
              <PostComposer onClose={() => setComposerOpen(false)} />
            </Suspense>
          )
        )} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* Modal overlays — only rendered when navigated from within the app */}
      {background && (
        <Routes>
          <Route path="/posts/:id"  element={<Suspense fallback={null}><PostDetail asModal /></Suspense>} />
          <Route path="/users/:id"  element={<UserProfilePanel />} />
        </Routes>
      )}

      {/* iOS-style bottom blur — mobile only (hidden on sm+).
          zIndex 40 keeps it below the navigation pill (z-50). */}
      <div
        className="sm:hidden bottom-blur"
        style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: '7rem', pointerEvents: 'none', zIndex: 40, isolation: 'isolate' }}
      >
        {BLUR_STRIPS.map((s, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              inset: 0,
              maskImage: `linear-gradient(to bottom, ${s.mask})`,
              WebkitMaskImage: `linear-gradient(to bottom, ${s.mask})`,
              backdropFilter: `blur(${s.blur})`,
              WebkitBackdropFilter: `blur(${s.blur})`,
            }}
          />
        ))}
      </div>
    </>
  )
}

export default function App() {
  const { user } = useAuth()

  if (user === undefined) {
    return (
      <div className="min-h-[100dvh] bg-brand-cream flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Login />
  return <AppShell />
}
