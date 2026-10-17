CREATE TABLE IF NOT EXISTS transcript_checkpoints (
  path TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL
);
