import type { CSSProperties } from 'react'
import { postTypeMeta } from '../lib/postMeta'
import type { ThumbnailPattern } from '../types'

// Matches the 'クリーム' seed preset, so a post with no design chosen looks
// exactly like the old hard-coded fallback.
export const DEFAULT_BACKGROUND = 'linear-gradient(145deg, #FAF5EC 0%, #FDE8D0 100%)'
export const DEFAULT_TEXT_COLOR = '#3A2A1A'

/** Pattern overlays are built here rather than stored as CSS: the admin picks
 *  from a fixed set, so nothing user-supplied reaches a style attribute.
 *  They inherit `color`, so each pattern adapts to the preset's text colour. */
function patternStyle(pattern: ThumbnailPattern | null | undefined): CSSProperties | null {
  switch (pattern) {
    case 'dots':
      return { backgroundImage: 'radial-gradient(currentColor 1.5px, transparent 1.5px)', backgroundSize: '16px 16px', opacity: 0.18 }
    case 'grid':
      return {
        backgroundImage: 'linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)',
        backgroundSize: '24px 24px',
        opacity: 0.13,
      }
    case 'rays':
      return { backgroundImage: 'repeating-conic-gradient(from 0deg, currentColor 0deg 5deg, transparent 5deg 20deg)', opacity: 0.1 }
    default:
      return null
  }
}

interface PostThumbnailProps {
  title: string
  background?: string | null
  textColor?: string | null
  pattern?: ThumbnailPattern | null
  emoji?: string | null
  postType?: string
  tags?: string[]
  height?: number
  /** Smaller type scale for composer previews and dense grids */
  compact?: boolean
  /** Off on the detail page, where the band is decorative and the page
   *  already renders the title as a real heading. */
  showTitle?: boolean
  onClick?: () => void
  style?: CSSProperties
}

export default function PostThumbnail({
  title,
  background,
  textColor,
  pattern,
  emoji,
  postType,
  tags = [],
  height = 240,
  compact = false,
  showTitle = true,
  onClick,
  style,
}: PostThumbnailProps) {
  const color = textColor || DEFAULT_TEXT_COLOR
  const overlay = patternStyle(pattern)
  const badge = postType ? postTypeMeta(postType) : null

  return (
    <div
      onClick={onClick}
      className="relative w-full flex items-center justify-center overflow-hidden"
      style={{
        minHeight: height,
        background: background || DEFAULT_BACKGROUND,
        color,
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {overlay && <div className="absolute inset-0 pointer-events-none" style={overlay} aria-hidden />}

      <div className="relative text-center px-6 py-7" style={{ maxWidth: 320 }}>
        {emoji && (
          <div style={{ fontSize: compact ? 26 : 44, lineHeight: 1, marginBottom: compact ? 4 : 10 }}>
            {emoji}
          </div>
        )}

        {badge && showTitle && (
          <span
            className="inline-block text-[9.5px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap"
            style={{ background: badge.bg, color: badge.color }}
          >
            {badge.label}
          </span>
        )}

        {showTitle && <h3
          className="font-extrabold leading-snug"
          style={{
            fontSize: compact ? 14 : 21,
            letterSpacing: '-0.4px',
            marginTop: badge ? (compact ? 8 : 14) : 0,
            marginBottom: compact ? 0 : 10,
            // Keeps light text legible on the lighter end of a gradient
            textShadow: color.toUpperCase() === '#3A2A1A' ? undefined : '0 1px 12px rgba(0,0,0,0.22)',
            display: '-webkit-box',
            WebkitLineClamp: compact ? 2 : 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {title || '（タイトル）'}
        </h3>}

        {showTitle && !compact && tags.length > 0 && (
          <div className="text-[12.5px] font-semibold" style={{ opacity: 0.82 }}>
            {tags.slice(0, 3).map(t => `#${t}`).join('  ')}
          </div>
        )}
      </div>
    </div>
  )
}
