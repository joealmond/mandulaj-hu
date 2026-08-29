-- Likes and comments for mandulaj.hu.
--
-- D1 is SQLite with serialised writes, so `count = count + 1` is atomic and
-- concurrent likes cannot lose updates. Free tier: 5M rows read/day,
-- 100k rows written/day, 5GB — orders of magnitude beyond a personal blog.
--
-- Apply:  npx wrangler d1 migrations apply mandulaj --remote
--         npx wrangler d1 migrations apply mandulaj --local   (dev)

CREATE TABLE IF NOT EXISTS likes (
  slug       TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- One row per (slug, visitor) so a like can be toggled off and a visitor
-- cannot inflate a count by holding down the button. New votes use a salted
-- hash of a signed, random, first-party browser cookie. Legacy IP + User-Agent
-- hashes remain readable during migration but are no longer written as votes.
CREATE TABLE IF NOT EXISTS like_votes (
  slug       TEXT NOT NULL,
  visitor    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (slug, visitor)
);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL,
  parent_id  TEXT,
  name       TEXT NOT NULL,
  -- Stored, never rendered. Lets you reply privately; never shown publicly.
  email      TEXT,
  body       TEXT NOT NULL,
  -- 'visible' by default (post-moderation), 'hidden' once you remove it.
  status     TEXT NOT NULL DEFAULT 'visible',
  -- Your own replies render in the page accent and are labelled.
  is_owner   INTEGER NOT NULL DEFAULT 0,
  -- Lets the author edit or delete their own comment for a short window,
  -- with no account. Random, client-held, never displayed.
  edit_token TEXT,
  visitor    TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_slug    ON comments (slug, status, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent  ON comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_votes_slug       ON like_votes (slug);

-- Sliding-window rate limiting, so a single visitor cannot flood either
-- endpoint. Old rows are pruned opportunistically on write.
CREATE TABLE IF NOT EXISTS rate_limit (
  visitor    TEXT NOT NULL,
  action     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate ON rate_limit (visitor, action, created_at);
