CREATE TABLE IF NOT EXISTS post_views (
  post_id   UUID        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS post_views_post_idx ON post_views(post_id);
