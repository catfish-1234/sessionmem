-- Existing records remain unlabelled; never infer historical context at upgrade.
ALTER TABLE memories ADD COLUMN scope TEXT;
ALTER TABLE memory_entities ADD COLUMN scope TEXT;

CREATE TABLE sessions (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  scope TEXT,
  PRIMARY KEY (project_id, session_id)
);
INSERT INTO sessions (project_id, session_id)
  SELECT project_id, session_id FROM session_events
  UNION SELECT project_id, session_id FROM memories;

-- Leading scope avoids changing project-only candidate scans.
CREATE INDEX idx_memories_scope_project ON memories(scope, project_id);
CREATE INDEX idx_entities_scope_name ON memory_entities(scope, name, memory_id);
CREATE INDEX idx_sessions_scope ON sessions(scope, project_id);

CREATE TRIGGER events_register_session AFTER INSERT ON session_events BEGIN
  INSERT INTO sessions(project_id, session_id) VALUES (NEW.project_id, NEW.session_id)
    ON CONFLICT(project_id, session_id) DO NOTHING;
END;

CREATE TRIGGER memories_insert_scope AFTER INSERT ON memories BEGIN
  INSERT INTO sessions(project_id, session_id, scope)
    VALUES (NEW.project_id, NEW.session_id, NEW.scope)
    ON CONFLICT(project_id, session_id) DO NOTHING;
END;
CREATE TRIGGER memories_update_scope AFTER UPDATE OF scope ON memories BEGIN
  UPDATE memory_entities SET scope = NEW.scope WHERE memory_id = NEW.id;
  INSERT INTO sessions(project_id, session_id, scope)
    VALUES (NEW.project_id, NEW.session_id, NEW.scope)
    ON CONFLICT(project_id, session_id) DO NOTHING;
END;
CREATE TRIGGER entities_inherit_scope AFTER INSERT ON memory_entities BEGIN
  UPDATE memory_entities SET scope = (SELECT scope FROM memories WHERE id = NEW.memory_id)
    WHERE memory_id = NEW.memory_id AND kind = NEW.kind AND name = NEW.name;
END;
