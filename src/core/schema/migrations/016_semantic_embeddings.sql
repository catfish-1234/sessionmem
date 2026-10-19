-- Separate learned vectors from legacy hash embeddings. Models never mix.
CREATE TABLE semantic_embeddings (
  memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE ON UPDATE CASCADE,
  model TEXT NOT NULL,
  dimension INTEGER NOT NULL CHECK (dimension > 0),
  vector BLOB NOT NULL,
  PRIMARY KEY (memory_id, model)
);
CREATE TRIGGER semantic_embeddings_content_update AFTER UPDATE OF content ON memories
WHEN old.content IS NOT new.content BEGIN
  DELETE FROM semantic_embeddings WHERE memory_id = new.id;
END;
