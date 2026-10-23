// Rebuild the committed pre-scope SQLite fixture from the original 16 SQL files.
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const target = new URL("tests/fixtures/storage/pre-scopes-v16.db", root);
mkdirSync(new URL("tests/fixtures/storage/", root), { recursive: true });
rmSync(target, { force: true });
const db = new Database(fileURLToPath(target));
db.exec("CREATE TABLE _migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))");
db.transaction(() => {
  const dir = new URL("src/core/schema/migrations/", root);
  for (const name of readdirSync(dir).filter(name => /^0(?:0\d|1[0-6])_.*\.sql$/.test(name)).sort()) {
    db.exec(readFileSync(new URL(name, dir), "utf8"));
    db.prepare("INSERT INTO _migrations VALUES (?, ?)").run(name, "2026-01-01T00:00:00.000Z");
  }
  db.exec(`INSERT INTO session_events(id, project_id, session_id, event_index, event_type, payload_json, created_at)
    VALUES ('event-1', 'p', 's', 0, 'message', '{"text":"Alice uses SQLite."}', '2026-01-01T00:00:00.000Z');
    INSERT INTO memories(id, project_id, session_id, source_adapter, kind, content, normalized_content,
      importance, embedding, embedding_dim, embedding_version, author, access_count, tags, expires_at, created_at, updated_at)
    VALUES ('memory-1', 'p', 's', 'test', 'fact', 'Alice uses SQLite.', 'alice uses sqlite',
      7, '[1,0]', 2, 'fixture-v1', 'fixture-author', 4, '["database"]', '2099-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
    INSERT INTO memories(id, project_id, session_id, source_adapter, kind, content, normalized_content, importance)
      VALUES ('memory-2', 'other', 's', 'test', 'warning', 'Preserve this other project.', 'preserve this other project', 8);
    INSERT INTO memory_entities VALUES ('memory-1', 'person', 'alice'), ('memory-1', 'tool', 'sqlite');
    INSERT INTO memory_relations VALUES ('memory-1', 'person', 'alice', 'uses', 'tool', 'sqlite');
    INSERT INTO memory_feedback(id, memory_id, feedback_type, previous_importance, new_importance)
      VALUES ('feedback-1', 'memory-1', 'manual', 5, 7);
    INSERT INTO summarization_failures(id, project_id, session_id, source_adapter, reason, attempt_count, last_error_json)
      VALUES ('failure-1', 'p', 's', 'test', 'fixture', 1, '{"message":"preserve"}');
    INSERT INTO transcript_checkpoints VALUES ('/fixture/session.jsonl', 'checkpoint-v1');
    INSERT INTO semantic_embeddings VALUES ('memory-1', 'fixture-model', 2, X'0000803F00000000');
    INSERT INTO memory_claims VALUES ('memory-1', 'claim-1', 'person', 'alice', 'uses', 'tool', 'sqlite',
      '', '', 0, 0, '', '2026-01-01T00:00:00.000Z');`);
})();
db.close();
