import type { Database, Statement } from "better-sqlite3";
import { extractKnowledge, queryEntityNames, type EntityKind, type Knowledge, type RelationKind } from "../extract/knowledge.js";

const cache = new WeakMap<Database, { clear: Statement; entity: Statement; relation: Statement; overlap: Statement }>();
function statements(db: Database) {
  let result = cache.get(db);
  if (result) return result;
  result = {
    clear: db.prepare("DELETE FROM memory_entities WHERE memory_id = ?"),
    entity: db.prepare("INSERT INTO memory_entities (memory_id, kind, name) VALUES (?, ?, ?)"),
    relation: db.prepare(`INSERT INTO memory_relations
      (memory_id, source_kind, source_name, relation, target_kind, target_name) VALUES (?, ?, ?, ?, ?, ?)`),
    overlap: db.prepare(`SELECT DISTINCT e.memory_id, e.name FROM memory_entities e
      JOIN memories m ON m.id = e.memory_id
      WHERE m.project_id = ? AND (m.expires_at IS NULL OR m.expires_at > ?)
        AND e.name IN (SELECT value FROM json_each(?))`),
  };
  cache.set(db, result);
  return result;
}

/** Replace, never append: replays, redaction, import and summary upserts stay safe. */
export function replaceMemoryKnowledge(db: Database, memoryId: string, knowledge: Knowledge): void {
  const stmts = statements(db);
  db.transaction(() => {
    stmts.clear.run(memoryId);
    for (const entity of knowledge.entities) stmts.entity.run(memoryId, entity.kind, entity.name);
    for (const edge of knowledge.relations) stmts.relation.run(memoryId,
      edge.source.kind, edge.source.name, edge.type, edge.target.kind, edge.target.name);
  })();
}

export function indexMemoryKnowledge(db: Database, memoryId: string, content: string): void {
  replaceMemoryKnowledge(db, memoryId, extractKnowledge(content));
}

export function entityOverlap(db: Database, projectId: string, query: string, now: Date): Map<string, number> {
  const rows = statements(db).overlap.all(projectId, now.toISOString(), JSON.stringify(queryEntityNames(query))) as Array<{ memory_id: string; name: string }>;
  const queryNames = new Set(rows.map(row => row.name));
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.memory_id, (counts.get(row.memory_id) ?? 0) + 1);
  return new Map([...counts].map(([id, count]) => [id, count / queryNames.size]));
}

export interface ProjectEntity { kind: EntityKind; name: string; memoryIds: string[] }
export interface ProjectRelation {
  sourceKind: EntityKind; sourceName: string; relation: RelationKind;
  targetKind: EntityKind; targetName: string; memoryIds: string[];
}

export function listProjectKnowledge(db: Database, projectId: string, now = new Date()): {
  entities: ProjectEntity[]; relations: ProjectRelation[];
} {
  const entities = db.prepare(`SELECT e.kind, e.name, e.memory_id FROM memory_entities e
    JOIN memories m ON m.id = e.memory_id WHERE m.project_id = ?
    AND (m.expires_at IS NULL OR m.expires_at > ?) ORDER BY e.kind, e.name, e.memory_id`)
    .all(projectId, now.toISOString()) as Array<{ kind: EntityKind; name: string; memory_id: string }>;
  const relations = db.prepare(`SELECT r.* FROM memory_relations r JOIN memories m ON m.id = r.memory_id
    WHERE m.project_id = ? AND (m.expires_at IS NULL OR m.expires_at > ?)
    ORDER BY source_kind, source_name, relation, target_kind, target_name, r.memory_id`)
    .all(projectId, now.toISOString()) as Array<{ memory_id: string; source_kind: EntityKind;
      source_name: string; relation: RelationKind; target_kind: EntityKind; target_name: string }>;
  const nodes = new Map<string, ProjectEntity>();
  const edges = new Map<string, ProjectRelation>();
  for (const row of entities) {
    const key = JSON.stringify([row.kind, row.name]);
    const node = nodes.get(key) ?? { kind: row.kind, name: row.name, memoryIds: [] };
    node.memoryIds.push(row.memory_id);
    nodes.set(key, node);
  }
  for (const row of relations) {
    const key = JSON.stringify([row.source_kind, row.source_name, row.relation, row.target_kind, row.target_name]);
    const edge = edges.get(key) ?? { sourceKind: row.source_kind, sourceName: row.source_name,
      relation: row.relation, targetKind: row.target_kind, targetName: row.target_name, memoryIds: [] };
    edge.memoryIds.push(row.memory_id);
    edges.set(key, edge);
  }
  return { entities: [...nodes.values()], relations: [...edges.values()] };
}
