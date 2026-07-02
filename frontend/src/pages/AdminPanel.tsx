import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Shield, ChevronDown, X, Plus, Check, FileText, PenSquare, Trash2, Pin, User as UserIcon, RefreshCw, Heart, MessageCircle, Bookmark, Smile, Edit3, ExternalLink, UserPlus, Webhook, Upload, CheckCircle2, AlertCircle } from 'lucide-react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { initials as initialsOf } from '../lib/postMeta'
import type { User, Department } from '../types'

const PILL_SPRING = { type: 'spring', stiffness: 480, damping: 30, mass: 0.7 } as const

// ── types ────────────────────────────────────────────────────────────────────

interface AdminUser extends User {
  created_at: string
  can_post: boolean
  chat_webhook_url?: string | null
}

interface EditState {
  department_id: string
  role: 'member' | 'admin'
  full_name: string
  can_post: boolean
  chat_webhook_url: string
}

// ── helpers ──────────────────────────────────────────────────────────────────

const ROLE_COLORS = {
  admin:  { bg: '#FDE8D0', color: '#C05A18', label: '管理者' },
  member: { bg: '#F0E8D8', color: '#7A5C30', label: 'メンバー' },
}

const DEPT_AVATAR = ['#7A5C30','#C05A18','#1E5FA8','#1A7A48','#6B35A8','#C07090']

function Avatar({ name, idx = 0 }: { name: string; idx?: number }) {
  const ini = initialsOf(name)
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-white font-extrabold text-[11px] flex-shrink-0"
      style={{ background: DEPT_AVATAR[idx % DEPT_AVATAR.length] }}
    >
      {ini}
    </div>
  )
}

// ── edit drawer ───────────────────────────────────────────────────────────────

interface EditDrawerProps {
  user: AdminUser
  departments: Department[]
  onClose: () => void
}

function EditDrawer({ user, departments, onClose }: EditDrawerProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [form, setForm] = useState<EditState>({
    department_id:    user.department_id,
    role:             user.role,
    full_name:        user.full_name,
    can_post:         user.can_post,
    chat_webhook_url: user.chat_webhook_url ?? '',
  })

  const save = useMutation<unknown, Error, EditState>({
    mutationFn: (body) => api.put(`/admin/users/${user.id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('ユーザー情報を更新しました')
      onClose()
    },
    onError: () => {
      toast.error('更新に失敗しました')
    },
  })

  const changed =
    form.department_id    !== user.department_id ||
    form.role             !== user.role ||
    form.full_name        !== user.full_name ||
    form.can_post         !== user.can_post ||
    form.chat_webhook_url !== (user.chat_webhook_url ?? '')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(58,42,26,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', maxHeight: 'calc(100dvh - 80px)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #E4D4B8' }}>
          <div>
            <div className="font-extrabold text-[15px] text-brand-dark">ユーザー編集</div>
            <div className="text-[11px] text-brand-muted">{user.email}</div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: '#F0E8D8', color: '#A8906E' }}
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        <div className="px-5 py-5 pb-10 flex flex-col gap-4 overflow-y-auto flex-1">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">表示名</label>
            <input
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              className="w-full px-3.5 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none"
              style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
              onFocus={e => e.target.style.borderColor = '#E8732A'}
              onBlur={e => e.target.style.borderColor = '#E4D4B8'}
            />
          </div>

          {/* Department */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">部署</label>
            <div className="relative">
              <select
                value={form.department_id}
                onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
                className="w-full appearance-none px-3.5 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none pr-9"
                style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
              >
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" color="#A8906E" />
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">権限</label>
            <div className="flex gap-2">
              {(['member', 'admin'] as const).map(r => {
                const { bg, color, label } = ROLE_COLORS[r]
                const active = form.role === r
                return (
                  <motion.button
                    key={r}
                    onClick={() => setForm(f => ({ ...f, role: r }))}
                    whileTap={{ scale: 0.94 }}
                    transition={PILL_SPRING}
                    className="relative flex-1 py-2.5 rounded-xl text-[13px] font-bold"
                    style={{
                      color:  active ? color : '#A8906E',
                      border: `1.5px solid ${active ? color : '#E4D4B8'}`,
                    }}
                  >
                    {active && (
                      <motion.span
                        layoutId="role-pill"
                        className="absolute inset-0 rounded-xl"
                        style={{ background: bg }}
                        transition={PILL_SPRING}
                      />
                    )}
                    <span className="relative z-10">{label}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>

          {/* Post permission toggle */}
          <div
            className="flex items-center justify-between p-3.5 rounded-xl"
            style={{ background: form.can_post ? '#D6F0E4' : '#FDE8D0', border: `1.5px solid ${form.can_post ? '#1A7A48' : '#C05A18'}` }}
          >
            <div>
              <div className="text-[13px] font-bold" style={{ color: form.can_post ? '#1A7A48' : '#C05A18' }}>
                {form.can_post ? '✅ 投稿許可あり' : '🚫 投稿を制限中'}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: form.can_post ? '#1A7A48' : '#C05A18', opacity: 0.8 }}>
                {form.can_post ? 'このユーザーは投稿できます' : '投稿ボタンが非表示になります'}
              </div>
            </div>
            <button
              onClick={() => setForm(f => ({ ...f, can_post: !f.can_post }))}
              className="w-12 h-6 rounded-full cursor-pointer transition-colors flex items-center px-0.5 flex-shrink-0"
              style={{
                background: form.can_post ? '#1A7A48' : '#C05A18',
                justifyContent: form.can_post ? 'flex-end' : 'flex-start',
              }}
            >
              <div className="w-5 h-5 rounded-full shadow-sm" style={{ background: '#FFFDF7' }} />
            </button>
          </div>

          {/* Google Chat Webhook */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">Google Chat Webhook URL</label>
            <input
              value={form.chat_webhook_url}
              onChange={e => setForm(f => ({ ...f, chat_webhook_url: e.target.value }))}
              placeholder="https://chat.googleapis.com/v1/spaces/..."
              className="w-full px-3.5 py-2.5 rounded-xl text-[12px] text-brand-dark outline-none font-mono"
              style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
              onFocus={e => e.target.style.borderColor = '#1E5FA8'}
              onBlur={e => e.target.style.borderColor = '#E4D4B8'}
            />
            {form.chat_webhook_url && !form.chat_webhook_url.startsWith('https://chat.googleapis.com') && (
              <div className="text-[10.5px] mt-1" style={{ color: '#C05A18' }}>
                URLは https://chat.googleapis.com で始まる必要があります
              </div>
            )}
            {form.chat_webhook_url === '' && (user.chat_webhook_url ?? '') !== '' && (
              <div className="text-[10.5px] mt-1" style={{ color: '#C05A18' }}>
                空にすると Webhook が削除されます
              </div>
            )}
          </div>

          {/* Save */}
          <button
            onClick={() => save.mutate(form)}
            disabled={!changed || save.isPending}
            className="w-full py-3 rounded-xl font-extrabold text-[14px] text-white transition-opacity disabled:opacity-40"
            style={{ background: '#E8732A' }}
          >
            {save.isPending ? '保存中…' : '保存する'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── add department modal ──────────────────────────────────────────────────────

function AddDeptModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState('')

  const add = useMutation<unknown, Error, string>({
    mutationFn: (n) => api.post('/admin/departments', { name: n }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments'] })
      toast.success('部署を追加しました')
      onClose()
    },
    onError: () => {
      toast.error('部署の追加に失敗しました')
    },
  })

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(58,42,26,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.18 }}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
      >
        <div className="font-extrabold text-[15px] text-brand-dark">部署を追加</div>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) add.mutate(name.trim()) }}
          placeholder="部署名"
          className="px-3.5 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none"
          style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold text-brand-muted" style={{ background: '#F0E8D8' }}>
            キャンセル
          </button>
          <button
            onClick={() => { if (name.trim()) add.mutate(name.trim()) }}
            disabled={!name.trim() || add.isPending}
            className="flex-1 py-2.5 rounded-xl text-[13px] font-extrabold text-white disabled:opacity-40"
            style={{ background: '#E8732A' }}
          >
            追加
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── add user modal ────────────────────────────────────────────────────────────

interface AddUserForm {
  email: string
  full_name: string
  department_id: string
  role: 'member' | 'admin'
  can_post: boolean
}

function AddUserModal({ departments, onClose }: { departments: Department[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const [form, setForm] = useState<AddUserForm>({
    email: '',
    full_name: '',
    department_id: departments[0]?.id ?? '',
    role: 'member',
    can_post: true,
  })

  const add = useMutation<unknown, Error, AddUserForm>({
    mutationFn: (body) => api.post('/admin/users', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('ユーザーを追加しました')
      onClose()
    },
    onError: (err) => {
      toast.error(err.message ?? 'ユーザーの追加に失敗しました')
    },
  })

  const valid = form.email.trim().includes('@') && form.full_name.trim().length > 0 && !!form.department_id

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center pb-24 px-0 sm:p-4"
      style={{ background: 'rgba(58,42,26,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl flex flex-col"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', maxHeight: 'calc(100dvh - 120px)' }}
      >
        {/* Header — never scrolls */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #E4D4B8' }}>
          <div>
            <div className="font-extrabold text-[15px] text-brand-dark">ユーザーを追加</div>
            <div className="text-[11px] text-brand-muted">次回ログイン時に設定が適用されます</div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: '#F0E8D8', color: '#A8906E' }}>
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-8 flex flex-col gap-4">
          {/* Email */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">メールアドレス</label>
            <input
              autoFocus
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="user@jmc-ltd.co.jp"
              className="w-full px-3.5 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none"
              style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
              onFocus={e => e.target.style.borderColor = '#E8732A'}
              onBlur={e => e.target.style.borderColor = '#E4D4B8'}
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">表示名</label>
            <input
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="山田 太郎"
              className="w-full px-3.5 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none"
              style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
              onFocus={e => e.target.style.borderColor = '#E8732A'}
              onBlur={e => e.target.style.borderColor = '#E4D4B8'}
            />
          </div>

          {/* Department */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">部署</label>
            <div className="relative">
              <select
                value={form.department_id}
                onChange={e => setForm(f => ({ ...f, department_id: e.target.value }))}
                className="w-full appearance-none px-3.5 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none pr-9"
                style={{ background: '#F4EDDA', border: '1.5px solid #E4D4B8' }}
              >
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" color="#A8906E" />
            </div>
          </div>

          {/* Role */}
          <div>
            <label className="block text-[11px] font-bold text-brand-muted mb-1.5 uppercase tracking-wide">権限</label>
            <div className="flex gap-2">
              {(['member', 'admin'] as const).map(r => {
                const { bg, color, label } = ROLE_COLORS[r]
                const active = form.role === r
                return (
                  <motion.button
                    key={r}
                    onClick={() => setForm(f => ({ ...f, role: r }))}
                    whileTap={{ scale: 0.94 }}
                    transition={PILL_SPRING}
                    className="relative flex-1 py-2.5 rounded-xl text-[13px] font-bold"
                    style={{ color: active ? color : '#A8906E', border: `1.5px solid ${active ? color : '#E4D4B8'}` }}
                  >
                    {active && (
                      <motion.span layoutId="add-role-pill" className="absolute inset-0 rounded-xl" style={{ background: bg }} transition={PILL_SPRING} />
                    )}
                    <span className="relative z-10">{label}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>

          {/* Post permission */}
          <div
            className="flex items-center justify-between p-3.5 rounded-xl"
            style={{ background: form.can_post ? '#D6F0E4' : '#FDE8D0', border: `1.5px solid ${form.can_post ? '#1A7A48' : '#C05A18'}` }}
          >
            <div>
              <div className="text-[13px] font-bold" style={{ color: form.can_post ? '#1A7A48' : '#C05A18' }}>
                {form.can_post ? '✅ 投稿許可あり' : '🚫 投稿を制限中'}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: form.can_post ? '#1A7A48' : '#C05A18', opacity: 0.8 }}>
                {form.can_post ? 'このユーザーは投稿できます' : '投稿ボタンが非表示になります'}
              </div>
            </div>
            <button
              onClick={() => setForm(f => ({ ...f, can_post: !f.can_post }))}
              className="w-12 h-6 rounded-full cursor-pointer transition-colors flex items-center px-0.5 flex-shrink-0"
              style={{ background: form.can_post ? '#1A7A48' : '#C05A18', justifyContent: form.can_post ? 'flex-end' : 'flex-start' }}
            >
              <div className="w-5 h-5 rounded-full shadow-sm" style={{ background: '#FFFDF7' }} />
            </button>
          </div>

          <button
            onClick={() => { if (valid) add.mutate(form) }}
            disabled={!valid || add.isPending}
            className="w-full py-3 rounded-xl font-extrabold text-[14px] text-white transition-opacity disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: '#E8732A' }}
          >
            <UserPlus size={15} strokeWidth={2.5} />
            {add.isPending ? '追加中…' : 'ユーザーを追加'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── main ─────────────────────────────────────────────────────────────────────

export default function AdminPanel() {
  const { user: me } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null)
  const [addDeptOpen, setAddDeptOpen] = useState(false)
  const [addUserOpen, setAddUserOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<'users' | 'departments' | 'logs' | 'webhooks'>('users')

  const openProfile = (userId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const existingBg = (location.state as { background?: unknown } | null)?.background
    navigate(`/users/${userId}`, { state: { background: existingBg ?? location } })
  }

  const { data: usersData, isLoading: usersLoading } = useQuery<{ users: AdminUser[] }>({
    queryKey: ['admin-users'],
    queryFn: () => api.get('/admin/users'),
    staleTime: 30_000,
  })

  const { data: deptsData } = useQuery<{ departments: Department[] }>({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments'),
    staleTime: Infinity,
  })

  const users = usersData?.users ?? []
  const departments = deptsData?.departments ?? []

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  )

  if (me?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Shield size={40} color="#E8732A" />
        <div className="font-extrabold text-brand-dark text-lg">管理者のみアクセス可能です</div>
      </div>
    )
  }

  return (
    <div className="max-w-[960px] mx-auto px-4 pt-0">
      {/* Sticky header */}
      <div
        className="sticky z-40 flex items-center justify-between py-3 mb-5"
        style={{ top: 56, background: 'rgba(244,237,218,0.96)', backdropFilter: 'blur(16px)', borderBottom: '1px solid rgba(200,175,130,0.3)' }}
      >
        <div className="flex items-center gap-2 font-extrabold text-[17px] text-brand-dark" style={{ letterSpacing: '-0.4px' }}>
          <Shield size={18} color="#E8732A" strokeWidth={2.5} />
          管理パネル
        </div>
        <div className="flex gap-1 p-0.5 rounded-full" style={{ background: 'rgba(58,42,26,0.08)' }}>
          {([
            { id: 'users',       label: `ユーザー (${users.length})` },
            { id: 'departments', label: '部署' },
            { id: 'logs',        label: 'ログ' },
            { id: 'webhooks',    label: 'Chat通知' },
          ] as const).map(({ id, label }) => {
            const isActive = activeTab === id
            return (
              <motion.button
                key={id}
                onClick={() => setActiveTab(id)}
                whileTap={{ scale: 0.93 }}
                transition={PILL_SPRING}
                className="relative px-3.5 py-1.5 rounded-full text-[12px] font-bold"
                style={{ color: isActive ? '#E8732A' : '#8A7A68' }}
              >
                {isActive && (
                  <motion.span
                    layoutId="admin-tab-pill"
                    className="absolute inset-0 rounded-full"
                    style={{ background: '#FFFDF7', boxShadow: '0 1px 4px rgba(60,30,10,0.08)' }}
                    transition={PILL_SPRING}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </motion.button>
            )
          })}
        </div>
      </div>

      {activeTab === 'users' && (
        <div className="max-w-[640px]">
          {/* Search + add button */}
          <div className="flex gap-2 mb-4">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="名前またはメールで検索…"
              className="flex-1 px-4 py-2.5 rounded-xl text-[13px] text-brand-dark outline-none"
              style={{ background: '#FFFDF7', border: '1.5px solid #E4D4B8' }}
              onFocus={e => e.target.style.borderColor = '#E8732A'}
              onBlur={e => e.target.style.borderColor = '#E4D4B8'}
            />
            <button
              onClick={() => setAddUserOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl font-bold text-[13px] text-white flex-shrink-0"
              style={{ background: '#E8732A' }}
            >
              <UserPlus size={14} strokeWidth={2.5} />
              追加
            </button>
          </div>

          {usersLoading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filtered.map((u, i) => {
                const { bg, color, label } = ROLE_COLORS[u.role]
                return (
                  <motion.div
                    key={u.id}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.02, 0.2) }}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-2xl transition-all"
                    style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
                    onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 3px 14px rgba(100,60,10,0.08)')}
                    onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                  >
                    {/* Avatar — click opens profile panel */}
                    <button
                      onClick={e => openProfile(u.id, e)}
                      className="flex-shrink-0 rounded-full transition-opacity hover:opacity-70"
                      title="プロフィールを見る"
                    >
                      <Avatar name={u.full_name} idx={i} />
                    </button>

                    {/* Name/email — click opens profile panel */}
                    <button
                      onClick={e => openProfile(u.id, e)}
                      className="flex-1 min-w-0 text-left transition-opacity hover:opacity-70"
                    >
                      <div className="font-bold text-[13px] text-brand-dark flex items-center gap-1.5">
                        {u.full_name}
                        {u.id === me?.id && (
                          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded-full" style={{ background: '#D6F0E4', color: '#1A7A48' }}>YOU</span>
                        )}
                        <ExternalLink size={10} color="#A8906E" strokeWidth={2.5} />
                      </div>
                      <div className="text-[11px] text-brand-muted truncate">{u.email}</div>
                    </button>

                    {/* Badges + edit icon */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-[10.5px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: '#F0E8D8', color: '#7A5C30' }}>
                        {u.department_name}
                      </span>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: bg, color }}>
                        {label}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); setEditingUser(u) }}
                        className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 transition-opacity hover:opacity-80"
                        style={{ background: '#F0E8D8', color: '#7A5C30' }}
                        title="ユーザーを編集"
                      >
                        <Edit3 size={12} strokeWidth={2.5} />
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="max-w-[480px]">
          <button
            onClick={() => setAddDeptOpen(true)}
            className="flex items-center gap-2 mb-4 px-4 py-2.5 rounded-xl font-bold text-[13px] text-white transition-opacity"
            style={{ background: '#E8732A' }}
          >
            <Plus size={15} strokeWidth={2.5} />
            部署を追加
          </button>

          <div className="flex flex-col gap-2">
            {departments.map((d, i) => (
              <div
                key={d.id}
                className="flex items-center gap-3 px-4 py-3.5 rounded-2xl"
                style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
              >
                <div
                  className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-extrabold text-[11px]"
                  style={{ background: DEPT_AVATAR[i % DEPT_AVATAR.length] }}
                >
                  {d.name[0]}
                </div>
                <div className="flex-1 font-semibold text-[13px] text-brand-dark">{d.name}</div>
                <Check size={14} color="#1A7A48" strokeWidth={2.5} />
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'logs' && <AuditLogTab />}
      {activeTab === 'webhooks' && <WebhooksTab />}

      <AnimatePresence>
        {editingUser && (
          <EditDrawer
            user={editingUser}
            departments={departments}
            onClose={() => setEditingUser(null)}
          />
        )}
        {addDeptOpen && <AddDeptModal onClose={() => setAddDeptOpen(false)} />}
        {addUserOpen && <AddUserModal departments={departments} onClose={() => setAddUserOpen(false)} />}
      </AnimatePresence>
    </div>
  )
}

// ── Webhooks tab ──────────────────────────────────────────────────────────────

interface WebhookUser {
  id: string
  full_name: string
  email: string
  has_webhook: boolean
}

function WebhooksTab() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [uploading, setUploading] = useState(false)
  const [lastResult, setLastResult] = useState<{ updated: number; skipped: number } | null>(null)

  const { data, isLoading, refetch } = useQuery<{ users: WebhookUser[] }>({
    queryKey: ['admin-webhooks'],
    queryFn: () => api.get('/admin/webhooks'),
    staleTime: 30_000,
  })

  const users = data?.users ?? []
  const withWebhook    = users.filter(u => u.has_webhook).length
  const withoutWebhook = users.length - withWebhook

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setUploading(true)
    setLastResult(null)
    try {
      const buf = await file.arrayBuffer()
      const res = await fetch('/api/admin/webhooks/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf,
        credentials: 'include',
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json() as { updated: number; skipped: number }
      setLastResult(json)
      toast.success(`${json.updated}件のWebhookを更新しました`)
      queryClient.invalidateQueries({ queryKey: ['admin-webhooks'] })
      refetch()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="max-w-[640px]">
      {/* Upload card */}
      <div
        className="rounded-2xl p-5 mb-5 flex flex-col gap-4"
        style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: '#FDE8D0' }}>
            <Webhook size={18} color="#E8732A" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-extrabold text-[14px] text-brand-dark">Google Chat Webhook 一括設定</div>
            <div className="text-[12px] text-brand-muted mt-0.5">
              Excelファイルの「アドレス」「Google Chat WebHook」列でユーザーと対応付けます
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl" style={{ background: '#D6F0E4', border: '1px solid #B8E8CC' }}>
            <CheckCircle2 size={14} color="#1A7A48" strokeWidth={2.5} />
            <div>
              <div className="font-extrabold text-[13px]" style={{ color: '#1A7A48' }}>{withWebhook}</div>
              <div className="text-[10px]" style={{ color: '#1A7A48', opacity: 0.8 }}>設定済み</div>
            </div>
          </div>
          <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-xl" style={{ background: '#F0E8D8', border: '1px solid #E4D4B8' }}>
            <AlertCircle size={14} color="#A8906E" strokeWidth={2.5} />
            <div>
              <div className="font-extrabold text-[13px]" style={{ color: '#A8906E' }}>{withoutWebhook}</div>
              <div className="text-[10px]" style={{ color: '#A8906E', opacity: 0.8 }}>未設定</div>
            </div>
          </div>
        </div>

        {/* Upload result */}
        {lastResult && (
          <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-[12px] font-semibold" style={{ background: '#D6F0E4', color: '#1A7A48' }}>
            <CheckCircle2 size={13} strokeWidth={2.5} />
            {lastResult.updated}件を更新 · {lastResult.skipped}件をスキップ
          </div>
        )}

        {/* Upload button */}
        <label
          className="flex items-center justify-center gap-2 py-3 rounded-xl font-extrabold text-[14px] text-white cursor-pointer transition-opacity"
          style={{ background: uploading ? '#C8602A' : '#E8732A', opacity: uploading ? 0.7 : 1 }}
        >
          <Upload size={15} strokeWidth={2.5} />
          {uploading ? 'アップロード中…' : 'Excelファイルをアップロード'}
          <input
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileUpload}
            disabled={uploading}
            className="hidden"
          />
        </label>

        <div className="text-[11px] text-brand-muted">
          対応列：<code className="px-1 py-0.5 rounded" style={{ background: '#F0E8D8' }}>アドレス</code>（メール）、
          <code className="px-1 py-0.5 rounded ml-1" style={{ background: '#F0E8D8' }}>Google Chat WebHook</code>（https://... で始まるURL）
        </div>
      </div>

      {/* User list */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="w-7 h-7 border-2 border-brand-orange border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {users.map((u, i) => (
            <div
              key={u.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white font-extrabold text-[10px] flex-shrink-0"
                style={{ background: DEPT_AVATAR[i % DEPT_AVATAR.length] }}
              >
                {u.full_name.slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[12.5px] text-brand-dark truncate">{u.full_name}</div>
                <div className="text-[11px] text-brand-muted truncate">{u.email}</div>
              </div>
              {u.has_webhook ? (
                <span className="flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-full" style={{ background: '#D6F0E4', color: '#1A7A48' }}>
                  <CheckCircle2 size={10} strokeWidth={2.5} /> 設定済み
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full" style={{ background: '#F0E8D8', color: '#A8906E' }}>
                  <AlertCircle size={10} strokeWidth={2.5} /> 未設定
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Audit log ─────────────────────────────────────────────────────────────────

interface AuditEntry {
  id: string
  action: string
  actor_id: string
  actor_name: string
  actor_email: string
  target_id: string | null
  target_post_title: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

const ACTION_META: Record<string, { label: string; bg: string; color: string; Icon: typeof FileText }> = {
  POST_CREATE:    { label: '投稿作成',    bg: '#D6F0E4', color: '#1A7A48', Icon: PenSquare },
  POST_UPDATE:    { label: '投稿編集',    bg: '#D8EAF8', color: '#1E5FA8', Icon: Edit3 },
  POST_DELETE:    { label: '投稿削除',    bg: '#FDE8D0', color: '#C05A18', Icon: Trash2 },
  POST_PIN:       { label: 'ピン留め',    bg: '#D8EAF8', color: '#1E5FA8', Icon: Pin },
  POST_UNPIN:     { label: 'ピン解除',    bg: '#F0E8F8', color: '#6B35A8', Icon: Pin },
  POST_LIKE:      { label: 'いいね',      bg: '#FDE8D0', color: '#E8732A', Icon: Heart },
  POST_UNLIKE:    { label: 'いいね解除',  bg: '#F4EDDA', color: '#A8906E', Icon: Heart },
  POST_BOOKMARK:  { label: '保存',        bg: '#D6F0E4', color: '#1A7A48', Icon: Bookmark },
  POST_UNBOOKMARK:{ label: '保存解除',    bg: '#F4EDDA', color: '#A8906E', Icon: Bookmark },
  COMMENT_ADD:    { label: 'コメント',    bg: '#E8F4F0', color: '#1E7A5A', Icon: MessageCircle },
  COMMENT_DELETE: { label: 'コメント削除',bg: '#FDE8D0', color: '#C05A18', Icon: MessageCircle },
  VIBE_SET:       { label: 'バイブ設定',  bg: '#F0E8F8', color: '#6B35A8', Icon: Smile },
  VIBE_CLEAR:     { label: 'バイブ解除',  bg: '#F4EDDA', color: '#A8906E', Icon: Smile },
  USER_UPDATE:    { label: 'ユーザー編集',bg: '#F0E8D8', color: '#7A5C30', Icon: UserIcon },
}

const ACTION_FILTERS = [
  { id: '',               label: 'すべて' },
  { id: 'POST_CREATE',    label: '投稿' },
  { id: 'POST_DELETE',    label: '削除' },
  { id: 'COMMENT_ADD',    label: 'コメント' },
  { id: 'POST_LIKE',      label: 'いいね' },
  { id: 'POST_BOOKMARK',  label: '保存' },
  { id: 'VIBE_SET',       label: 'バイブ' },
  { id: 'USER_UPDATE',    label: 'ユーザー' },
]

function AuditLogTab() {
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(0)
  const PER_PAGE = 40

  const { data, isLoading, refetch, isFetching } = useQuery<{ logs: AuditEntry[] }>({
    queryKey: ['audit-log', actionFilter, page],
    queryFn: () => {
      const p = new URLSearchParams({ limit: String(PER_PAGE), offset: String(page * PER_PAGE) })
      if (actionFilter) p.set('action', actionFilter)
      return api.get(`/admin/audit-log?${p}`)
    },
    staleTime: 30_000,
  })

  const logs = data?.logs ?? []

  return (
    <div className="max-w-[700px]">
      {/* Controls */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex gap-1.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {ACTION_FILTERS.map(({ id, label }) => {
            const active = actionFilter === id
            return (
              <motion.button
                key={id}
                onClick={() => { setActionFilter(id); setPage(0) }}
                whileTap={{ scale: 0.93 }}
                transition={PILL_SPRING}
                className="relative whitespace-nowrap px-3 py-1 rounded-full text-[11.5px] font-bold flex-shrink-0"
                style={{
                  color: active ? '#FFFFFF' : '#8A7A68',
                  border: `1.5px solid ${active ? '#E8732A' : '#E4D4B8'}`,
                  background: active ? 'transparent' : '#FFFDF7',
                }}
              >
                {active && (
                  <motion.span
                    layoutId="log-filter-pill"
                    className="absolute inset-0 rounded-full"
                    style={{ background: '#E8732A' }}
                    transition={PILL_SPRING}
                  />
                )}
                <span className="relative z-10">{label}</span>
              </motion.button>
            )
          })}
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11.5px] font-bold flex-shrink-0 transition-opacity"
          style={{ background: '#F0E8D8', color: '#7A5C30' }}
        >
          <RefreshCw size={12} strokeWidth={2.5} className={isFetching ? 'animate-spin' : ''} />
          更新
        </button>
      </div>

      {/* Log entries */}
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0,1,2,3,4].map(i => (
            <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: '#E4D4B8' }} />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16">
          <FileText size={36} color="#D8C9A8" className="mx-auto mb-3" />
          <div className="text-brand-muted text-[13px]">ログがありません</div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {logs.map((entry, i) => {
            const meta = ACTION_META[entry.action] ?? { label: entry.action, bg: '#F0E8D8', color: '#7A5C30', Icon: FileText }
            const { Icon } = meta
            const initials = initialsOf(entry.actor_name)
            const time = new Date(entry.created_at)
            const timeStr = time.toLocaleString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

            return (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.015, 0.2) }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{ background: '#FFFDF7', border: '1px solid #E4D4B8' }}
              >
                {/* Actor avatar */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold text-[10px] flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #E87040, #F5A460)' }}
                >
                  {initials}
                </div>

                {/* Action badge */}
                <span
                  className="flex items-center gap-1 text-[10px] font-extrabold px-2 py-1 rounded-full flex-shrink-0"
                  style={{ background: meta.bg, color: meta.color }}
                >
                  <Icon size={10} strokeWidth={2.5} />
                  {meta.label}
                </span>

                {/* Actor + target */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <span className="font-bold text-[12.5px] text-brand-dark">{entry.actor_name}</span>
                    {entry.target_post_title && (
                      <span className="text-brand-muted text-[11px] truncate max-w-[200px]">— {entry.target_post_title}</span>
                    )}
                    {entry.detail?.can_post !== undefined && (
                      <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: entry.detail.can_post ? '#D6F0E4' : '#FDE8D0', color: entry.detail.can_post ? '#1A7A48' : '#C05A18' }}>
                        {entry.detail.can_post ? '投稿許可' : '投稿制限'}
                      </span>
                    )}
                  </div>
                  {entry.detail?.comment_preview != null && (
                    <div className="text-[10.5px] text-brand-muted mt-0.5 truncate">
                      💬 {String(entry.detail.comment_preview)}
                    </div>
                  )}
                  {entry.detail?.emoji != null && (
                    <div className="text-[10.5px] text-brand-muted mt-0.5">
                      {String(entry.detail.emoji)}{' '}{String(entry.detail.label ?? '')}
                    </div>
                  )}
                </div>

                {/* Time */}
                <div className="text-[11px] text-brand-muted flex-shrink-0">{timeStr}</div>
              </motion.div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {(page > 0 || logs.length === PER_PAGE) && (
        <div className="flex items-center justify-center gap-3 mt-5">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-full text-[12px] font-bold disabled:opacity-30 transition-opacity"
            style={{ background: '#F0E8D8', color: '#7A5C30' }}
          >
            ← 前へ
          </button>
          <span className="text-[12px] text-brand-muted font-semibold">ページ {page + 1}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={logs.length < PER_PAGE}
            className="px-4 py-2 rounded-full text-[12px] font-bold disabled:opacity-30 transition-opacity"
            style={{ background: '#F0E8D8', color: '#7A5C30' }}
          >
            次へ →
          </button>
        </div>
      )}
    </div>
  )
}
