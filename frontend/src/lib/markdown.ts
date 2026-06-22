// Markdown renderer — line-by-line, no external deps, HTML-escaped first.
// Handles: H1–H3, bold/italic/strikethrough/highlight, inline code, code blocks,
// blockquotes, bullet/ordered/checkbox lists (grouped), tables, HR, images,
// markdown links [text](url), auto-detected bare URLs, @mention, color/size spans,
// callout boxes (from WYSIWYG editor).
// Pass `inlineMap` to resolve `inline:ID` markers in composer preview.

const CALLOUT_RENDER_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  info:    { bg: '#D8EAF8', border: '#1E5FA8', text: '#0F3060', icon: 'ℹ️' },
  warning: { bg: '#FDE8D0', border: '#E8732A', text: '#7A2A00', icon: '⚠️' },
  success: { bg: '#D6F0E4', border: '#1A7A48', text: '#0A3A20', icon: '✅' },
  danger:  { bg: '#F8D8D8', border: '#A83030', text: '#5A0000', icon: '🚫' },
}

export function renderMarkdown(raw: string, opts?: { inlineMap?: Map<string, string> }): string {
  if (!raw) return ''

  // 0. Extract callout blocks (block-level HTML from WYSIWYG editor) before any processing.
  const calloutSlots: string[] = []
  const raw0 = raw.replace(
    /<div\s+class="kb-callout"\s+data-callout="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g,
    (_m, type, content) => {
      const c = CALLOUT_RENDER_STYLES[type] ?? CALLOUT_RENDER_STYLES.info
      const cleanText = content.replace(/<p>([\s\S]*?)<\/p>/g, '$1\n').replace(/<[^>]+>/g, '').trim()
      const idx = calloutSlots.length
      calloutSlots.push(
        `<div style="background:${c.bg};border-left:4px solid ${c.border};border-radius:8px;padding:10px 14px;margin:8px 0;color:${c.text};display:flex;gap:8px;align-items:flex-start">`
        + `<span style="flex-shrink:0;font-size:14px">${c.icon}</span>`
        + `<span style="line-height:1.6">${cleanText.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`
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
  const imgSlots: string[] = []
  const src0 = raw1.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    const resolvedSrc = opts?.inlineMap?.get(src.replace(/^inline:/, '')) ?? src
    const safeSrc = /^(\/|data:|https?:)/.test(resolvedSrc) ? resolvedSrc : '#'
    const idx = imgSlots.length
    imgSlots.push(
      `<img src="${safeSrc}" alt="${alt.replace(/"/g, '&quot;')}" `
      + `style="max-width:100%;border-radius:10px;margin:10px 0;display:block;cursor:zoom-in" loading="lazy" />`
    )
    return `\x00IMG${idx}\x00`
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
    out.push(`<${listTag} style="list-style:none;padding:0;margin:4px 0">${listItems.join('')}</${listTag}>`)
    listTag = null; listItems = []
  }

  // Table accumulator
  let tableRows: string[][] = []
  let tableHasSep = false

  function flushTable() {
    if (!tableRows.length) return
    const rows = tableRows.map((cells, i) => {
      const isHdr = i === 0 && tableHasSep
      const tag = isHdr ? 'th' : 'td'
      const bg  = isHdr ? '#F0E8D8' : (i % 2 === 0 ? '#FFFDF7' : '#FAF5EC')
      const fw  = isHdr ? '700' : '400'
      return `<tr>${cells.map(c =>
        `<${tag} style="padding:7px 12px;border:1px solid #E4D4B8;color:#3A2A1A;background:${bg};font-weight:${fw};text-align:left">${c}</${tag}>`
      ).join('')}</tr>`
    }).join('')
    out.push(`<div style="overflow-x:auto;margin:8px 0"><table style="border-collapse:collapse;width:100%;font-size:13px">${rows}</table></div>`)
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
      .replace(/~~(.+?)~~/g, '<s style="color:#A8906E">$1</s>')
      // highlight
      .replace(/==(.+?)==/g, '<mark style="background:#FEF08A;padding:0 2px;border-radius:2px;color:#713F12">$1</mark>')
      // inline code
      .replace(/`([^`]+)`/g, '<code style="background:#F0E8D8;padding:1px 5px;border-radius:4px;font-size:0.88em;font-family:monospace">$1</code>')
      // markdown links [text](url)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#1E5FA8;text-decoration:underline;text-underline-offset:2px">$1</a>')
      // auto-detect bare URLs (skip after " = > to avoid re-wrapping existing anchors)
      .replace(/(^|[^"=>])(https?:\/\/[^\s<>"]+)/g,
        '$1<a href="$2" target="_blank" rel="noopener noreferrer" style="color:#1E5FA8;text-decoration:underline;text-underline-offset:2px">$2</a>')
      // @mention
      .replace(/@([\w぀-鿿]+)/g,
        '<span style="color:#1E5FA8;font-weight:600;background:rgba(30,95,168,0.08);padding:0 3px;border-radius:4px">@$1</span>')
  }

  const LI_BASE = 'display:flex;gap:7px;align-items:flex-start;padding:2px 0'

  for (const line of lines) {
    // ── Code fence ───────────────────────────────────────────────────────────
    if (line.trim().startsWith('```')) {
      flushAll()
      if (!inCode) { inCode = true; codeLines = [] } else {
        inCode = false
        const esc = codeLines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('\n')
        out.push(`<pre style="background:#F4EDDA;border-radius:8px;padding:10px 14px;margin:8px 0;overflow-x:auto;font-size:12px;line-height:1.55;font-family:monospace"><code>${esc}</code></pre>`)
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
    if (/^### /.test(l)) {
      flushAll()
      out.push(`<div style="font-size:13px;font-weight:800;color:#3A2A1A;margin:10px 0 2px;letter-spacing:-0.2px">${l.slice(4)}</div>`)
      continue
    }
    if (/^## /.test(l)) {
      flushAll()
      out.push(`<div style="font-size:15px;font-weight:800;color:#3A2A1A;margin:12px 0 4px;letter-spacing:-0.3px">${l.slice(3)}</div>`)
      continue
    }
    if (/^# /.test(l)) {
      flushAll()
      out.push(`<div style="font-size:17px;font-weight:900;color:#3A2A1A;margin:14px 0 4px;letter-spacing:-0.4px">${l.slice(2)}</div>`)
      continue
    }

    // ── Blockquote ───────────────────────────────────────────────────────────
    if (/^&gt; /.test(l)) {
      flushAll()
      out.push(`<div style="border-left:3px solid #E8732A;padding-left:10px;color:#7A5C30;font-style:italic;margin:4px 0">${l.slice(5)}</div>`)
      continue
    }

    // ── Checked checkbox ─────────────────────────────────────────────────────
    if (/^- \[x\] /i.test(l)) {
      if (listTag === 'ol') flushList()
      listTag = 'ul'
      listItems.push(
        `<li style="${LI_BASE}">`
        + `<span style="display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;background:#16A34A;border-radius:3px;flex-shrink:0;margin-top:2px;color:white;font-size:9px;font-weight:900">✓</span>`
        + `<span style="text-decoration:line-through;color:#A8906E;line-height:1.6">${l.slice(6)}</span></li>`
      )
      continue
    }

    // ── Unchecked checkbox ───────────────────────────────────────────────────
    if (/^- \[ \] /.test(l)) {
      if (listTag === 'ol') flushList()
      listTag = 'ul'
      listItems.push(
        `<li style="${LI_BASE}">`
        + `<span style="display:inline-flex;width:15px;height:15px;border:1.5px solid #C4A87A;border-radius:3px;flex-shrink:0;margin-top:2px"></span>`
        + `<span style="color:#3A2A1A;line-height:1.6">${l.slice(6)}</span></li>`
      )
      continue
    }

    // ── Bullet list ──────────────────────────────────────────────────────────
    if (/^- /.test(l)) {
      if (listTag === 'ol') flushList()
      listTag = 'ul'
      listItems.push(
        `<li style="${LI_BASE}">`
        + `<span style="color:#E8732A;font-weight:900;flex-shrink:0;margin-top:1px;font-size:15px;line-height:1">•</span>`
        + `<span style="line-height:1.6">${l.slice(2)}</span></li>`
      )
      continue
    }

    // ── Ordered list ─────────────────────────────────────────────────────────
    const olMatch = l.match(/^(\d+)\. (.*)$/)
    if (olMatch) {
      if (listTag === 'ul') flushList()
      listTag = 'ol'
      listItems.push(
        `<li style="${LI_BASE}">`
        + `<span style="color:#A8906E;font-weight:700;flex-shrink:0;min-width:20px;text-align:right;margin-top:1px;font-size:12px">${olMatch[1]}.</span>`
        + `<span style="line-height:1.6">${olMatch[2]}</span></li>`
      )
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
      out.push('<hr style="border:none;border-top:1px solid #E4D4B8;margin:10px 0"/>')
      continue
    }

    // ── Blank line ───────────────────────────────────────────────────────────
    if (l.trim() === '') {
      flushAll()
      out.push('<div style="height:6px"></div>')
      continue
    }

    // ── Paragraph ────────────────────────────────────────────────────────────
    flushAll()
    out.push(`<div style="line-height:1.65">${l}</div>`)
  }

  flushAll()

  return out.join('')
    .replace(/\x00IMG(\d+)\x00/g, (_, i) => imgSlots[parseInt(i)] ?? '')
    .replace(/\x00SPAN(\d+)\x00/g, (_, i) => spanSlots[parseInt(i)] ?? '')
    .replace(/\x00CALLOUT(\d+)\x00/g, (_, i) => calloutSlots[parseInt(i)] ?? '')
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
