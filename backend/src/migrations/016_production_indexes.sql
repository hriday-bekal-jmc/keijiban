-- Production readiness: indexes for the queries this app actually runs,
-- plus two schema fixes for features that cannot work as shipped.

-- 1. Pre-provisioning an account is impossible while google_id is NOT NULL:
--    POST /api/admin/users omits it, so every call violates the constraint,
--    and auth.ts's "claim a pre-provisioned account" branch (which matches on
--    google_id IS NULL) can therefore never fire.
ALTER TABLE users ALTER COLUMN google_id DROP NOT NULL;

-- 2. The three notification INSERTs all say ON CONFLICT DO NOTHING, but no
--    unique constraint existed for them to conflict against — so a like/unlike
--    /like cycle queued a fresh row and a fresh email every time. This makes
--    the existing clauses do what they already claim to.
DELETE FROM notifications a USING notifications b
  WHERE a.ctid < b.ctid
    AND a.user_id = b.user_id AND a.post_id = b.post_id AND a.type = b.type;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe
  ON notifications (user_id, post_id, type);

-- 3. Retry accounting for the notification worker. Without it a single revoked
--    Chat webhook sits at the head of the ORDER BY created_at window forever
--    and eventually blocks delivery for everyone.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS attempts INT NOT NULL DEFAULT 0;

-- 4. The notification bell: WHERE user_id = $1 ORDER BY created_at DESC.
--    The only existing index is partial (WHERE read_at IS NULL), so once a
--    user has read their notifications this query had no index at all.
CREATE INDEX IF NOT EXISTS notifications_user_created
  ON notifications (user_id, created_at DESC);

-- 5. The worker's queue scan. Partial, so it stays tiny once the queue drains.
CREATE INDEX IF NOT EXISTS notifications_pending
  ON notifications (created_at)
  WHERE emailed_at IS NULL OR chat_webhook_sent_at IS NULL;

-- 6. The Drive proxy looks attachments up by drive_file_id OR thumbnail_path;
--    neither was indexed, so every single image request seq-scanned the table.
CREATE INDEX IF NOT EXISTS attachments_drive_file ON attachments (drive_file_id);
CREATE INDEX IF NOT EXISTS attachments_thumb_path ON attachments (thumbnail_path);

-- 7. top_viewers sorts a post's viewers on every feed row; this turns the
--    LIMIT 3 into an index scan.
CREATE INDEX IF NOT EXISTS post_views_post_viewed
  ON post_views (post_id, viewed_at DESC);

-- 8. Profile stats count by likes.user_id / comments.author_id — neither was
--    indexed (the PKs lead with post_id, which does not help these).
CREATE INDEX IF NOT EXISTS likes_user_created
  ON likes (user_id, created_at);
CREATE INDEX IF NOT EXISTS comments_author_created
  ON comments (author_id, created_at) WHERE deleted_at IS NULL;

-- 9. Drop three indexes no query can use — they only cost write throughput on
--    the hottest tables.
--    idx_posts_search indexes (title || ' ' || content); the feed searches the
--    two columns separately and is served by the trgm indexes from 012.
--    The other two duplicate the leading column of their table's composite PK.
DROP INDEX IF EXISTS idx_posts_search;
DROP INDEX IF EXISTS idx_likes_post;
DROP INDEX IF EXISTS post_views_post_idx;
