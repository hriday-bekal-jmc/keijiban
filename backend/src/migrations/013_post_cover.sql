-- Author-chosen thumbnail: which attachment leads the post's feed-card image
-- grid. NULL = default order (first image attachment).

ALTER TABLE posts ADD COLUMN IF NOT EXISTS cover_attachment_id UUID REFERENCES attachments(id) ON DELETE SET NULL;
