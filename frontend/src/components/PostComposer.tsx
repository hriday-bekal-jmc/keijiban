import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Paperclip, Bold, Italic, Strikethrough, Highlighter, List, ListOrdered,
  CheckSquare, Code2, Quote, Minus, Link2, ImagePlus, Calendar, ChevronDown,
  Undo2, Redo2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { useEditor, EditorContent } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Highlight from '@tiptap/extension-highlight'
import Typography from '@tiptap/extension-typography'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import { Markdown } from 'tiptap-markdown'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Table } from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import { Node, Extension, mergeAttributes } from '@tiptap/core'
import { api } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { CALLOUT_STYLES } from '../lib/callouts'
import { initials as initialsOf } from '../lib/postMeta'
import type { Department, Post } from '../types'

// ── FontSize mark extension (extends TextStyle) ─────────────────────────────────
const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() { return { types: ['textStyle'] } },
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => el.style.fontSize || null,
          renderHTML: attrs => attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
        },
      },
    }]
  },
  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }: { chain: () => any }) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: { chain: () => any }) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

// ── Callout block node ──────────────────────────────────────────────────────────
const CalloutNode = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      calloutType: {
        default: 'info',
        parseHTML: el => el.getAttribute('data-callout') ?? 'info',
        renderHTML: attrs => ({ 'data-callout': attrs.calloutType }),
      },
    }
  },
  parseHTML() { return [{ tag: 'div[data-callout]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ class: 'kb-callout' }, HTMLAttributes), 0]
  },
  addCommands(): Record<string, (...args: any[]) => any> {
    return {
      insertCallout: (calloutType: string) => ({ chain }: { chain: () => any }) =>
        chain().insertContent({
          type: this.name,
          attrs: { calloutType },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '内容を入力…' }] }],
        }).run(),
    }
  },
})

// ── Constants ──────────────────────────────────────────────────────────────────

const TYPE_OPTIONS = [
  {
    id: 'ANNOUNCEMENT', emoji: '📢', label: 'お知らせ',
    description: '全社向けの重要な情報共有',
    bg: '#FDE8D0', color: '#B84A0E',
    template: '## 概要\n\n\n## 詳細\n\n\n## アクション\n',
  },
  {
    id: 'KNOWLEDGE', emoji: '📚', label: 'ナレッジ',
    description: 'ノウハウ・情報の蓄積',
    bg: '#D8EAF8', color: '#1E5FA8',
    template: '## 課題・背景\n\n\n## 解決策\n\n\n## ポイント\n',
  },
  {
    id: 'DAILY_REPORT', emoji: '📊', label: '日報',
    description: '本日の作業・成果報告',
    bg: '#D6F0E4', color: '#1A7A48',
    template: '## 本日の作業\n\n\n## 成果・進捗\n\n\n## 明日の予定\n',
  },
  {
    id: 'CHAT', emoji: '💬', label: '雑談',
    description: '気軽な話題・情報交換',
    bg: '#F0E8F8', color: '#6B35A8',
    template: '',
  },
  {
    id: 'DEPARTMENT', emoji: '🏢', label: '部署連絡',
    description: '部署内メンバーへの連絡',
    bg: '#E8F0E0', color: '#2E6818',
    template: '## 連絡事項\n\n\n## 対象者\n\n\n## 期限・対応\n',
  },
]

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

const DRAFT_KEY = 'kb_post_draft'
const MAX_TITLE  = 255

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ── Editor toolbar ─────────────────────────────────────────────────────────────

type EditorInstance = ReturnType<typeof useEditor>

function TBtn({
  onClick, active, title, children, disabled,
}: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="w-7 h-7 rounded-md flex items-center justify-center transition-all disabled:opacity-30"
      style={{
        color:      active ? '#E8732A' : '#8A7A68',
        background: active ? '#FDE8D0' : 'transparent',
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#F0E8D8' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      {children}
    </button>
  )
}

function TSep() {
  return <div className="w-px h-4 flex-shrink-0" style={{ background: '#E4D4B8' }} />
}

function EditorToolbar({ editor, onInsertImage }: { editor: EditorInstance; onInsertImage: () => void }) {
  if (!editor) return null
  const [showColors, setShowColors] = useState(false)

  const setLink = () => {
    const prev = editor.getAttributes('link').href ?? ''
    const url = window.prompt('URLを入力:', prev)
    if (url === null) return
    if (!url.trim()) { editor.chain().focus().unsetLink().run(); return }
    const href = url.startsWith('http') ? url : `https://${url}`
    editor.chain().focus().setLink({ href, target: '_blank' }).run()
  }

  const sz = 13, sw = 2.5

  const PRESET_COLORS = [
    '#3A2A1A', '#E8732A', '#1E5FA8', '#1A7A48',
    '#A83030', '#6B35A8', '#C0930A', '#0A7A8A', '#888888',
  ]
  const currentColor: string | null = editor.getAttributes('textStyle').color ?? null
  const currentFontSize: string | null = editor.getAttributes('textStyle').fontSize ?? null
  const SIZES: Array<[string, string | null]> = [
    ['小', '11px'], ['標準', null], ['大', '18px'], ['特大', '24px'],
  ]
  const inTable = editor.isActive('tableCell') || editor.isActive('tableHeader')

  return (
    <div style={{ borderBottom: '1px solid #E4D4B8' }}>
      {/* ── Row 1: core formatting ── */}
      <div className="flex items-center gap-0.5 px-2.5 py-1.5 flex-wrap" style={{ background: '#FAFAF5' }}>
        <TBtn title="太字 (Ctrl+B)"    onClick={() => editor.chain().focus().toggleBold().run()}       active={editor.isActive('bold')}>      <Bold size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="斜体 (Ctrl+I)"    onClick={() => editor.chain().focus().toggleItalic().run()}     active={editor.isActive('italic')}>    <Italic size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="打消し線"          onClick={() => editor.chain().focus().toggleStrike().run()}     active={editor.isActive('strike')}>    <Strikethrough size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="ハイライト"        onClick={() => editor.chain().focus().toggleHighlight().run()}  active={editor.isActive('highlight')}> <Highlighter size={sz} strokeWidth={sw} /></TBtn>
        <TSep />
        <TBtn title="見出し H1" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '-0.5px' }}>H1</span>
        </TBtn>
        <TBtn title="見出し H2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '-0.5px' }}>H2</span>
        </TBtn>
        <TBtn title="見出し H3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '-0.5px' }}>H3</span>
        </TBtn>
        <TSep />
        <TBtn title="箇条書き"       onClick={() => editor.chain().focus().toggleBulletList().run()}   active={editor.isActive('bulletList')}>  <List size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="番号付きリスト" onClick={() => editor.chain().focus().toggleOrderedList().run()}  active={editor.isActive('orderedList')}> <ListOrdered size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="チェックリスト" onClick={() => editor.chain().focus().toggleTaskList().run()}     active={editor.isActive('taskList')}>    <CheckSquare size={sz} strokeWidth={sw} /></TBtn>
        <TSep />
        <TBtn title="コードブロック" onClick={() => editor.chain().focus().toggleCodeBlock().run()}    active={editor.isActive('codeBlock')}>   <Code2 size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="引用"           onClick={() => editor.chain().focus().toggleBlockquote().run()}   active={editor.isActive('blockquote')}>  <Quote size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="区切り線"       onClick={() => editor.chain().focus().setHorizontalRule().run()}><Minus size={sz} strokeWidth={sw} /></TBtn>
        <TBtn title="リンク (Ctrl+K)" onClick={setLink} active={editor.isActive('link')}>              <Link2 size={sz} strokeWidth={sw} /></TBtn>
        <TSep />
        <TBtn title="画像を挿入" onClick={onInsertImage}><ImagePlus size={sz} strokeWidth={sw} /></TBtn>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
          <TBtn title="元に戻す (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 size={sz} strokeWidth={sw} /></TBtn>
          <TBtn title="やり直し (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Redo2 size={sz} strokeWidth={sw} /></TBtn>
        </div>
      </div>

      {/* ── Row 2: text size, color, table, callouts ── */}
      <div className="flex items-center gap-0.5 px-2.5 py-1 flex-wrap" style={{ background: '#F4EEE4' }}>
        {/* Font size */}
        <span style={{ fontSize: 9, fontWeight: 700, color: '#A8906E', flexShrink: 0 }}>サイズ</span>
        {SIZES.map(([label, size]) => (
          <TBtn key={label}
            title={`文字サイズ: ${label}`}
            active={size === null ? !currentFontSize : currentFontSize === size}
            onClick={() => size
              ? (editor as any).chain().focus().setFontSize(size).run()
              : (editor as any).chain().focus().unsetFontSize().run()
            }>
            <span style={{ fontSize: 9, fontWeight: 800 }}>{label}</span>
          </TBtn>
        ))}
        <TSep />
        {/* Text color */}
        <div className="relative" style={{ flexShrink: 0 }}>
          <TBtn title="文字色" active={showColors || !!currentColor}
            onClick={() => setShowColors(v => !v)}>
            <div style={{ position: 'relative', lineHeight: 1, paddingBottom: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 900 }}>A</span>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, height: 2.5,
                background: currentColor ?? '#3A2A1A', borderRadius: 1,
              }} />
            </div>
          </TBtn>
          {showColors && (
            <div
              className="absolute top-full left-0 mt-1 p-2 rounded-xl z-50"
              style={{ background: '#2A1A0A', boxShadow: '0 4px 16px rgba(0,0,0,0.3)', minWidth: 118 }}
              onMouseDown={e => e.preventDefault()}
            >
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {PRESET_COLORS.map(c => (
                  <button key={c} type="button"
                    onMouseDown={e => { e.preventDefault(); editor.chain().focus().setColor(c).run(); setShowColors(false) }}
                    style={{
                      width: 18, height: 18, borderRadius: '50%', background: c, flexShrink: 0,
                      outline: currentColor === c ? '2px solid white' : 'none', outlineOffset: 1,
                      border: 'none', cursor: 'pointer',
                    }}
                  />
                ))}
              </div>
              <button type="button"
                onMouseDown={e => { e.preventDefault(); editor.chain().focus().unsetColor().run(); setShowColors(false) }}
                style={{ width: '100%', fontSize: 9, fontWeight: 700, color: '#D4C4A0', background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 4, padding: '2px 0', cursor: 'pointer' }}
              >リセット</button>
            </div>
          )}
        </div>
        <TSep />
        {/* Table */}
        <TBtn title="表を挿入 (3×3)"
          active={inTable}
          onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <span style={{ fontSize: 9, fontWeight: 800 }}>⊞表</span>
        </TBtn>
        {inTable && (
          <>
            <TBtn title="列を右に追加" onClick={() => editor.chain().focus().addColumnAfter().run()}>
              <span style={{ fontSize: 8, fontWeight: 700 }}>+列</span>
            </TBtn>
            <TBtn title="行を下に追加" onClick={() => editor.chain().focus().addRowAfter().run()}>
              <span style={{ fontSize: 8, fontWeight: 700 }}>+行</span>
            </TBtn>
            <TBtn title="列を削除" onClick={() => editor.chain().focus().deleteColumn().run()}>
              <span style={{ fontSize: 8, fontWeight: 700 }}>−列</span>
            </TBtn>
            <TBtn title="行を削除" onClick={() => editor.chain().focus().deleteRow().run()}>
              <span style={{ fontSize: 8, fontWeight: 700 }}>−行</span>
            </TBtn>
            <TBtn title="表を削除" onClick={() => editor.chain().focus().deleteTable().run()}>
              <span style={{ fontSize: 8, fontWeight: 700 }}>表×</span>
            </TBtn>
          </>
        )}
        <TSep />
        {/* Callout boxes */}
        <span style={{ fontSize: 9, fontWeight: 700, color: '#A8906E', flexShrink: 0 }}>BOX</span>
        {(Object.entries(CALLOUT_STYLES) as Array<[string, { bg: string; border: string; icon: string }]>).map(([type, c]) => (
          <button key={type} type="button" title={`${c.icon} ボックス挿入`}
            onMouseDown={e => e.preventDefault()}
            onClick={() => (editor as any).chain().focus().insertCallout(type).run()}
            style={{
              width: 26, height: 26, borderRadius: 6, fontSize: 13, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              background: c.bg, border: `1.5px solid ${c.border}`,
              cursor: 'pointer', flexShrink: 0, transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.opacity = '0.75' }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
          >{c.icon}</button>
        ))}
      </div>
    </div>
  )
}

// ── Draft persistence ──────────────────────────────────────────────────────────

interface DraftData {
  title: string; content: string; type: string
  visibility: string; deptIds: string[]; tags: string[]; eventDate: string
}

function loadDraft(): DraftData | null {
  try {
    const s = localStorage.getItem(DRAFT_KEY)
    if (!s) return null
    const d = JSON.parse(s) as DraftData
    if (!d.title && !d.content) return null
    return d
  } catch { return null }
}

function saveDraft(d: DraftData) {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch {}
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY) } catch {}
}

// ── Main component ─────────────────────────────────────────────────────────────

interface PostComposerProps {
  onClose: () => void
  editPost?: Post
  onSaved?: (updated: Post) => void
}

export default function PostComposer({ onClose, editPost, onSaved }: PostComposerProps) {
  const isEdit = !!editPost
  const { user }    = useAuth()
  const queryClient = useQueryClient()
  const toast       = useToast()
  const titleRef       = useRef<HTMLInputElement>(null)
  const fileInputRef   = useRef<HTMLInputElement>(null)
  const inlineImgRef   = useRef<HTMLInputElement>(null)

  const [type, setType]           = useState<string>(editPost?.post_type ?? 'ANNOUNCEMENT')
  const [visibility, setVis]      = useState<string>(editPost?.visibility_scope ?? 'COMPANY_WIDE')
  const [deptIds, setDeptIds]     = useState<string[]>([])
  const [title, setTitle]         = useState(editPost?.title ?? '')
  const [tagInput, setTagInput]   = useState('')
  const [tags, setTags]           = useState<string[]>(editPost?.tags ?? [])
  const [eventDate, setEventDate] = useState(editPost?.event_date ?? '')
  const [files, setFiles]         = useState<File[]>([])
  const [previews, setPreviews]   = useState<string[]>([])
  const [inlineImages, setInlineImages] = useState<{ id: string; dataUrl: string; file: File }[]>([])
  const [isDragging, setIsDragging]   = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [draftBanner, setDraftBanner] = useState<DraftData | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [bubblePos, setBubblePos] = useState<{ top: number; left: number } | null>(null)
  const [draftStatus, setDraftStatus]   = useState<'saved' | 'saving' | ''>('')
  const [content, setContent] = useState(editPost?.content ?? TYPE_OPTIONS[0].template)
  const [notifyStep, setNotifyStep]     = useState(false)
  const [isNotifying, setIsNotifying]   = useState(false)

  const initials = initialsOf(user?.full_name)

  // Ref so editorProps closures can call the latest insertInlineImage
  const insertInlineImageRef = useRef<(f: File) => void>(() => {})

  // ── Tiptap editor ───────────────────────────────────────────────────────────
  const editor = useEditor({
    extensions: [
      // StarterKit v3 bundles Link — configure it here instead of a separate dep
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      TaskList,
      TaskItem.configure({ nested: false }),
      Highlight,
      Typography,
      Placeholder.configure({ placeholder: '内容を入力してください…' }),
      Image.configure({ inline: false }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: false }),
      TextStyle,
      Color,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      FontSize,
      CalloutNode,
    ],
    content: isEdit ? '' : TYPE_OPTIONS[0].template,
    onCreate: ({ editor }) => {
      if (isEdit && editPost?.content) {
        // Use setContent so tiptap-markdown's override parses markdown properly.
        // Passing markdown as the useEditor `content:` option bypasses that parser.
        editor.commands.setContent(editPost.content)
        setContent(editPost.content)
      }
    },
    onUpdate: ({ editor }) => {
      setContent((editor.storage as unknown as Record<string, { getMarkdown: () => string }>).markdown.getMarkdown())
    },
    editorProps: {
      handlePaste: (_view, event) => {
        const imgItem = Array.from(event.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'))
        if (imgItem) { const f = imgItem.getAsFile(); if (f) { insertInlineImageRef.current(f); return true } }
        return false
      },
      handleDrop: (_view, event) => {
        const imgs = Array.from((event as DragEvent).dataTransfer?.files ?? []).filter(f => f.type.startsWith('image/'))
        if (imgs.length) { event.preventDefault(); imgs.forEach(f => insertInlineImageRef.current(f)); return true }
        return false
      },
    },
  })

  const insertInlineImage = useCallback((file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > 8 * 1024 * 1024) { toast.error('インライン画像は8MB以下にしてください'); return }
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      setInlineImages(prev => [...prev, { id, dataUrl, file }])
      editor?.chain().focus().setImage({ src: dataUrl, alt: file.name }).run()
    }
    reader.readAsDataURL(file)
  }, [editor, toast])

  // Keep insertInlineImageRef current (used in editorProps closures)
  useEffect(() => { insertInlineImageRef.current = insertInlineImage }, [insertInlineImage])

  // Manual bubble menu — track text selection position
  useEffect(() => {
    if (!editor) return
    const update = () => {
      const { state, view } = editor
      const { selection } = state
      if (selection.empty || !view.hasFocus()) { setBubblePos(null); return }
      const start = view.coordsAtPos(selection.from)
      const end   = view.coordsAtPos(selection.to)
      setBubblePos({ top: Math.min(start.top, end.top) - 48, left: (start.left + end.left) / 2 })
    }
    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    return () => { editor.off('selectionUpdate', update); editor.off('transaction', update) }
  }, [editor])

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  // Check draft on mount (skip in edit mode), focus title
  useEffect(() => {
    if (!isEdit) {
      const d = loadDraft()
      if (d) setDraftBanner(d)
    }
    setTimeout(() => titleRef.current?.focus(), 150)
  }, [isEdit])

  // Revoke preview object URLs on unmount
  useEffect(() => () => { previews.forEach(URL.revokeObjectURL) }, [previews])

  // Escape closes (unless a dialog is open)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Auto-save draft (debounced 2s, skip in edit mode)
  useEffect(() => {
    if (isEdit || (!title && !content)) return
    setDraftStatus('saving')
    const t = setTimeout(() => {
      saveDraft({ title, content, type, visibility, deptIds, tags, eventDate })
      setDraftStatus('saved')
      setTimeout(() => setDraftStatus(''), 2000)
    }, 2000)
    return () => clearTimeout(t)
  }, [isEdit, title, content, type, visibility, deptIds, tags, eventDate])

  // ── Data ────────────────────────────────────────────────────────────────────

  const { data: deptsData } = useQuery<{ departments: Department[] }>({
    queryKey: ['departments'],
    queryFn: () => api.get('/admin/departments'),
    staleTime: Infinity,
  })
  const departments = deptsData?.departments ?? []

  // ── File helpers ────────────────────────────────────────────────────────────

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming)
    const valid = arr.filter(f => {
      if (!ALLOWED_TYPES.has(f.type)) { toast.error(`${f.name}: 非対応形式`); return false }
      if (f.size > 20 * 1024 * 1024)  { toast.error(`${f.name}: 20MB超`);    return false }
      return true
    })
    setFiles(prev => [...prev, ...valid].slice(0, 5))
    setPreviews(prev => [...prev, ...valid.map(f => f.type.startsWith('image/') ? URL.createObjectURL(f) : '')].slice(0, 5))
  }, [toast])

  const removeFile = (i: number) => {
    if (previews[i]) URL.revokeObjectURL(previews[i])
    setFiles(p => p.filter((_, j) => j !== i))
    setPreviews(p => p.filter((_, j) => j !== i))
  }

  // ── Type selection (applies template if editor is empty / has current template) ──

  const handleTypeSelect = (newType: string) => {
    const opt = TYPE_OPTIONS.find(o => o.id === newType)
    if (!opt) return
    const currentOpt = TYPE_OPTIONS.find(o => o.id === type)
    const isEmpty = editor?.isEmpty ?? true
    const hasTemplate = (editor?.storage as unknown as Record<string, { getMarkdown: () => string }>)?.markdown?.getMarkdown() === currentOpt?.template
    if ((isEmpty || hasTemplate) && opt.template && editor) {
      editor.commands.setContent(opt.template)
      setContent(opt.template)
    }
    if (newType === 'DEPARTMENT') setVis('DEPARTMENT')
    setType(newType)
  }

  // ── Draft restore ───────────────────────────────────────────────────────────

  const restoreDraft = (d: DraftData) => {
    setTitle(d.title)
    if (editor && d.content) { editor.commands.setContent(d.content); setContent(d.content) }
    setType(d.type); setVis(d.visibility); setDeptIds(d.deptIds ?? []); setTags(d.tags ?? []); setEventDate(d.eventDate ?? '')
    setDraftBanner(null)
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  const createPost = useMutation<{ post: { id: string } }, Error, Record<string, unknown>>({
    mutationFn: (body) => { const { _hasFiles: _, ...rest } = body; return api.post('/posts', rest) },
    onMutate: async (body) => {
      if (body._hasFiles) return null
      await queryClient.cancelQueries({ queryKey: ['posts'] })
      const optimistic = {
        id: `optimistic-${Date.now()}`, title: body.title, content: body.content,
        post_type: body.post_type, visibility_scope: body.visibility_scope,
        tags: body.tags, attachments: [], created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), author_id: user?.id, author_name: user?.full_name,
        author_avatar: user?.avatar_url, author_dept: user?.department_name,
        likes_count: 0, comments_count: 0, liked_by_me: false, is_bookmarked_by_me: false, is_pinned: false,
      }
      queryClient.setQueriesData({ queryKey: ['posts'] }, (old: unknown) => {
        const d = old as { pages?: Array<{ posts: unknown[]; nextCursor: unknown }>; pageParams?: unknown[] } | undefined
        if (!d?.pages) return old
        return { ...d, pages: [{ posts: [optimistic, ...(d.pages[0]?.posts ?? [])], nextCursor: d.pages[0]?.nextCursor }, ...d.pages.slice(1)] }
      })
      return { optimistic }
    },
    onError: (_err, _body, ctx: unknown) => {
      const c = ctx as { optimistic?: { id: string } } | null
      if (c?.optimistic) {
        queryClient.setQueriesData({ queryKey: ['posts'] }, (old: unknown) => {
          const d = old as { pages?: Array<{ posts: Array<{ id: string }> }> } | undefined
          if (!d?.pages) return old
          return { ...d, pages: d.pages.map(p => ({ ...p, posts: p.posts.filter(post => post.id !== c.optimistic!.id) })) }
        })
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
      queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
    },
  })

  const handleSubmit = async () => {
    if (!title.trim() || !editor || (!isEdit && editor.isEmpty) || createPost.isPending || isUploading) return
    const hasFiles  = files.length > 0
    const hasInline = inlineImages.length > 0

    let submitContent = (editor.storage as unknown as Record<string, { getMarkdown: () => string }>).markdown.getMarkdown()
    inlineImages.forEach(({ id, dataUrl }) => {
      submitContent = submitContent.split(dataUrl).join(`inline:${id}`)
    })

    // ── EDIT MODE ──────────────────────────────────────────────────────────────
    if (isEdit && editPost) {
      try {
        let finalContent = submitContent
        setIsUploading(true)

        if (hasInline) {
          try {
            const fd = new FormData()
            inlineImages.forEach(({ file }) => fd.append('files', file))
            const result = await api.post(`/uploads/${editPost.id}`, fd) as { attachments: Array<{ thumbnail_path: string | null }> }
            inlineImages.forEach(({ id }, idx) => {
              const tp = result.attachments?.[idx]?.thumbnail_path
              if (tp) finalContent = finalContent.replace(new RegExp(`inline:${id}`, 'g'), tp)
            })
          } catch { toast.info('インライン画像のアップロードに失敗しました') }
        }

        if (hasFiles) {
          try {
            const fd = new FormData()
            files.forEach(f => fd.append('files', f))
            await api.post(`/uploads/${editPost.id}`, fd)
          } catch { toast.info('添付ファイルのアップロードに失敗しました') }
        }

        const data = await api.put<{ post: Post }>(`/posts/${editPost.id}`, {
          title: title.trim(), content: finalContent, tags, event_date: eventDate || null,
        })

        setIsUploading(false)
        queryClient.invalidateQueries({ queryKey: ['posts'] })
        queryClient.invalidateQueries({ queryKey: ['post', editPost.id] })
        queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
        toast.success('投稿を保存しました')
        // Use server-returned post if available; fall back to local state so onSaved always fires
        const savedPost: Post = data?.post ?? {
          ...editPost,
          title: title.trim(),
          content: finalContent,
          tags,
          updated_at: new Date().toISOString(),
        }
        onSaved?.(savedPost)
        setNotifyStep(true)  // stay open and show re-notify prompt
      } catch (err) {
        console.error('[PostComposer edit save]', err)
        setIsUploading(false)
        toast.error(typeof err === 'string' ? err : '保存に失敗しました')
      }
      return
    }

    // ── CREATE MODE ────────────────────────────────────────────────────────────
    try {
      const data = await createPost.mutateAsync({
        title: title.trim(), content: submitContent, post_type: type,
        visibility_scope: visibility, tags,
        department_ids: visibility === 'DEPARTMENT' ? deptIds : [],
        _hasFiles: hasFiles || hasInline, event_date: eventDate || null,
      })

      const postId = data.post.id
      setIsUploading(true)

      if (hasInline) {
        try {
          const fd = new FormData()
          inlineImages.forEach(({ file }) => fd.append('files', file))
          const result = await api.post(`/uploads/${postId}`, fd) as { attachments: Array<{ thumbnail_path: string | null }> }
          let updatedContent = submitContent
          inlineImages.forEach(({ id }, idx) => {
            const tp = result.attachments?.[idx]?.thumbnail_path
            if (tp) updatedContent = updatedContent.replace(new RegExp(`inline:${id}`, 'g'), tp)
          })
          await api.put(`/posts/${postId}`, { content: updatedContent })
        } catch { toast.info('インライン画像のアップロードに失敗しました') }
      }

      if (hasFiles) {
        try {
          const fd = new FormData()
          files.forEach(f => fd.append('files', f))
          await api.post(`/uploads/${postId}`, fd)
        } catch { toast.info('添付ファイルのアップロードに失敗しました') }
      }

      setIsUploading(false)
      queryClient.invalidateQueries({ queryKey: ['posts'] })
      queryClient.invalidateQueries({ queryKey: ['profile-stats'] })
      queryClient.invalidateQueries({ queryKey: ['profile-posts'] })
      clearDraft()
      toast.success('投稿しました！')
      onClose()
    } catch { setIsUploading(false); toast.error('投稿に失敗しました') }
  }

  const handleNotify = async () => {
    if (!editPost) return
    setIsNotifying(true)
    try {
      await api.post(`/posts/${editPost.id}/notify`, {})
      toast.success('通知を再送しました')
    } catch {
      toast.error('通知の送信に失敗しました')
    }
    setIsNotifying(false)
    onClose()
  }

  // ── Tags ────────────────────────────────────────────────────────────────────

  const addTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault()
      const t = tagInput.trim().replace(/^#/, '')
      if (t && !tags.includes(t)) setTags(p => [...p, t])
      setTagInput('')
    }
    if (e.key === 'Backspace' && !tagInput && tags.length) setTags(p => p.slice(0, -1))
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const canSubmit = title.trim().length > 0 && editor && (isEdit || !editor.isEmpty) && !createPost.isPending && !isUploading
  const submitLabel = isUploading ? 'アップロード中…' : (isEdit ? (createPost.isPending ? '保存中…' : '保存する　→') : (createPost.isPending ? '投稿中…' : '投稿する　→'))
  const selectedOpt = TYPE_OPTIONS.find(o => o.id === type)!
  const words = content.trim().split(/[\s\n]+/).filter(Boolean).length

  // ── Settings panel ─────────────────────────────────────────────────────────
  // JSX variable (not inner component) to avoid remount on re-render

  const settingsContent = (
    <div className="flex flex-col gap-5">
      {/* Type cards */}
      <div>
        <div className="text-[10.5px] font-bold text-brand-muted uppercase tracking-widest mb-2.5">投稿タイプ</div>
        <div className="flex flex-col gap-1.5">
          {TYPE_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => handleTypeSelect(opt.id)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all"
              style={{
                background: type === opt.id ? opt.bg : 'transparent',
                border: `1.5px solid ${type === opt.id ? opt.color + '50' : '#E4D4B8'}`,
              }}
            >
              <span className="text-lg leading-none flex-shrink-0">{opt.emoji}</span>
              <div className="min-w-0">
                <div className="font-extrabold text-[12px]" style={{ color: type === opt.id ? opt.color : '#3A2A1A' }}>{opt.label}</div>
                <div className="text-[10px] text-brand-muted truncate">{opt.description}</div>
              </div>
              {type === opt.id && (
                <div className="w-2 h-2 rounded-full ml-auto flex-shrink-0" style={{ background: opt.color }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Audience */}
      <div>
        <div className="text-[10.5px] font-bold text-brand-muted uppercase tracking-widest mb-2.5">公開範囲</div>
        <div className="flex gap-1.5 mb-2">
          {[
            { id: 'COMPANY_WIDE', label: '🌐 全社' },
            { id: 'DEPARTMENT',   label: '🏢 部署内' },
          ].map(opt => (
            <button
              key={opt.id}
              onClick={() => { setVis(opt.id); if (opt.id !== 'DEPARTMENT') setDeptIds([]) }}
              className="flex-1 py-2 rounded-xl text-[12px] font-extrabold transition-all"
              style={{
                background: visibility === opt.id ? '#3A2A1A' : '#F0E8D8',
                color:      visibility === opt.id ? '#FFFDF7'  : '#7A5C30',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {visibility === 'DEPARTMENT' && departments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {departments.map(d => (
              <button
                key={d.id}
                onClick={() => setDeptIds(p => p.includes(d.id) ? p.filter(x => x !== d.id) : [...p, d.id])}
                className="text-[10.5px] font-bold px-2.5 py-1 rounded-full transition-all"
                style={{
                  background: deptIds.includes(d.id) ? '#E8732A' : '#F0E8D8',
                  color:      deptIds.includes(d.id) ? '#FFFDF7'  : '#7A5C30',
                }}
              >
                {d.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tags */}
      <div>
        <div className="text-[10.5px] font-bold text-brand-muted uppercase tracking-widest mb-2.5">タグ</div>
        <div
          className="flex flex-wrap gap-1.5 p-2.5 rounded-xl min-h-[40px] cursor-text"
          style={{ background: '#FAF5EC', border: '1.5px solid #E4D4B8' }}
          onClick={() => document.getElementById('tag-input-main')?.focus()}
        >
          {tags.map(t => (
            <span key={t} className="flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full" style={{ background: '#FDE8D0', color: '#B84A0E' }}>
              #{t}
              <button onClick={e => { e.stopPropagation(); setTags(p => p.filter(x => x !== t)) }} className="opacity-60 hover:opacity-100 leading-none">×</button>
            </span>
          ))}
          <input
            id="tag-input-main"
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={addTag}
            placeholder={tags.length === 0 ? 'タグ追加（Enter）…' : ''}
            className="flex-1 min-w-[80px] bg-transparent outline-none text-[11.5px] text-brand-dark placeholder-brand-muted"
          />
        </div>
      </div>

      {/* Event date */}
      <div>
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-[10.5px] font-bold text-brand-muted uppercase tracking-widest flex items-center gap-1.5">
            <Calendar size={11} strokeWidth={2.5} />イベント日時
          </div>
          {eventDate && (
            <button onClick={() => setEventDate('')} className="text-[10px] font-bold" style={{ color: '#E8732A' }}>クリア</button>
          )}
        </div>
        <input
          type="datetime-local"
          value={eventDate}
          onChange={e => setEventDate(e.target.value)}
          className="w-full px-3 py-2 rounded-xl text-[12px] text-brand-dark outline-none transition-all"
          style={{ background: '#FAF5EC', border: `1.5px solid ${eventDate ? '#E8732A' : '#E4D4B8'}` }}
        />
      </div>

      {/* Attachments */}
      <div>
        <div className="text-[10.5px] font-bold text-brand-muted uppercase tracking-widest mb-2.5">添付ファイル ({files.length}/5)</div>
        <input ref={inlineImgRef} type="file" accept="image/*" className="hidden"
          onChange={e => { if (e.target.files?.[0]) insertInlineImage(e.target.files[0]); e.target.value = '' }} />
        <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx" className="hidden"
          onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }} />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {files.map((f, i) => (
              <div key={i} className="relative group">
                {previews[i] ? (
                  <img src={previews[i]} alt={f.name} className="w-16 h-16 object-cover rounded-xl" style={{ border: '1.5px solid #E4D4B8' }} />
                ) : (
                  <div className="w-16 h-16 rounded-xl flex flex-col items-center justify-center gap-0.5 px-1" style={{ background: '#F0E8D8', border: '1.5px solid #E4D4B8' }}>
                    <Paperclip size={14} color="#A8906E" />
                    <span className="text-[8px] font-semibold text-brand-muted text-center leading-tight break-all line-clamp-2">{f.name}</span>
                    <span className="text-[8px] text-brand-muted">{formatBytes(f.size)}</span>
                  </div>
                )}
                <button onClick={() => removeFile(i)}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: '#3A2A1A', color: '#FFFDF7' }}>×</button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={files.length >= 5}
          className="w-full py-2 rounded-xl text-[11.5px] font-bold transition-all disabled:opacity-30"
          style={{ background: '#F0E8D8', color: '#7A5C30', border: '1.5px dashed #D4C4A8' }}
          onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={e => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files) }}
        >
          {isDragging ? 'ドロップしてください' : '+ ファイルを添付 / ドラッグ＆ドロップ'}
        </button>
      </div>
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex items-stretch justify-center"
        style={{ background: 'rgba(58,42,26,0.55)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
      >
        <motion.div
          key="composer"
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-4xl m-auto rounded-3xl overflow-hidden flex flex-col"
          style={{ background: '#FFFDF7', border: '1px solid #E4D4B8', maxHeight: '94vh', boxShadow: '0 32px 80px rgba(58,42,26,0.28)' }}
        >
          {/* ── Top bar ── */}
          <div className="flex items-center gap-3 px-5 py-3.5 flex-shrink-0" style={{ borderBottom: '1px solid #E4D4B8', background: '#FAFAF5' }}>
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.full_name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-white font-extrabold text-[11px] flex-shrink-0" style={{ background: 'linear-gradient(135deg, #E87040, #F5A460)' }}>
                {initials}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="font-bold text-[12.5px] text-brand-dark leading-tight">{user?.full_name}</div>
              <div className="flex items-center gap-1.5 text-[10.5px] text-brand-muted">
                <span className="px-1.5 py-0.5 rounded-full font-bold text-[9.5px]" style={{ background: selectedOpt.bg, color: selectedOpt.color }}>
                  {selectedOpt.emoji} {selectedOpt.label}
                </span>
                <span>·</span>
                <span>{visibility === 'COMPANY_WIDE' ? '🌐 全社' : '🏢 部署内'}</span>
                {isEdit && <span className="ml-1 text-[9.5px] font-bold" style={{ color: '#6B35A8' }}>✏️ 編集中</span>}
                {!isEdit && draftStatus === 'saved'  && <span className="ml-1 text-[9.5px]" style={{ color: '#1A7A48' }}>✓ 下書き保存済み</span>}
                {!isEdit && draftStatus === 'saving' && <span className="ml-1 text-[9.5px] text-brand-muted">保存中…</span>}
              </div>
            </div>

            {/* Mobile settings toggle */}
            <button
              onClick={() => setShowSettings(v => !v)}
              className="md:hidden flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-bold"
              style={{ background: '#F0E8D8', color: '#7A5C30' }}
            >
              <ChevronDown size={12} style={{ transform: showSettings ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              設定
            </button>

            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center text-brand-muted" style={{ background: '#F0E8D8' }}>
              <X size={15} strokeWidth={2.5} />
            </button>
          </div>

          {/* ── Draft restore banner ── */}
          <AnimatePresence>
            {draftBanner && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden flex-shrink-0"
              >
                <div className="flex items-center gap-3 px-5 py-2.5 text-[12px]" style={{ background: '#FDE8D0', borderBottom: '1px solid #F0C898' }}>
                  <span className="font-semibold text-brand-dark flex-1">📝 前回の下書きが見つかりました</span>
                  <button onClick={() => restoreDraft(draftBanner)} className="font-extrabold" style={{ color: '#B84A0E' }}>復元</button>
                  <button onClick={() => { clearDraft(); setDraftBanner(null) }} className="text-brand-muted">×</button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Body ── */}
          <div className="flex flex-1 min-h-0">

            {/* ── Editor panel ── */}
            <div className="flex-1 flex flex-col min-w-0">

              {/* Title */}
              <div className="px-5 pt-4 pb-2 flex-shrink-0">
                <div className="relative">
                  <input
                    ref={titleRef}
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    maxLength={MAX_TITLE}
                    placeholder="タイトルを入力…"
                    className="w-full bg-transparent outline-none font-extrabold text-brand-dark pr-10"
                    style={{ fontSize: 22, letterSpacing: '-0.5px', lineHeight: 1.3 }}
                  />
                  <span className="absolute right-0 top-1 text-[10px] font-semibold"
                    style={{ color: title.length > MAX_TITLE * 0.9 ? '#E8732A' : '#C0A880' }}>
                    {title.length}/{MAX_TITLE}
                  </span>
                </div>
                <div className="h-px mt-2" style={{ background: title ? '#E8732A' : '#E4D4B8' }} />
              </div>

              {/* Toolbar */}
              <EditorToolbar editor={editor} onInsertImage={() => inlineImgRef.current?.click()} />

              {/* Floating bubble menu — appears when text is selected */}
              {editor && bubblePos && (
                <div
                  className="kb-bubble"
                  style={{ position: 'fixed', top: bubblePos.top, left: bubblePos.left, transform: 'translateX(-50%)', zIndex: 200, pointerEvents: 'auto' }}
                  onMouseDown={e => e.preventDefault()}
                >
                  <button className={editor.isActive('bold') ? 'active' : ''}      onClick={() => editor.chain().focus().toggleBold().run()}      title="太字"><Bold size={12} strokeWidth={2.5} /></button>
                  <button className={editor.isActive('italic') ? 'active' : ''}    onClick={() => editor.chain().focus().toggleItalic().run()}    title="斜体"><Italic size={12} strokeWidth={2.5} /></button>
                  <button className={editor.isActive('strike') ? 'active' : ''}    onClick={() => editor.chain().focus().toggleStrike().run()}    title="打消し線"><Strikethrough size={12} strokeWidth={2.5} /></button>
                  <button className={editor.isActive('highlight') ? 'active' : ''} onClick={() => editor.chain().focus().toggleHighlight().run()} title="ハイライト"><Highlighter size={12} strokeWidth={2.5} /></button>
                  <div className="sep" />
                  <button
                    className={editor.isActive('link') ? 'active' : ''}
                    title="リンク"
                    onClick={() => {
                      const prev = editor.getAttributes('link').href ?? ''
                      const url = window.prompt('URL:', prev)
                      if (url === null) return
                      if (!url.trim()) { editor.chain().focus().unsetLink().run(); return }
                      editor.chain().focus().setLink({ href: url.startsWith('http') ? url : `https://${url}`, target: '_blank' }).run()
                    }}
                  ><Link2 size={12} strokeWidth={2.5} /></button>
                </div>
              )}

              {/* WYSIWYG content area */}
              <div className="flex-1 overflow-y-auto px-5 py-3">
                <EditorContent editor={editor} />
              </div>

              {/* Footer */}
              {notifyStep ? (
                <div className="flex items-center gap-3 px-5 py-3 flex-shrink-0" style={{ borderTop: '1px solid #F0E8D8', background: '#FDE8D0' }}>
                  <span className="text-[13px] font-semibold text-brand-dark flex-1">編集しました！通知を再送しますか？</span>
                  <button
                    onClick={onClose}
                    className="px-4 py-2 rounded-full text-[12px] font-bold"
                    style={{ color: '#A8906E' }}
                  >
                    スキップ
                  </button>
                  <button
                    onClick={handleNotify}
                    disabled={isNotifying}
                    className="px-5 py-2 rounded-full text-[13px] font-extrabold text-white transition-all active:scale-95 disabled:opacity-60"
                    style={{ background: '#E8732A' }}
                  >
                    {isNotifying ? '送信中…' : '通知を送る'}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-5 py-2 flex-shrink-0" style={{ borderTop: '1px solid #F0E8D8' }}>
                  <span className="text-[10.5px] text-brand-muted">{words} 語</span>
                  {files.length > 0    && <span className="text-[10.5px] text-brand-muted">📎 {files.length}件</span>}
                  {inlineImages.length > 0 && <span className="text-[10.5px] text-brand-muted">🖼 {inlineImages.length}枚</span>}
                  <div className="flex-1" />
                  <button
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="px-6 py-2.5 rounded-full text-[13px] font-extrabold text-white transition-all active:scale-95 disabled:opacity-40"
                    style={{ background: canSubmit ? '#3A2A1A' : '#A8906E' }}
                  >
                    {submitLabel}
                  </button>
                </div>
              )}
            </div>

            {/* ── Settings sidebar (desktop) ── */}
            <div className="hidden md:flex flex-col w-72 flex-shrink-0 overflow-y-auto" style={{ borderLeft: '1px solid #E4D4B8', background: '#FAFAF5' }}>
              <div className="p-4">{settingsContent}</div>
            </div>
          </div>

          {/* Mobile settings drawer */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                className="md:hidden overflow-y-auto flex-shrink-0"
                style={{ borderTop: '1px solid #E4D4B8', background: '#FAFAF5', maxHeight: '50vh' }}
              >
                <div className="p-4">{settingsContent}</div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
