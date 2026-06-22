-- Add actor_id and type to notifications
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type     VARCHAR(30) NOT NULL DEFAULT 'NEW_POST';
