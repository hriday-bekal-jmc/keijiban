-- Bookmarks (user → post saves)
CREATE TABLE IF NOT EXISTS bookmarks (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id    UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks (user_id, created_at DESC);

-- Event date and pinning on posts
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS event_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_pinned  BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS pinned_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pinned_by  UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_posts_events ON posts (event_date)
  WHERE event_date IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_posts_pinned ON posts (pinned_at DESC)
  WHERE is_pinned = TRUE AND deleted_at IS NULL;
