import { useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate, useLocation } from 'react-router-dom'
import { Settings, X, Heart, MessageCircle, Pin, Camera, Trash2 } from 'lucide-react'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { postTypeColor, initials as initialsOf } from '../lib/postMeta'

// ── Vibe presets ──────────────────────────────────────────────────────────────

const VIBES = [
  { emoji: '🎧', label: '集中モード' },
  { emoji: '🚀', label: 'エネルギー全開' },
  { emoji: '🧠', label: 'アイデア出し中' },
  { emoji: '💪', label: '絶好調' },
  { emoji: '🎯', label: '目標に向かって' },
  { emoji: '🔥', label: 'ノリに乗ってる' },
  { emoji: '🤔', label: '考え中' },
  { emoji: '💡', label: 'クリエイティブ' },
  { emoji: '📝', label: '執筆中' },
  { emoji: '🤝', label: 'コラボ中' },
  { emoji: '☕', label: 'コーヒー休憩' },
  { emoji: '🌿', label: '落ち着いてます' },
  { emoji: '🎉', label: '最高の一日' },
  { emoji: '🏃', label: '全力疾走中' },
  { emoji: '🌟', label: 'インスピレーション' },
  { emoji: '📚', label: '勉強中' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface NotifPrefs {
  email_notifications: boolean
  in_app_notifications: boolean
  notif_new_post_email: boolean
  notif_new_post_chat: boolean
  notif_comment_email: boolean
  notif_comment_chat: boolean
  notif_like_email: boolean
  notif_like_chat: boolean
}

interface UpdateUserPayload extends NotifPrefs {
  full_name: string
}

interface UserStats {
  posts_count: number
  likes_received: number
  bookmarks_count: number
  comments_made: number
  likes_given: number
}

interface ProfilePost {
  id: string
  title: string
  post_type: string
  created_at: string
  likes_count: number
  comments_count: number
  is_pinned: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      className="w-12 h-6 rounded-full cursor-pointer flex items-center px-0.5 flex-shrink-0 transition-colors"
      style={{ background: on ? '#E8732A' : '#D8C9A8', justifyContent: on ? 'flex-end' : 'flex-start' }}
    >
      <div className="w-5 h-5 rounded-full shadow-sm" style={{ background: '#FFFDF7' }} />
    </div>
  )
}

// ── Vibe picker ───────────────────────────────────────────────────────────────

interface VibePickerProps {
  current: { emoji: string | null; label: string | null }
  onClose: () => void
  onSet: (emoji: string, label: string) => void
  onClear: () => void
}

function VibePicker({ current, onClose, onSet, onClear }: VibePickerProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(58,42,26,0.5)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
        className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="font-extrabold text-[15px] text-brand-dark">今日のバイブ</div>
            <div className="text-[11px] text-brand-muted mt-0.5">深夜0時にリセットされます</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: '#F0E8D8', color: '#A8906E' }}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-4 max-h-56 overflow-y-auto pr-0.5">
          {VIBES.map(({ emoji, label }) => {
            const isActive = current.emoji === emoji
            return (
              <motion.button
                key={emoji}
                onClick={() => onSet(emoji, label)}
                whileTap={{ scale: 0.88 }}
                className="flex flex-col items-center gap-1 p-2.5 rounded-2xl transition-all"
                style={{
                  background: isActive ? '#FDE8D0' : '#F4EDDA',
                  border: `1.5px solid ${isActive ? '#E8732A' : 'transparent'}`,
                }}
              >
                <span className="text-2xl leading-none">{emoji}</span>
                <span className="text-[9px] font-semibold text-brand-muted text-center leading-tight">{label}</span>
              </motion.button>
            )
          })}
        </div>

        {current.emoji && (
          <button
            onClick={onClear}
            className="w-full py-2.5 rounded-xl text-[13px] font-bold"
            style={{ background: '#F0E8D8', color: '#A8906E' }}
          >
            バイブをクリア
          </button>
        )}
      </motion.div>
    </motion.div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Profile() {
  const { user, logout, refreshUser } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

  const [showSettings, setShowSettings] = useState(false)
  const [showVibePicker, setShowVibePicker] = useState(false)
  const [name, setName] = useState<string>(user?.full_name ?? '')
  const [prefs, setPrefs] = useState<NotifPrefs>({
    email_notifications:  user?.email_notifications  ?? true,
    in_app_notifications: user?.in_app_notifications ?? true,
    notif_new_post_email: user?.notif_new_post_email ?? true,
    notif_new_post_chat:  user?.notif_new_post_chat  ?? true,
    notif_comment_email:  user?.notif_comment_email  ?? true,
    notif_comment_chat:   user?.notif_comment_chat   ?? true,
    notif_like_email:     user?.notif_like_email     ?? true,
    notif_like_chat:      user?.notif_like_chat      ?? true,
  })
  const [saved, setSaved] = useState(false)
  const [avatarHover, setAvatarHover] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  const [vibeEmoji, setVibeEmoji] = useState<string | null>(user?.vibe_emoji ?? null)
  const [vibeLabel, setVibeLabel] = useState<string | null>(user?.vibe_label ?? null)

  const initials = initialsOf(user?.full_name)
  const avatarUrl: string | null = user?.avatar_url ?? null
  const hasCustomAvatar = !!avatarUrl && !avatarUrl.startsWith('https://lh3.googleusercontent.com') && !avatarUrl.startsWith('https://lh')

  // Stats
  const { data: stats } = useQuery<UserStats>({
    queryKey: ['profile-stats'],
    queryFn: () => api.get('/users/me/stats'),
    staleTime: 2 * 60 * 1000,
  })

  // My posts
  const { data: postsData } = useQuery<{ posts: ProfilePost[] }>({
    queryKey: ['profile-posts'],
    queryFn: () => api.get('/users/me/posts?limit=24'),
    staleTime: 0,
  })
  const myPosts: ProfilePost[] = postsData?.posts ?? []

  // Mutations
  const update = useMutation<unknown, Error, UpdateUserPayload>({
    mutationFn: (data) => api.put('/users/me', data),
    onSuccess: () => {
      // AuthContext stores user in useState, not React Query — call refreshUser()
      // to re-fetch /auth/me so the header name updates immediately.
      refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const setVibe = useMutation<unknown, Error, { emoji: string; label: string }>({
    mutationFn: ({ emoji, label }) => api.put('/users/me/vibe', { emoji, label }),
    onMutate: ({ emoji, label }) => { setVibeEmoji(emoji); setVibeLabel(label) },
    onSettled: () => refreshUser(),
  })

  const clearVibe = useMutation<unknown, Error, void>({
    mutationFn: () => api.delete('/users/me/vibe'),
    onMutate: () => { setVibeEmoji(null); setVibeLabel(null) },
    onSettled: () => refreshUser(),
  })

  const uploadAvatar = useMutation<{ avatar_url: string }, Error, File>({
    mutationFn: (file) => {
      const fd = new FormData()
      fd.append('files', file)
      return api.put('/users/me/avatar', fd)
    },
    onSuccess: () => afterAvatarChange(),
  })

  const removeAvatar = useMutation<{ ok: boolean }, Error, void>({
    mutationFn: () => api.delete('/users/me/avatar'),
    onSuccess: () => afterAvatarChange(),
  })

  // Refresh every cache that carries author_avatar so the new photo shows
  // everywhere at once (feed cards, comments, hover card, story ring).
  const afterAvatarChange = () => {
    refreshUser()
    if (user?.id) queryClient.invalidateQueries({ queryKey: ['user-preview', user.id] })
    queryClient.invalidateQueries({ queryKey: ['posts'] })
    queryClient.invalidateQueries({ queryKey: ['comments'] })
    queryClient.invalidateQueries({ queryKey: ['post'] })
  }

  const logoutAll = useMutation<{ ok: boolean; sessionsRevoked: number }, Error, void>({
    mutationFn: () => api.post('/auth/logout-all'),
  })

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) return
    if (file.size > 4 * 1024 * 1024) { alert('4MB以下の画像を選択してください'); return }
    uploadAvatar.mutate(file)
    e.target.value = ''
  }

  return (
    <div className="max-w-[640px] mx-auto px-4 pb-10">

      {/* ── Sticky bar ── */}
      <div
        className="sticky z-40 py-3 mb-0 flex items-center justify-between"
        style={{ top: 56, background: 'rgba(244,237,218,0.96)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(200,175,130,0.30)' }}
      >
        <div className="flex items-center gap-2 font-extrabold text-[17px] text-brand-dark" style={{ letterSpacing: '-0.4px' }}>
          <div className="w-2 h-2 rounded-full" style={{ background: '#E8732A' }} />
          プロフィール
        </div>
        <motion.button
          whileTap={{ scale: 0.9 }}
          onClick={() => setShowSettings(s => !s)}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
          style={{ background: showSettings ? '#E8732A' : '#F0E8D8', color: showSettings ? '#FFFDF7' : '#7A5C30' }}
        >
          <Settings size={15} strokeWidth={2.3} />
        </motion.button>
      </div>

      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center text-center pt-7 pb-5"
      >
        {/* Avatar — interactive photo with upload overlay */}
        <input
          ref={avatarInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={handleAvatarFile}
        />
        <div className="relative mb-3">
          <div
            className="w-24 h-24 rounded-full p-[3px] cursor-pointer"
            style={{ background: 'linear-gradient(135deg, #E8732A, #F5A460)', boxShadow: '0 0 0 3px #F4EDDA' }}
            onMouseEnter={() => setAvatarHover(true)}
            onMouseLeave={() => setAvatarHover(false)}
            onClick={() => avatarInputRef.current?.click()}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={user?.full_name ?? ''}
                className="w-full h-full rounded-full object-cover border-2"
                style={{ borderColor: '#FFFDF7' }}
              />
            ) : (
              <div
                className="w-full h-full rounded-full flex items-center justify-center text-white font-extrabold text-2xl border-2"
                style={{ background: 'linear-gradient(135deg, #7A5C30, #C05A18)', borderColor: '#FFFDF7' }}
              >
                {initials}
              </div>
            )}
            {/* Camera overlay on hover */}
            <AnimatePresence>
              {(avatarHover || uploadAvatar.isPending) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="absolute inset-0 rounded-full flex flex-col items-center justify-center gap-0.5"
                  style={{ background: 'rgba(30,20,10,0.55)', backdropFilter: 'blur(2px)' }}
                >
                  {uploadAvatar.isPending ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Camera size={18} color="white" strokeWidth={2} />
                      <span style={{ fontSize: 8, color: 'white', fontWeight: 700 }}>変更</span>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Remove photo button — only for custom (non-Google) avatars */}
          {hasCustomAvatar && !removeAvatar.isPending && (
            <motion.button
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              type="button"
              title="写真を削除"
              onClick={e => { e.stopPropagation(); removeAvatar.mutate() }}
              className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full flex items-center justify-center shadow-md"
              style={{ background: '#3A2A1A', border: '2px solid #F4EDDA' }}
              whileTap={{ scale: 0.88 }}
            >
              <Trash2 size={11} color="#F0C898" strokeWidth={2.5} />
            </motion.button>
          )}
          {removeAvatar.isPending && (
            <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full flex items-center justify-center shadow-md" style={{ background: '#3A2A1A', border: '2px solid #F4EDDA' }}>
              <div className="w-3 h-3 border-2 border-amber-200 border-t-transparent rounded-full animate-spin" />
            </div>
          )}
        </div>
        {/* Photo hint */}
        <div className="text-[10px] text-brand-muted mb-1" style={{ marginTop: -6 }}>
          {uploadAvatar.isError ? (
            <span style={{ color: '#A83030' }}>アップロードに失敗しました</span>
          ) : avatarUrl ? (
            <span>クリックして写真を変更</span>
          ) : (
            <span>クリックして写真を追加</span>
          )}
        </div>

        {/* Name */}
        <div className="font-extrabold text-[20px] text-brand-dark mb-1" style={{ letterSpacing: '-0.5px' }}>
          {user?.full_name}
        </div>

        {/* Dept badge */}
        <span
          className="inline-block text-[11px] font-bold px-3 py-1 rounded-full mb-3"
          style={{ background: '#FDE8D0', color: '#C05A18' }}
        >
          {user?.department_name}
        </span>

        {/* Vibe pill */}
        <motion.button
          whileTap={{ scale: 0.93 }}
          onClick={() => setShowVibePicker(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[12.5px] font-bold"
          style={{
            background: vibeEmoji ? '#FDE8D0' : '#F0E8D8',
            color: vibeEmoji ? '#C05A18' : '#A8906E',
            border: `1.5px solid ${vibeEmoji ? '#E8732A' : '#E4D4B8'}`,
          }}
        >
          {vibeEmoji ? (
            <><span>{vibeEmoji}</span><span>{vibeLabel}</span></>
          ) : (
            <span>＋ バイブを設定</span>
          )}
        </motion.button>

        {/* Stats row — posters see posts/likes-received/bookmarks; non-posters see comments/likes-given/bookmarks */}
        {(() => {
          const statItems: { value: number | string; label: string }[] = user?.can_post
            ? [
                { value: stats?.posts_count ?? '—', label: '今月の投稿' },
                { value: stats?.likes_received ?? '—', label: '今月のいいね' },
                { value: stats?.bookmarks_count ?? '—', label: '保存済み' },
              ]
            : [
                { value: stats?.comments_made ?? '—', label: '今月のコメント' },
                { value: stats?.likes_given ?? '—', label: '今月のいいね' },
                { value: stats?.bookmarks_count ?? '—', label: '保存済み' },
              ]
          return (
            <div className="flex w-full max-w-xs mt-5 rounded-2xl overflow-hidden" style={{ border: '1px solid #E4D4B8' }}>
              {statItems.map(({ value, label }, i) => (
                <div
                  key={label}
                  className="flex-1 flex flex-col items-center py-3"
                  style={{ background: '#FFFDF7', borderRight: i < 2 ? '1px solid #E4D4B8' : undefined }}
                >
                  <div className="font-extrabold text-[20px] text-brand-dark" style={{ letterSpacing: '-0.5px' }}>{value}</div>
                  <div className="text-[10.5px] text-brand-muted font-semibold">{label}</div>
                </div>
              ))}
            </div>
          )
        })()}
      </motion.div>

      {/* ── Settings panel (collapsible) ── */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden mb-6"
          >
            <div className="flex flex-col gap-3 pt-1">
              {/* Name input */}
              <div className="p-4 rounded-2xl" style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}>
                <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">表示名</label>
                <input
                  value={name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none"
                  style={{ background: '#FAF5EC', border: '1.5px solid #E4D4B8' }}
                  onFocus={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#E8732A'}
                  onBlur={(e: React.FocusEvent<HTMLInputElement>) => e.target.style.borderColor = '#E4D4B8'}
                />
              </div>

              {/* Notifications */}
              <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid #E4D4B8' }}>
                {/* Master toggles */}
                <div className="px-4 pt-4 pb-3" style={{ background: '#FFFDF7', borderBottom: '1px solid #F0E8D8' }}>
                  <div className="font-extrabold text-brand-dark text-[13px] mb-3">通知設定</div>
                  {([
                    { key: 'email_notifications' as const,  label: 'メール通知',    sub: 'メールで通知を受信' },
                    { key: 'in_app_notifications' as const, label: 'アプリ内通知',  sub: 'リアルタイムトースト' },
                  ]).map(({ key, label, sub }, i) => (
                    <div
                      key={key}
                      className="flex items-center justify-between py-2.5"
                      style={{ borderBottom: i === 0 ? '1px solid #F0E8D8' : undefined }}
                    >
                      <div>
                        <div className="text-[12.5px] font-semibold text-brand-dark">{label}</div>
                        <div className="text-[10.5px] text-brand-muted">{sub}</div>
                      </div>
                      <Toggle on={prefs[key]} onToggle={() => setPrefs(p => ({ ...p, [key]: !p[key] }))} />
                    </div>
                  ))}
                </div>

                {/* Per-type matrix — メール・Chat columns */}
                <div className="px-4 pt-3 pb-4" style={{ background: '#FAF5EC' }}>
                  <div className="text-[10px] font-bold text-brand-muted uppercase tracking-wide mb-2.5">通知の種類ごとの設定</div>

                  {/* Column headers */}
                  <div className="grid grid-cols-[1fr_48px_48px] gap-x-2 mb-1 px-0.5">
                    <div />
                    <div className="text-center text-[9.5px] font-bold text-brand-muted uppercase tracking-wide">メール</div>
                    <div className="text-center text-[9.5px] font-bold text-brand-muted uppercase tracking-wide">Chat</div>
                  </div>

                  {([
                    { label: '📋 新着投稿',   emailKey: 'notif_new_post_email' as const, chatKey: 'notif_new_post_chat' as const },
                    { label: '💬 コメント',   emailKey: 'notif_comment_email'  as const, chatKey: 'notif_comment_chat'  as const },
                    { label: '❤️ いいね',     emailKey: 'notif_like_email'     as const, chatKey: 'notif_like_chat'     as const },
                  ]).map(({ label, emailKey, chatKey }, i) => (
                    <div
                      key={emailKey}
                      className="grid grid-cols-[1fr_48px_48px] gap-x-2 items-center py-2"
                      style={{ borderTop: i > 0 ? '1px solid #EDE4D0' : undefined }}
                    >
                      <div className="text-[12px] font-semibold text-brand-dark">{label}</div>
                      {/* Email checkbox */}
                      <div className="flex justify-center">
                        <button
                          onClick={() => setPrefs(p => ({ ...p, [emailKey]: !p[emailKey] }))}
                          disabled={!prefs.email_notifications}
                          className="w-5 h-5 rounded-md flex items-center justify-center transition-all disabled:opacity-30"
                          style={{
                            background: prefs[emailKey] && prefs.email_notifications ? '#E8732A' : '#F0E8D8',
                            border: `1.5px solid ${prefs[emailKey] && prefs.email_notifications ? '#E8732A' : '#D8C9A8'}`,
                          }}
                        >
                          {prefs[emailKey] && prefs.email_notifications && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      </div>
                      {/* Chat checkbox */}
                      <div className="flex justify-center">
                        <button
                          onClick={() => setPrefs(p => ({ ...p, [chatKey]: !p[chatKey] }))}
                          className="w-5 h-5 rounded-md flex items-center justify-center transition-all"
                          style={{
                            background: prefs[chatKey] ? '#1E5FA8' : '#F0E8D8',
                            border: `1.5px solid ${prefs[chatKey] ? '#1E5FA8' : '#D8C9A8'}`,
                          }}
                        >
                          {prefs[chatKey] && (
                            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                              <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Save */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => update.mutate({ full_name: name, ...prefs })}
                disabled={update.isPending}
                className="w-full py-3 rounded-2xl font-extrabold text-white text-[14px] disabled:opacity-50"
                style={{ background: '#3A2A1A' }}
              >
                {saved ? '✓ 保存しました！' : update.isPending ? '保存中…' : '変更を保存'}
              </motion.button>

              {/* Log out other devices — current session survives */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => logoutAll.mutate()}
                disabled={logoutAll.isPending}
                className="w-full py-3 rounded-2xl font-semibold text-[13px] disabled:opacity-50"
                style={{ color: '#A8906E', border: '1px solid #E4D4B8', background: '#FFFDF7' }}
              >
                {logoutAll.isSuccess
                  ? `✓ 他のセッションをログアウトしました`
                  : logoutAll.isPending ? '処理中…' : '他のデバイスからログアウト'}
              </motion.button>

              {/* Sign out */}
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={logout}
                className="w-full py-3 rounded-2xl font-semibold text-[13px]"
                style={{ color: '#A8906E', border: '1px solid #E4D4B8', background: '#FFFDF7' }}
              >
                サインアウト
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Posts grid ── */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#E8732A' }} />
          <span className="font-extrabold text-[14px] text-brand-dark">投稿</span>
          {myPosts.length > 0 && (
            <span className="text-brand-muted font-semibold text-[12px]">({myPosts.length})</span>
          )}
        </div>

        {myPosts.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-16 rounded-2xl"
            style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
          >
            <div className="text-5xl mb-3">✍️</div>
            <div className="font-extrabold text-brand-dark text-[14px] mb-1">まだ投稿がありません</div>
            <div className="text-[12px] text-brand-muted">最初の投稿を作成しましょう</div>
          </motion.div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {myPosts.map((post, i) => (
              <motion.div
                key={post.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(i * 0.04, 0.3), duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                onClick={() => {
                  const existingBg = (location.state as { background?: unknown } | null)?.background
                  navigate(`/posts/${post.id}`, { state: { background: existingBg ?? location } })
                }}
                className="cursor-pointer rounded-2xl p-3.5 flex flex-col gap-2"
                style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
                whileHover={{ y: -2, boxShadow: '0 4px 16px rgba(58,42,26,0.10)' }}
              >
                {/* Type indicator + pin */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: postTypeColor(post.post_type) }}
                    />
                    <span className="text-[9.5px] font-bold uppercase tracking-wide" style={{ color: postTypeColor(post.post_type) }}>
                      {post.post_type}
                    </span>
                  </div>
                  {post.is_pinned && <Pin size={10} color="#E8732A" strokeWidth={2.5} />}
                </div>

                {/* Title */}
                <div
                  className="font-extrabold text-[12.5px] text-brand-dark leading-snug"
                  style={{
                    letterSpacing: '-0.2px',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {post.title}
                </div>

                {/* Date */}
                <div className="text-[10px] text-brand-muted">
                  {new Date(post.created_at).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}
                </div>

                {/* Engagement */}
                <div className="flex items-center gap-2.5 mt-auto">
                  <span className="flex items-center gap-0.5 text-[10.5px] text-brand-muted">
                    <Heart size={10} strokeWidth={2} />
                    {post.likes_count}
                  </span>
                  <span className="flex items-center gap-0.5 text-[10.5px] text-brand-muted">
                    <MessageCircle size={10} strokeWidth={2} />
                    {post.comments_count}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* ── Vibe picker modal ── */}
      <AnimatePresence>
        {showVibePicker && (
          <VibePicker
            current={{ emoji: vibeEmoji, label: vibeLabel }}
            onClose={() => setShowVibePicker(false)}
            onSet={(emoji, label) => { setVibe.mutate({ emoji, label }); setShowVibePicker(false) }}
            onClear={() => { clearVibe.mutate(); setShowVibePicker(false) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
