-- Two org axes and multi-category posts.
--
-- Branch (支店) is WHERE someone works; department (部署) is WHAT they do.
-- They are independent, so a post can be aimed at a branch, at departments,
-- or at nobody in particular (全社 = company-wide).
--
-- Categories replace the old single post_type. A post has 0..N of them, so
-- they live in a join table rather than a column. post_type is kept for now
-- (see the backfill below) so nothing that still reads it breaks mid-deploy;
-- it is no longer written by the API and can be dropped once the UI is fully
-- migrated.

-- ── Branches ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS branches (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(80) NOT NULL UNIQUE,
  sort_order INT         NOT NULL DEFAULT 0,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS branch_id UUID
  REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS users_branch ON users (branch_id);

-- NULL branch_id on a post means 全社 — visible regardless of the reader's branch.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS branch_id UUID
  REFERENCES branches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS posts_branch ON posts (branch_id);

INSERT INTO branches (name, sort_order) VALUES ('本社', 10)
ON CONFLICT (name) DO NOTHING;

-- ── Categories ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS categories (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(60) NOT NULL UNIQUE,
  color      CHAR(7)     NOT NULL DEFAULT '#1E5FA8',
  sort_order INT         NOT NULL DEFAULT 0,
  is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS categories_active ON categories (is_active, sort_order);

CREATE TABLE IF NOT EXISTS post_categories (
  post_id     UUID NOT NULL REFERENCES posts(id)      ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, category_id)
);
-- Filtering the feed by category scans from the category side.
CREATE INDEX IF NOT EXISTS post_categories_category ON post_categories (category_id);

INSERT INTO categories (name, color, sort_order) VALUES
  ('オフィス関連',   '#1E5FA8', 10),
  ('IT・PC関連',     '#6B35A8', 20),
  ('組織関連',       '#1A7A48', 30),
  ('社内ルール関連', '#B84A0E', 40),
  ('マニュアル関連', '#C0507A', 50),
  ('JMC TIMES',      '#C9A84C', 60),
  ('JMCトピック',    '#2E6818', 70),
  ('その他',         '#7A5C30', 80)
ON CONFLICT (name) DO NOTHING;

-- ── Backfill ──────────────────────────────────────────────────────────────────
-- The five old post types (お知らせ/ナレッジ/日報/雑談/部署) have no honest
-- mapping onto the new list, so existing posts land in その他 rather than being
-- guessed at. Only posts that have no category yet are touched, so re-running
-- this migration never clobbers a real choice.
INSERT INTO post_categories (post_id, category_id)
SELECT p.id, c.id
FROM posts p
CROSS JOIN (SELECT id FROM categories WHERE name = 'その他') c
WHERE NOT EXISTS (SELECT 1 FROM post_categories pc WHERE pc.post_id = p.id)
ON CONFLICT DO NOTHING;

-- Existing users need a branch so branch-scoped posts reach somebody.
UPDATE users SET branch_id = (SELECT id FROM branches WHERE name = '本社')
WHERE branch_id IS NULL;

-- post_type is no longer written; drop the NOT NULL so inserts can omit it.
ALTER TABLE posts ALTER COLUMN post_type DROP NOT NULL;
