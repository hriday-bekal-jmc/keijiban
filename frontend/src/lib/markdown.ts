// Markdown renderer — line-by-line, no external deps, HTML-escaped first.
// Handles: H1–H3, bold/italic/strikethrough/highlight, inline code, code blocks,
// blockquotes, bullet/ordered/checkbox lists (grouped), tables, HR, images,
// markdown links [text](url), auto-detected bare URLs, @mention, color/size spans,
// callout boxes (from WYSIWYG editor).
// All visual styling lives in index.css under `.md-body` — output is class-based.

import DOMPurify from 'dompurify'
import { CALLOUT_STYLES } from './callouts'

// Defense in depth: the renderer escapes everything itself, but its output is
// injected via dangerouslySetInnerHTML — DOMPurify catches anything it misses.
const SANITIZE_OPTS = {
  ALLOWED_TAGS: ['div', 'span', 'a', 'img', 'strong', 'em', 's', 'mark', 'code', 'pre',
    'ul', 'ol', 'li', 'table', 'tr', 'th', 'td', 'hr', 'br'],
  ALLOWED_ATTR: ['class', 'style', 'href', 'src', 'alt', 'loading', 'target', 'rel', 'title'],
}

export function renderMarkdown(raw: string): string {
  if (!raw) return ''

  // 0. Extract callout blocks (block-level HTML from WYSIWYG editor) before any processing.
  const calloutSlots: string[] = []
  const raw0 = raw.replace(
    /<div\s+class="kb-callout"\s+data-callout="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g,
    (_m, type, content) => {
      const c = CALLOUT_STYLES[type] ?? CALLOUT_STYLES.info
      const cleanText = content.replace(/<p>([\s\S]*?)<\/p>/g, '$1\n').replace(/<[^>]+>/g, '').trim()
      const idx = calloutSlots.length
      calloutSlots.push(
        `<div class="md-callout" style="background:${c.bg};border-left-color:${c.border};color:${c.text}">`
        + `<span class="md-callout-icon">${c.icon}</span>`
        + `<span class="md-callout-text">${cleanText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`
        + `</div>`
      )
      return `\x00CALLOUT${idx}\x00`
    }
  )

  // 1. Extract trusted inline style spans (color/font-size from WYSIWYG) before HTML-escaping.
  const spanSlots: string[] = []
  const raw1 = raw0.replace(
    /<span\s+style="([^"]*)">((?:[^<])*)<\/span>/g,
    (_m, style, text) => {
      const safeStyle = style.split(';')
        .map((p: string) => p.trim())
        .filter((p: string) => /^(color|font-size)\s*:/.test(p))
        .join('; ')
      if (!safeStyle) return text
      const idx = spanSlots.length
      spanSlots.push(
        `<span style="${safeStyle}">${text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`
      )
      return `\x00SPAN${idx}\x00`
    }
  )

  // 2. Extract images BEFORE HTML-escaping so src URLs survive intact.
  // Unresolved `inline:` markers (upload failed at post time) render nothing —
  // a broken-image icon is worse than no image.
  // Markers are padded with newlines: the serializer can glue an image to the
  // following heading on one line, which would break block parsing.
  const imgSlots: string[] = []
  const src0 = raw1.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    if (!/^(\/|data:|https?:)/.test(src)) return ''
    const idx = imgSlots.length
    imgSlots.push(`<img class="md-img" src="${src.replace(/"/g, '%22')}" alt="${alt.replace(/"/g, '&quot;')}" loading="lazy" />`)
    return `\n\x00IMG${idx}\x00\n`
  })

  const lines = src0.split('\n')
  const out: string[] = []
  let inCode = false
  let codeLines: string[] = []

  // List accumulator — flushes when type changes or non-list line appears
  let listTag: 'ul' | 'ol' | null = null
  let listItems: string[] = []

  function flushList() {
    if (!listItems.length) return
    out.push(`<${listTag}>${listItems.join('')}</${listTag}>`)
    listTag = null; listItems = []
  }

  // Table accumulator
  let tableRows: string[][] = []
  let tableHasSep = false

  function flushTable() {
    if (!tableRows.length) return
    const rows = tableRows.map((cells, i) => {
      const tag = i === 0 && tableHasSep ? 'th' : 'td'
      return `<tr>${cells.map(c => `<${tag}>${c}</${tag}>`).join('')}</tr>`
    }).join('')
    out.push(`<div class="md-tablewrap"><table>${rows}</table></div>`)
    tableRows = []; tableHasSep = false
  }

  function flushAll() { flushList(); flushTable() }

  function applyInline(line: string): string {
    return line
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      // bold-italic, bold, italic
      .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // strikethrough
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      // highlight
      .replace(/==(.+?)==/g, '<mark>$1</mark>')
      // inline code
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      // markdown links [text](url) — encode " to prevent attribute injection
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, text, url) =>
        `<a href="${url.replace(/"/g, '%22')}" target="_blank" rel="noopener noreferrer">${text}</a>`)
      // auto-detect bare URLs (skip after " = > to avoid re-wrapping existing anchors)
      .replace(/(^|[^"=>])(https?:\/\/[^\s<>"]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
      // @mention
      .replace(/@([\w぀-鿿]+)/g, '<span class="md-mention">@$1</span>')
  }

  for (const line of lines) {
    // ── Code fence ───────────────────────────────────────────────────────────
    if (line.trim().startsWith('```')) {
      flushAll()
      if (!inCode) { inCode = true; codeLines = [] } else {
        inCode = false
        const esc = codeLines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')
        out.push(`<pre class="md-pre"><code>${esc}</code></pre>`)
      }
      continue
    }
    if (inCode) { codeLines.push(line); continue }

    const l = applyInline(line)

    // ── Image-only line ──────────────────────────────────────────────────────
    if (/^\x00IMG\d+\x00$/.test(l.trim())) {
      flushAll(); out.push(l.trim()); continue
    }

    // ── Headings ─────────────────────────────────────────────────────────────
    if (/^### /.test(l)) { flushAll(); out.push(`<div class="md-h3">${l.slice(4)}</div>`); continue }
    if (/^## /.test(l))  { flushAll(); out.push(`<div class="md-h2">${l.slice(3)}</div>`); continue }
    if (/^# /.test(l))   { flushAll(); out.push(`<div class="md-h1">${l.slice(2)}</div>`); continue }

    // ── Blockquote ───────────────────────────────────────────────────────────
    if (/^&gt; /.test(l)) {
      flushAll()
      out.push(`<div class="md-quote">${l.slice(5)}</div>`)
      continue
    }

    // ── Checked checkbox ─────────────────────────────────────────────────────
    if (/^- \[x\] /i.test(l)) {
      if (listTag === 'ol') flushList()
      listTag = 'ul'
      listItems.push(`<li><span class="md-check">✓</span><span class="md-done">${l.slice(6)}</span></li>`)
      continue
    }

    // ── Unchecked checkbox ───────────────────────────────────────────────────
    if (/^- \[ \] /.test(l)) {
      if (listTag === 'ol') flushList()
      listTag = 'ul'
      listItems.push(`<li><span class="md-uncheck"></span><span class="md-todo">${l.slice(6)}</span></li>`)
      continue
    }

    // ── Bullet list ──────────────────────────────────────────────────────────
    if (/^- /.test(l)) {
      if (listTag === 'ol') flushList()
      listTag = 'ul'
      listItems.push(`<li><span class="md-bullet">•</span><span class="md-t">${l.slice(2)}</span></li>`)
      continue
    }

    // ── Ordered list ─────────────────────────────────────────────────────────
    const olMatch = l.match(/^(\d+)\. (.*)$/)
    if (olMatch) {
      if (listTag === 'ul') flushList()
      listTag = 'ol'
      listItems.push(`<li><span class="md-num">${olMatch[1]}.</span><span class="md-t">${olMatch[2]}</span></li>`)
      continue
    }

    // ── Table row ────────────────────────────────────────────────────────────
    if (/^\|.+\|$/.test(l.trim())) {
      flushList()
      const cells = l.split('|').slice(1, -1).map(c => c.trim())
      if (cells.every(c => /^[-: ]+$/.test(c))) {
        tableHasSep = true  // separator row — first row is header
      } else {
        tableRows.push(cells)
      }
      continue
    }

    // ── Horizontal rule ──────────────────────────────────────────────────────
    if (l.trim() === '---' || l.trim() === '***') {
      flushAll()
      out.push('<hr/>')
      continue
    }

    // ── Blank line ───────────────────────────────────────────────────────────
    if (l.trim() === '') {
      flushAll()
      out.push('<div class="md-sp"></div>')
      continue
    }

    // ── Paragraph ────────────────────────────────────────────────────────────
    flushAll()
    out.push(`<div class="md-p">${l}</div>`)
  }

  flushAll()

  const html = out.join('')
    .replace(/\x00IMG(\d+)\x00/g, (_, i) => imgSlots[parseInt(i)] ?? '')
    .replace(/\x00SPAN(\d+)\x00/g, (_, i) => spanSlots[parseInt(i)] ?? '')
    .replace(/\x00CALLOUT(\d+)\x00/g, (_, i) => calloutSlots[parseInt(i)] ?? '')

  return DOMPurify.sanitize(`<div class="md-body">${html}</div>`, SANITIZE_OPTS)
}

// Strip markdown for plain-text previews (PostCard snippets etc.)
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/==(.+?)==/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,3} /gm, '')
    .replace(/^> /gm, '')
    .replace(/^- \[[ x]\] /gm, '')
    .replace(/^- /gm, '')
    .replace(/^\d+\. /gm, '')
    .replace(/^---$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\|.+\|$/gm, '')
    .trim()
}
