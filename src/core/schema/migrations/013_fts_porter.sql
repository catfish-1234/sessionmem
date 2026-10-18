-- Rebuild the external-content index with SQLite's offline English stemmer.
-- Existing memory bodies and IDs are unchanged; all rows are backfilled.
DROP TRIGGER IF EXISTS memories_fts_insert;
DROP TRIGGER IF EXISTS memories_fts_delete;
DROP TRIGGER IF EXISTS memories_fts_update;
DROP TABLE memories_fts;

CREATE VIRTUAL TABLE memories_fts USING fts5(
  content,
  normalized_content,
  content='memories',
  content_rowid='rowid',
  tokenize='porter unicode61'
);
INSERT INTO memories_fts(memories_fts) VALUES ('rebuild');

CREATE TRIGGER memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, normalized_content)
    VALUES (new.rowid, new.content, new.normalized_content);
END;

CREATE TRIGGER memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, normalized_content)
    VALUES ('delete', old.rowid, old.content, old.normalized_content);
END;

CREATE TRIGGER memories_fts_update AFTER UPDATE OF content, normalized_content ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, normalized_content)
    VALUES ('delete', old.rowid, old.content, old.normalized_content);
  INSERT INTO memories_fts(rowid, content, normalized_content)
    VALUES (new.rowid, new.content, new.normalized_content);
END;
