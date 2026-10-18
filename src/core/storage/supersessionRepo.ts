import type { Database } from "better-sqlite3";
import { claimKey, claimSlot, extractFactClaims, supersessionReason, type FactClaim, type TimedFactSource } from "../extract/factClaims.js";
import type { EntityKind, RelationKind } from "../extract/knowledge.js";

interface ClaimRow {
  memory_id: string; claim_key: string; source_kind: EntityKind; source_name: string;
  relation: RelationKind; target_kind: EntityKind; target_name: string;
  context: string; attribute: string; negative: number; explicit_change: number; replaces_value: string; observed_at: string;
  expires_at: string | null;
}
const toClaim = (row: ClaimRow): FactClaim => ({ source: { kind: row.source_kind, name: row.source_name },
  type: row.relation, target: { kind: row.target_kind, name: row.target_name }, context: row.context,
  attribute: row.attribute, negative: !!row.negative, explicitChange: !!row.explicit_change, replaces: row.replaces_value });

function prepareStatements(db: Database) {
  return {
    memory: db.prepare("SELECT project_id, created_at FROM memories WHERE id = ?"),
    projectGroups: db.prepare(`SELECT DISTINCT c.source_kind, c.source_name, c.relation FROM memory_claims c
      JOIN memories m ON m.id = c.memory_id WHERE m.project_id = ?`),
    previous: db.prepare("SELECT * FROM memory_claims WHERE memory_id = ?"),
    clear: db.prepare("DELETE FROM memory_claims WHERE memory_id = ? AND claim_key NOT IN (SELECT value FROM json_each(?))"),
    insert: db.prepare(`INSERT INTO memory_claims
      (memory_id, claim_key, source_kind, source_name, relation, target_kind, target_name, context, attribute, negative, explicit_change, replaces_value, observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, claim_key) DO UPDATE SET negative=excluded.negative,
        explicit_change=excluded.explicit_change, replaces_value=excluded.replaces_value, observed_at=excluded.observed_at`),
    select: db.prepare(`SELECT c.*, m.expires_at FROM memory_claims c JOIN memories m ON m.id = c.memory_id
      WHERE m.project_id = ? AND c.source_kind = ? AND c.source_name = ? AND c.relation = ?
      ORDER BY c.observed_at, m.rowid, c.claim_key`),
    remove: db.prepare("DELETE FROM memory_supersessions WHERE supersedes = ? AND claim_key = ?"),
    link: db.prepare(`INSERT INTO memory_supersessions (supersedes, claim_key, superseded_by, new_claim_key, superseded_at, reason)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(supersedes, claim_key) DO UPDATE SET
        superseded_by=excluded.superseded_by, new_claim_key=excluded.new_claim_key, superseded_at=excluded.superseded_at,
        reason=excluded.reason, detected_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE superseded_by <> excluded.superseded_by OR new_claim_key <> excluded.new_claim_key OR superseded_at <> excluded.superseded_at OR reason <> excluded.reason`),
  };
}
const cache = new WeakMap<Database, ReturnType<typeof prepareStatements>>();
function statements(db: Database) {
  let stmts = cache.get(db);
  if (!stmts) { stmts = prepareStatements(db); cache.set(db, stmts); }
  return stmts;
}

/** Reconcile affected entity/relation groups, including out-of-order imports and rewrites. */
export function indexMemorySupersessions(db: Database, memoryId: string, content: string, sources?: TimedFactSource[]): void {
  const stmts = statements(db);
  const memory = stmts.memory.get(memoryId) as { project_id: string; created_at: string };
  const previous = stmts.previous.all(memoryId) as ClaimRow[];
  const finalClaims = new Map<string, FactClaim & { observedAt: string }>();
  for (const source of sources ?? [{ text: content, observedAt: memory.created_at }]) {
    for (const claim of extractFactClaims(source.text)) finalClaims.set(claimSlot(claim), { ...claim, observedAt: source.observedAt });
  }
  const claims = [...finalClaims.values()];
  const groups = new Map<string, [string, string, string]>();
  for (const row of previous) groups.set(JSON.stringify([row.source_kind, row.source_name, row.relation]), [row.source_kind, row.source_name, row.relation]);
  const keys = claims.map(claimKey);
  // Preserve identical claims and links on replays (including detected_at).
  stmts.clear.run(memoryId, JSON.stringify(keys));
  for (const claim of claims) {
    const group: [string, string, string] = [claim.source.kind, claim.source.name, claim.type];
    groups.set(JSON.stringify(group), group);
    stmts.insert.run(memoryId, claimKey(claim), ...group, claim.target.kind, claim.target.name,
      claim.context, claim.attribute, Number(claim.negative), Number(claim.explicitChange), claim.replaces, claim.observedAt);
  }
  reconcileGroups(db, memory.project_id, [...groups.values()]);
}

/** Deleting an intermediate replacement must not revive an older contradicted fact. */
export function reconcileProjectSupersessions(db: Database, projectId: string): void {
  const groups = statements(db).projectGroups.all(projectId) as Array<{ source_kind: string; source_name: string; relation: string }>;
  reconcileGroups(db, projectId, groups.map(row => [row.source_kind, row.source_name, row.relation]));
}

function reconcileGroups(db: Database, projectId: string, groups: [string, string, string][]): void {
  const stmts = statements(db);
  for (const group of groups) {
    const rows = stmts.select.all(projectId, ...group) as ClaimRow[];
    for (let i = 0; i < rows.length; i++) {
      const older = rows[i];
      let found = false;
      for (let j = i + 1; j < rows.length; j++) {
        const newer = rows[j];
        if (older.memory_id === newer.memory_id || (older.expires_at && older.expires_at <= newer.observed_at)
          || (newer.expires_at && newer.expires_at <= newer.observed_at)) continue;
        const reason = supersessionReason(toClaim(older), toClaim(newer));
        if (!reason) continue;
        stmts.link.run(older.memory_id, older.claim_key, newer.memory_id, newer.claim_key, newer.observed_at, reason);
        found = true;
        break;
      }
      if (!found) stmts.remove.run(older.memory_id, older.claim_key);
    }
  }
}

export interface SupersessionLink {
  supersedes: string; supersededBy: string; supersededAt: string; detectedAt: string;
  reason: string; entity: string; relation: string; oldValue: string; newValue: string; fullySuperseded: boolean;
}
export function listSupersessions(db: Database, projectId: string): SupersessionLink[] {
  return db.prepare(`SELECT s.supersedes, s.superseded_by AS supersededBy, s.superseded_at AS supersededAt,
    s.detected_at AS detectedAt, s.reason, c.source_name AS entity, c.relation,
    CASE WHEN c.negative THEN 'not ' ELSE '' END || c.target_name AS oldValue,
    CASE WHEN n.negative THEN 'not ' ELSE '' END || n.target_name AS newValue,
    EXISTS (SELECT 1 FROM superseded_memories f WHERE f.memory_id = s.supersedes) AS fullySuperseded
    FROM memory_supersessions s JOIN memories m ON m.id = s.supersedes
    JOIN memory_claims c ON c.memory_id = s.supersedes AND c.claim_key = s.claim_key
    JOIN memory_claims n ON n.memory_id = s.superseded_by AND n.claim_key = s.new_claim_key
    WHERE m.project_id = ? ORDER BY s.superseded_at, s.supersedes, s.superseded_by, s.claim_key`)
    .all(projectId).map(row => ({ ...row as SupersessionLink, fullySuperseded: !!(row as SupersessionLink).fullySuperseded }));
}
