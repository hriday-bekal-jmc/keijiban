-- JMC Keijiban — initial schema
-- Run via: npm run migrate

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Departments
CREATE TABLE IF NOT EXISTS departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO departments (name) VALUES
  ('JMC'),
  ('企画推進室'),
  ('保健情報部'),
  ('総務部'),
  ('DX事業推進室'),
  ('美容決済部')
ON CONFLICT (name) DO NOTHING;

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_id            VARCHAR(255) UNIQUE NOT NULL,
  email                VARCHAR(255) UNIQUE NOT NULL,
  department_id        UUID NOT NULL REFERENCES departments(id),
  full_name            VARCHAR(255) NOT NULL,
  avatar_url           TEXT,
  role                 VARCHAR(20) NOT NULL DEFAULT 'member'
                         CHECK (role IN ('member', 'admin')),
  email_notifications  BOOLEAN NOT NULL DEFAULT TRUE,
  in_app_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Posts
CREATE TABLE IF NOT EXISTS posts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id        UUID NOT NULL REFERENCES users(id),
  title            VARCHAR(255) NOT NULL,
  content          TEXT NOT NULL,
  post_type        VARCHAR(30) NOT NULL
                     CHECK (post_type IN ('ANNOUNCEMENT','DEPARTMENT','KNOWLEDGE','DAILY_REPORT','CHAT')),
  visibility_scope VARCHAR(20) NOT NULL
                     CHECK (visibility_scope IN ('COMPANY_WIDE','DEPARTMENT')),
  tags             TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ,
  deleted_by       UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_posts_feed   ON posts (created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_type   ON posts (post_type, created_at DESC)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_tags   ON posts USING GIN (tags)              WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_search ON posts USING GIN ((title || ' ' || content) gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- 4. Visibility junction
CREATE TABLE IF NOT EXISTS post_departments (
  post_id       UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_post_departments_dept ON post_departments (department_id);

-- 5. Attachments (files live in Google Drive; we store metadata only)
CREATE TABLE IF NOT EXISTS attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id        UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  drive_file_id  VARCHAR(100) NOT NULL,
  drive_url      VARCHAR(1000) NOT NULL,
  file_name      VARCHAR(255) NOT NULL,
  mime_type      VARCHAR(150) NOT NULL,
  size_bytes     BIGINT NOT NULL,
  thumbnail_path VARCHAR(500),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments (post_id);

-- 6. Engagement
CREATE TABLE IF NOT EXISTS comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  UUID NOT NULL REFERENCES users(id),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS likes (
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- 7. In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ,
  emailed_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- 8. Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   UUID NOT NULL REFERENCES users(id),
  action     VARCHAR(50) NOT NULL,
  target_id  UUID,
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
