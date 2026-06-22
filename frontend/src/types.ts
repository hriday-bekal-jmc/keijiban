export interface User {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: 'member' | 'admin'
  department_id: string
  department_name: string
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
  liked_by_me: boolean
  is_bookmarked_by_me: boolean
  event_date: string | null
  is_pinned: boolean
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
  drive_url: string
  thumbnail_path: string | null
  size_bytes: number
}
