CREATE TABLE IF NOT EXISTS memory_entities (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'project', 'tool', 'service', 'file', 'decision')),
  name TEXT NOT NULL,
  PRIMARY KEY (memory_id, kind, name)
);
CREATE INDEX IF NOT EXISTS idx_memory_entities_name ON memory_entities(name, memory_id);

CREATE TABLE IF NOT EXISTS memory_relations (
  memory_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_name TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('works_on', 'decided', 'prefers', 'uses', 'blocked_by')),
  target_kind TEXT NOT NULL,
  target_name TEXT NOT NULL,
  PRIMARY KEY (memory_id, source_kind, source_name, relation, target_kind, target_name),
  FOREIGN KEY (memory_id, source_kind, source_name) REFERENCES memory_entities(memory_id, kind, name) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (memory_id, target_kind, target_name) REFERENCES memory_entities(memory_id, kind, name) ON DELETE CASCADE ON UPDATE CASCADE
);
