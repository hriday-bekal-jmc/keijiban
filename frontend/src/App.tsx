import { useState, useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { pageFade } from './lib/motion'
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

// Each tab is a real path — refresh keeps your place, back/forward moves
// between tabs, and any screen is linkable. The app itself never reloads;
// only the address bar changes.
const PATH_TO_TAB: Record<string, string> = {
  '/':              'feed',
  '/search':        'search',
  '/notifications': 'notifications',
  '/bookmarks':     'bookmarks',
  '/profile':       'profile',
  '/admin':         'admin',
}

function AppShell() {
  // Seed search from the URL so /search?q=… links open pre-filled
  const [searchQuery, setSearchQuery] = useState<string>(
    () => new URLSearchParams(window.location.search).get('q') ?? ''
  )
  const [debouncedSearch, setDebouncedSearch]       = useState<string>(searchQuery)
  const [composerOpen, setComposerOpen]             = useState<boolean>(false)
  const [bookmarksInitialTab, setBookmarksInitialTab] = useState<'saved' | 'events' | 'pinned'>('saved')
  const { user } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  useSSE()

  // Background location set by PostCard/Notifications when navigating to a post
  // from within the app — keeps the feed mounted while modal overlays it.
  // Tab derives from it while a modal is open, so the nav pill stays correct.
  const background = (location.state as { background?: Location } | null)?.background
  const baseLocation = background ?? location

  // '' when the screen belongs to no tab — a post or profile opened by direct
  // link, where there is no background location to derive one from. Falling
  // back to 'feed' here used to drag the nav pill to ホーム on those screens,
  // so opening a post from 通知 by link visibly moved the highlight. Navigation
  // treats '' as "no tab active" and leaves the pill where it was.
  const activeTab = PATH_TO_TAB[baseLocation.pathname] ?? ''
  const setActiveTab = (tab: string) => {
    if (tab === activeTab) return // avoid spamming history (e.g. onSearch fires per keystroke)
    navigate(tab === 'feed' ? '/' : `/${tab}`)
  }

  // Back-compat: redirect old /?tab=xxx bookmarks to the path form
  useEffect(() => {
    const legacy = new URLSearchParams(location.search).get('tab')
    if (legacy && location.pathname === '/') navigate(`/${legacy}`, { replace: true })
  }, [location, navigate])

  // Keep the settled search term in the URL (replace, not push — typing
  // shouldn't pile up history entries). Makes searches shareable/refreshable.
  useEffect(() => {
    if (activeTab !== 'search') return
    const q = debouncedSearch.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search', { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch])

  // Reset scroll position when switching tabs. Without this, switching from a
  // long feed (scrolled 2000px) to a short page (admin, profile) leaves the
  // viewport showing blank space below the content.
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [activeTab])

  // Debounce the feed search: the header input updates searchQuery per
  // keystroke, but only the settled value reaches Feed's query key — typing
  // 「お知らせ」 fires one request instead of one per character.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery), 300)
    return () => clearTimeout(t)
  }, [searchQuery])

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
        return <Feed searchQuery={debouncedSearch} onCompose={() => setComposerOpen(true)} onEventsMore={() => { setBookmarksInitialTab('events'); setActiveTab('bookmarks') }} />
      case 'notifications':
        return <Notifications />
      case 'profile':
        return <Profile />
      case 'admin':
        return <AdminPanel />
      case 'bookmarks':
        return <Bookmarks initialTab={bookmarksInitialTab} />
      default:
        return <Feed searchQuery={debouncedSearch} onCompose={() => setComposerOpen(true)} onEventsMore={() => { setBookmarksInitialTab('events'); setActiveTab('bookmarks') }} />
    }
  }

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

      {/* Header and Navigation live OUTSIDE <Routes> so they mount once for
          the whole session. Previously they were rendered inside each Route's
          element, so every navigation unmounted and remounted them — and a
          remounted `layoutId` element has no previous position to morph from,
          which is why the nav pill flew in from below instead of sliding. */}
      <div className="min-h-[100dvh]" style={{ position: 'relative', zIndex: 2 }}>
        <AppHeader
          user={user}
          searchQuery={searchQuery}
          onSearch={q => { setSearchQuery(q); setActiveTab('search') }}
          onSearchClear={() => { setSearchQuery(''); setActiveTab('feed') }}
          onAdmin={() => setActiveTab('admin')}
          onProfile={() => setActiveTab('profile')}
        />

        <main style={{ paddingBottom: 'calc(8rem + env(safe-area-inset-bottom, 0px))' }}>
          <Routes location={baseLocation}>
            <Route path="/posts/:id" element={<Suspense fallback={null}><PostDetail /></Suspense>} />
            {/* Standalone user profile — direct URL, no background state. In-app
                navigation uses the modal overlay in the {background} block below. */}
            <Route path="/users/:id" element={<UserProfilePanel standalone />} />
            {/* Keyed remount, no AnimatePresence: an exit animation on a full
                page either waits (dead gap) or overlaps (height jump). Letting
                the old page go and fading the new one up is faster and steadier
                — the list stagger inside carries the sense of motion. */}
            {Object.keys(PATH_TO_TAB).map(path => (
              <Route key={path} path={path} element={
                <motion.div key={activeTab} variants={pageFade} initial="hidden" animate="show">
                  {renderPage()}
                </motion.div>
              } />
            ))}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* iOS-style bottom blur — mobile only (hidden on sm+).
            Must live inside this wrapper, not as a sibling of it: the wrapper
            sets `position: relative; zIndex: 2`, which is a stacking context,
            so the nav's z-50 is only comparable to elements inside it. As a
            sibling the blur's z-40 beat the whole wrapper (40 > 2) and covered
            the nav pill. In here the two z-indices compare directly, so the
            blur still blurs the page content above it while staying behind
            the nav. */}
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

        <Navigation
          activeTab={activeTab}
          setActiveTab={tab => { if (tab === 'bookmarks') setBookmarksInitialTab('saved'); setActiveTab(tab); if (tab !== 'search') setSearchQuery('') }}
          unreadCount={unreadCount}
          onCompose={() => setComposerOpen(true)}
          canPost={user?.can_post ?? true}
        />

        {composerOpen && user?.can_post && (
          <Suspense fallback={null}>
            <PostComposer onClose={() => setComposerOpen(false)} />
          </Suspense>
        )}
      </div>

      {/* Modal overlays — only rendered when navigated from within the app */}
      {background && (
        <Routes>
          <Route path="/posts/:id"  element={<Suspense fallback={null}><PostDetail asModal /></Suspense>} />
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
      <div className="min-h-[100dvh] bg-brand-cream flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) return <Login />
  return <AppShell />
}
