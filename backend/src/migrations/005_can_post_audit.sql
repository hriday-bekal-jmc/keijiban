-- Per-user post permission
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_post BOOLEAN NOT NULL DEFAULT TRUE;

-- Faster audit log lookups
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor   ON audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action  ON audit_log (action, created_at DESC);
