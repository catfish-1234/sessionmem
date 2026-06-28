-- FTS5 full-text search index on memory content for candidate pre-filtering.
-- Using content-sync (external content) mode: the FTS index mirrors the
-- memories table without duplicating storage. Triggers keep it in sync.
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  normalized_content,
  content='memories',
  content_rowid='rowid'
);

-- Populate FTS index from existing rows. Guard against double-backfill: if this
-- migration is re-run on a DB that already has FTS data (e.g. after the
-- _migrations record was lost), re-inserting every row would duplicate the
-- index entries. Only backfill when the FTS table is empty.
INSERT INTO memories_fts(rowid, content, normalized_content)
  SELECT rowid, content, normalized_content FROM memories
  WHERE NOT EXISTS (SELECT 1 FROM memories_fts LIMIT 1);

-- Keep FTS index in sync: INSERT trigger
CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, normalized_content)
    VALUES (new.rowid, new.content, new.normalized_content);
END;

-- Keep FTS index in sync: DELETE trigger
CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, normalized_content)
    VALUES ('delete', old.rowid, old.content, old.normalized_content);
END;

-- Keep FTS index in sync: UPDATE trigger (content or normalized_content changed)
CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE OF content, normalized_content ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, normalized_content)
    VALUES ('delete', old.rowid, old.content, old.normalized_content);
  INSERT INTO memories_fts(rowid, content, normalized_content)
    VALUES (new.rowid, new.content, new.normalized_content);
END;
