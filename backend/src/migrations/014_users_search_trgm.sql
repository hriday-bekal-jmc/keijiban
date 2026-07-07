-- Trigram indexes so the admin Users tab's ?search= ILIKE query stays fast
-- as headcount grows, instead of always fetching everyone client-side.
-- pg_trgm was already installed in migration 012.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_users_name_trgm  ON users USING gin (full_name gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin (email gin_trgm_ops);
  END IF;
END $$;
