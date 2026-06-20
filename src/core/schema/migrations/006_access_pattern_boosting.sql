-- Access-pattern boosting: track how often each memory is included in
-- retrieval output. access_count drives a read-time effective_importance
-- boost without mutating the stored importance score.
ALTER TABLE memories ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN last_accessed TEXT;
