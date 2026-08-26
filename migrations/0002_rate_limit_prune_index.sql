-- Opportunistic pruning filters only by created_at, so the composite lookup
-- index (visitor, action, created_at) cannot help it.
CREATE INDEX IF NOT EXISTS idx_rate_created_at ON rate_limit (created_at);
