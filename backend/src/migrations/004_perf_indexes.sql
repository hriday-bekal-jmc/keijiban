-- Performance indexes for correlated count subqueries in the feed query.
-- likes PK is (post_id, user_id) which already supports prefix scans by post_id,
-- but an explicit covering index lets the planner use index-only scans for COUNT(*).
CREATE INDEX IF NOT EXISTS idx_likes_post       ON likes    (post_id);
CREATE INDEX IF NOT EXISTS idx_bookmarks_post   ON bookmarks (post_id, user_id);

-- Author index: needed if we ever add author-filtered feeds or story author lookups.
CREATE INDEX IF NOT EXISTS idx_posts_author     ON posts (author_id, created_at DESC) WHERE deleted_at IS NULL;
