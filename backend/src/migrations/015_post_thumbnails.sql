-- Designed post thumbnails.
--
-- A thumbnail is stored as a *spec* (which preset + an optional emoji), not a
-- rendered image: nothing to generate or upload, it stays crisp at any size,
-- the author can change it later, and editing a preset restyles every post
-- that uses it. `background` holds a CSS gradient/colour and is validated
-- against an allowlist server-side before it is ever stored.

CREATE TABLE IF NOT EXISTS thumbnail_presets (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(60)  NOT NULL UNIQUE,
  background  VARCHAR(400) NOT NULL,
  text_color  CHAR(7)      NOT NULL DEFAULT '#FFFFFF',
  pattern     VARCHAR(10)  NOT NULL DEFAULT 'none'
                CHECK (pattern IN ('none', 'dots', 'grid', 'rays')),
  sort_order  INT          NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS thumbnail_presets_active_idx
  ON thumbnail_presets (is_active, sort_order);

ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_preset_id UUID
  REFERENCES thumbnail_presets(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_emoji VARCHAR(16);

-- Default library. Admins can edit, reorder, deactivate or add to these.
-- 'クリーム' reproduces the previous hard-coded fallback so existing posts
-- look unchanged until an author picks something else.
INSERT INTO thumbnail_presets (name, background, text_color, pattern, sort_order) VALUES
  ('クリーム',     'linear-gradient(145deg, #FAF5EC 0%, #FDE8D0 100%)',                  '#3A2A1A', 'none',  10),
  ('サンセット',   'linear-gradient(135deg, #F5A460 0%, #E8732A 55%, #C0501A 100%)',     '#FFFFFF', 'rays',  20),
  ('オーシャン',   'linear-gradient(135deg, #6FB7EC 0%, #1E5FA8 100%)',                  '#FFFFFF', 'dots',  30),
  ('フォレスト',   'linear-gradient(135deg, #6FCB9A 0%, #1A7A48 100%)',                  '#FFFFFF', 'none',  40),
  ('グレープ',     'linear-gradient(135deg, #B189E0 0%, #6B35A8 100%)',                  '#FFFFFF', 'dots',  50),
  ('ローズ',       'linear-gradient(135deg, #F5A8C6 0%, #C0507A 100%)',                  '#FFFFFF', 'none',  60),
  ('ミッドナイト', 'linear-gradient(135deg, #4A3A2A 0%, #1A1206 100%)',                  '#FFFDF7', 'grid',  70),
  ('ゴールド',     'linear-gradient(135deg, #F0D890 0%, #C9A84C 100%)',                  '#3A2A1A', 'rays',  80),
  ('ミント',       'linear-gradient(135deg, #C8F0E4 0%, #7AC8B4 100%)',                  '#0A3A30', 'none',  90),
  ('サクラ',       'radial-gradient(circle at 30% 20%, #FFE0EC 0%, #F5A8C6 60%, #E07AA0 100%)', '#5A0A28', 'dots', 100)
ON CONFLICT (name) DO NOTHING;
