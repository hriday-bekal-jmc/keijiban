export interface User {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: 'member' | 'admin'
  can_post: boolean
  department_id: string
  department_name: string
  /** Where they work, independent of department. null = unassigned. */
  branch_id?: string | null
  branch_name?: string | null
  email_notifications?: boolean
  in_app_notifications?: boolean
  notif_new_post_email?: boolean
  notif_new_post_chat?: boolean
  notif_comment_email?: boolean
  notif_comment_chat?: boolean
  notif_like_email?: boolean
  notif_like_chat?: boolean
  vibe_emoji: string | null
  vibe_label: string | null
}

/** Admin-managed list shared by branches and categories (see managedList.ts). */
export interface Branch {
  id: string
  name: string
  sort_order: number
  is_active: boolean
}

export interface Category extends Branch {
  color: string
}

export type ThumbnailPattern = 'none' | 'dots' | 'grid' | 'rays'

export interface ThumbnailPreset {
  id: string
  name: string
  background: string
  text_color: string
  pattern: ThumbnailPattern
  sort_order: number
  is_active: boolean
}

export interface Post {
  id: string
  title: string
  content: string
  post_type: 'ANNOUNCEMENT' | 'KNOWLEDGE' | 'DAILY_REPORT' | 'CHAT' | 'DEPARTMENT'
  visibility_scope: 'COMPANY_WIDE' | 'DEPARTMENT'
  tags: string[]
  created_at: string
  updated_at: string
  author_id: string
  author_name: string
  author_avatar: string | null
  author_dept: string
  likes_count: number
  comments_count: number
  views_count: number
  top_viewers: Array<{ id: string; avatar_url: string | null }>
  liked_by_me: boolean
  is_bookmarked_by_me: boolean
  /** Server-side read state (post_views); own posts are always true */
  viewed_by_me: boolean
  /** 0..N categories — replaced the old single post_type */
  categories: Array<{ id: string; name: string; color: string }>
  /** null = 全社 (visible to every branch) */
  branch_id: string | null
  branch_name: string | null
  event_date: string | null
  is_pinned: boolean
  cover_attachment_id?: string | null
  // Designed thumbnail: the id/emoji are the author's choice, the thumb_* are
  // joined from the preset so an admin restyling a preset updates every post.
  thumbnail_preset_id?: string | null
  thumbnail_emoji?: string | null
  thumb_background?: string | null
  thumb_text_color?: string | null
  thumb_pattern?: ThumbnailPattern | null
  attachments?: Attachment[]
}

export interface Comment {
  id: string
  content: string
  created_at: string
  author_id: string
  author_name: string
  author_avatar: string | null
  author_vibe_emoji: string | null
  author_vibe_label: string | null
}

export interface Notification {
  id: string
  post_id: string
  type: 'NEW_POST' | 'NEW_COMMENT' | 'LIKE'
  read_at: string | null
  created_at: string
  post_title: string
  post_type: string
  actor_id: string
  actor_name: string
}

export interface Department {
  id: string
  name: string
}

export interface Attachment {
  id: string
  file_name: string
  /** Drive objects are private; read them through the authenticated proxy
   *  (see attachmentUrl) rather than linking to Drive directly. */
  drive_file_id: string
  drive_url: string
  thumbnail_path: string | null
  size_bytes: number
}

/** Authenticated proxy URL for an attachment's full-size file. */
export const attachmentUrl = (a: Pick<Attachment, 'drive_file_id'>, download = false): string =>
  `/api/uploads/${a.drive_file_id}/content${download ? '?download' : ''}`
