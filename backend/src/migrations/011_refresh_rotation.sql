-- Token-reuse detection: rotated tokens are kept (marked) instead of deleted.
-- Presenting a token rotated >30s ago is a theft signal — all of that user's
-- sessions are revoked. Rotated rows are swept after 1 day by the cleanup job.

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
