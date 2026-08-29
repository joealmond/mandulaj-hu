-- Private, per-comment capability used by the Telegram moderation link.
-- Existing comments remain valid; only new comments receive a token.
ALTER TABLE comments ADD COLUMN moderation_token TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_comments_moderation_token
  ON comments (moderation_token);
