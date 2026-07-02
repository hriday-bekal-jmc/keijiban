ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chat_webhook_url TEXT;

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS chat_webhook_sent_at TIMESTAMPTZ;
