-- Trigram indexes so the feed's ILIKE '%q%' search uses an index scan.
-- pg_trgm handles Japanese substring search fine (no tokenizer needed).
-- If the extension can't be installed (no superuser), search stays
-- sequential-scan — functional, just slower.

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable, skipping search indexes: %', SQLERRM;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_posts_title_trgm   ON posts USING gin (title gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_posts_content_trgm ON posts USING gin (content gin_trgm_ops);
  END IF;
END $$;
