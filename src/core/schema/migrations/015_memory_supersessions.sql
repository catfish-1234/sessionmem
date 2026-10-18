-- Derived claims retain polarity and attribute context absent from migration 014.
CREATE TABLE memory_claims (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  claim_key TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_name TEXT NOT NULL,
  relation TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_name TEXT NOT NULL,
  context TEXT NOT NULL,
  attribute TEXT NOT NULL,
  negative INTEGER NOT NULL CHECK (negative IN (0, 1)),
  explicit_change INTEGER NOT NULL CHECK (explicit_change IN (0, 1)),
  replaces_value TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (memory_id, claim_key)
);
CREATE INDEX idx_memory_claims_subject ON memory_claims(source_kind, source_name, relation, memory_id);

-- supersedes is the old memory; superseded_by is its replacement. One link per
-- invalidated claim permits summaries to keep their independent, current facts.
CREATE TABLE memory_supersessions (
  supersedes TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  superseded_by TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  new_claim_key TEXT NOT NULL,
  superseded_at TEXT NOT NULL,
  detected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reason TEXT NOT NULL CHECK (reason IN ('different_value', 'explicit_negation')),
  PRIMARY KEY (supersedes, claim_key),
  FOREIGN KEY (supersedes, claim_key) REFERENCES memory_claims(memory_id, claim_key) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (superseded_by, new_claim_key) REFERENCES memory_claims(memory_id, claim_key) ON DELETE CASCADE ON UPDATE CASCADE,
  CHECK (supersedes <> superseded_by)
);
CREATE INDEX idx_memory_supersessions_replacement ON memory_supersessions(superseded_by);

-- A memory is fully superseded only when all of its extracted claims changed.
CREATE VIEW superseded_memories AS
SELECT c.memory_id FROM memory_claims c
LEFT JOIN memory_supersessions s ON s.supersedes = c.memory_id AND s.claim_key = c.claim_key
GROUP BY c.memory_id HAVING COUNT(*) = COUNT(s.claim_key);
