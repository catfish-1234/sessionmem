import { canonicalEntityName, extractKnowledge, type Relation } from "./knowledge.js";
import { applyRedaction } from "../summarize/redaction.js";

export interface FactClaim extends Relation {
  context: string;
  attribute: string;
  negative: boolean;
  explicitChange: boolean;
  replaces: string;
}

const CATEGORIES = [
  ["editor", ["vs code", "vscode", "visual studio code", "neovim", "vim", "emacs", "sublime text", "intellij"]],
  ["language", ["python", "rust", "typescript", "javascript", "java", "go", "ruby"]],
  ["database", ["sqlite", "postgresql", "postgres", "mysql", "mongodb"]],
  ["package manager", ["npm", "pnpm", "yarn", "bun"]],
  ["test runner", ["vitest", "jest", "mocha", "pytest"]],
] as const;
const aliases: Record<string, string> = { vscode: "vs code", "visual studio code": "vs code", postgres: "postgresql" };
const value = (claim: FactClaim) => aliases[claim.target.name] ?? claim.target.name;

export function claimKey(claim: FactClaim): string {
  return JSON.stringify([claim.source.kind, claim.source.name, claim.type,
    claim.target.kind, claim.target.name, claim.context]);
}

export function claimSlot(claim: FactClaim): string {
  return JSON.stringify([claim.source, claim.type, claim.context, claim.attribute || claim.target]);
}

export interface TimedFactSource { text: string; observedAt: string }

/** Small affirmative/negative grammar layered on migration 014's entity rules. */
export function extractFactClaims(content: string): FactClaim[] {
  const text = applyRedaction(content, { redactionEnabled: true }).text.normalize("NFKC");
  const claims = new Map<string, FactClaim>();
  let speaker = "";
  for (let line of text.split(/\n|(?<=[.!?])\s+/)) {
    line = line.replace(/^\s*(?:-\s*)?(?:\[[^\]]{1,60}\]\s*)?/, "").trim();
    const prefix = /^([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,2}):\s*/u.exec(line);
    if (prefix && !/^(actions|decisions|outcomes|facts|summary|user|assistant)$/i.test(prefix[1])) {
      speaker = prefix[1];
      line = line.slice(prefix[0].length);
    }
    // No questions, hypothetical statements, reported quotations or code.
    if (/\?|^[`"“]|```/.test(line) || /\b(?:if|might|may|could|should|would|can|said|says|asked|used to)\b/i.test(line)) continue;
    const negative = /\b(?:not|never|no longer|stopped)\b|n['’]t\b/i.test(line);
    const explicitChange = /\b(?:now|switched|replaced|instead|no longer|stopped)\b/i.test(line);
    const replaced = /\bswitched\s+from\s+(.+?)\s+to\b|\breplaced\s+(.+?)\s+with\b|\binstead\s+of\s+(.+?)[.!]?$/i.exec(line);
    const replaces = canonicalEntityName(replaced?.slice(1).find(Boolean) ?? "").replace(/^(?:tool|service|project)\s+/, "");
    let affirmative = line
      .replace(/\b(?:do|does|did)\s+not\s+|\b(?:don['’]t|doesn['’]t|didn['’]t)\s+|\b(?:never|no longer)\s+/gi, "")
      .replace(/\bstopped\s+using\b/gi, "uses")
      .replace(/\bnot\s+(?=(?:uses?|using|prefers?|works?\s+on|working\s+on|blocked\s+by)\b)/gi, "")
      .replace(/\bswitched\s+(?:from\s+.+?\s+)?to\s+/gi, "uses ")
      .replace(/\breplaced\s+.+?\s+with\s+/gi, "uses ")
      .replace(/\b(?:now|currently)\s+/gi, "")
      .replace(/\s+(?:now|currently|again)[.!]?$/i, ".");
    // Other negation forms are ambiguous; never turn them into positive claims.
    if (/\bnot\b|n['’]t\b/i.test(affirmative)) continue;
    const context = canonicalEntityName(/\b(?:for|as)\s+(.+?)(?:[.!;]|\s+because\b|$)/i.exec(affirmative)?.[1] ?? "")
      .replace(/\b(?:my|our|the|a|an)\s+/g, "");
    affirmative = affirmative.replace(/\s+as\s+.+$/i, "");
    const graph = extractKnowledge(speaker ? `${speaker}: ${affirmative}` : affirmative);
    for (const edge of graph.relations) {
      const category = edge.type === "uses" || edge.type === "prefers"
        ? CATEGORIES.find(([, names]) => (names as readonly string[]).includes(edge.target.name))?.[0] ?? "" : "";
      const claim: FactClaim = { ...edge, context, attribute: category, negative, explicitChange, replaces };
      // Last assertion about the same slot in a session wins, including retraction.
      const slot = claimSlot(claim);
      claims.delete(slot);
      claims.set(slot, claim);
    }
  }
  return [...claims.values()];
}

function contextOverlap(left: string, right: string): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const words = (text: string) => new Set(text.match(/[\p{L}\p{N}]+/gu) ?? []);
  const a = words(left), b = words(right);
  const shared = [...a].filter(word => b.has(word)).length;
  return shared >= 2 && shared / new Set([...a, ...b]).size >= 0.6;
}

export function supersessionReason(older: FactClaim, newer: FactClaim): "different_value" | "explicit_negation" | undefined {
  if (older.source.kind !== newer.source.kind || older.source.name !== newer.source.name || older.type !== newer.type) return;
  if (value(older) === value(newer) && older.target.kind === newer.target.kind) {
    if (older.negative !== newer.negative && (!older.context || !newer.context || contextOverlap(older.context, newer.context))) return "explicit_negation";
    return;
  }
  if (older.negative || newer.negative || older.target.kind !== newer.target.kind) return;
  if (value(older) === (aliases[newer.replaces] ?? newer.replaces)) return "different_value";
  // Shared lexical purpose is a stronger attribute cue than a tool category.
  if (older.context || newer.context) {
    if (contextOverlap(older.context, newer.context)) return "different_value";
    return;
  }
  if (older.attribute && older.attribute === newer.attribute) return "different_value";
  if (newer.explicitChange && older.type === "works_on") return "different_value";
}
