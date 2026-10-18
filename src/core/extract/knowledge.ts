import { applyRedaction } from "../summarize/redaction.js";

export type EntityKind = "person" | "project" | "tool" | "service" | "file" | "decision";
export type RelationKind = "works_on" | "decided" | "prefers" | "uses" | "blocked_by";
export interface Entity { kind: EntityKind; name: string }
export interface Relation { source: Entity; type: RelationKind; target: Entity }
export interface Knowledge { entities: Entity[]; relations: Relation[] }

// Deliberately small vocabulary. Unknown names require an explicit contextual
// cue; capitalized sentence starters alone are not evidence of a person/tool.
const TOOLS = ["SQLite", "PostgreSQL", "Postgres", "MySQL", "Redis", "Docker", "Git",
  "Python", "TypeScript", "JavaScript", "Rust", "Node.js", "npm", "pnpm", "yarn",
  "Vitest", "Jest", "React", "Vite", "Terraform", "Kubernetes", "VS Code", "Claude Code"];
const SERVICES = ["GitHub", "GitLab", "Slack", "AWS", "S3", "Azure", "Google Cloud",
  "OpenAI", "Anthropic", "Supabase", "Vercel", "Firebase"];
const LABELS = new Set(["actions", "decisions", "outcomes", "facts", "decision", "summary",
  "image caption", "ran", "edited", "created", "read", "updated", "tool", "user", "assistant"]);
const FILE_PATTERN = /(?:\.{0,2}\/)?[\p{L}\p{N}_@-]+(?:\/[\p{L}\p{N}_.@-]+)*\.(?:[cm]?[jt]sx?|py|rs|go|java|jsonl?|ya?ml|toml|md|sql|sh|css|html|txt|env|lock)\b/giu;
const key = (entity: Entity) => `${entity.kind}:${entity.name}`;

export function canonicalEntityName(name: string): string {
  return name.normalize("NFKC").toLowerCase().replace(/[`"“”]/g, "")
    .replace(/’/g, "'").replace(/'s\b/g, "").replace(/\s+/g, " ").trim()
    .replace(/^[\s'.,:;!?]+|[\s'.,:;!?]+$/g, "");
}

/** Offline, order-stable rules. No inferred coreference beyond I/we and a speaker. */
export function extractKnowledge(content: string): Knowledge {
  // Derived tables must never resurrect secrets, including during legacy backfill.
  const text = applyRedaction(content, { redactionEnabled: true }).text.normalize("NFKC");
  const entities = new Map<string, Entity>();
  const relations = new Map<string, Relation>();
  function add(kind: EntityKind, raw: string): Entity | undefined {
    const name = canonicalEntityName(raw);
    if (!name || name.length > 160 || /redacted|[\n{}<>]/i.test(name)) return;
    const entity = { kind, name };
    entities.set(key(entity), entity);
    return entity;
  }
  function classify(raw: string, fallback: EntityKind): Entity | undefined {
    const name = canonicalEntityName(raw);
    const known = [...entities.values()].find(entity => entity.name === name);
    if (known) return known;
    if (new RegExp(`^(?:${FILE_PATTERN.source})$`, "iu").test(name)) return add("file", name);
    const label = /^(person|project|tool|service|file)\s+(.+)$/i.exec(name);
    return label ? add(label[1] as EntityKind, label[2]) : add(fallback, name);
  }
  for (const [kind, names] of [["tool", TOOLS], ["service", SERVICES]] as const) {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "iu").test(text)) add(kind, name);
    }
  }
  for (const match of text.matchAll(FILE_PATTERN)) add("file", match[0]);
  // Explicit labels support names outside the vocabulary, including lowercase.
  for (const match of text.matchAll(/\b(person|project|tool|service|file)\s+(`[^`\n]{1,120}`|"[^"\n]{1,120}"|[\p{L}\p{N}_.@/-]+)/giu)) {
    add(match[1].toLowerCase() as EntityKind, match[2]);
  }
  let speaker: Entity | undefined;
  for (const rawLine of text.split(/\n|(?<=[.!?])\s+/)) {
    let line = rawLine.replace(/^\s*(?:-\s*)?(?:\[[^\]]{1,60}\]\s*)?/, "");
    const command = /^Ran:\s*(.+)$/i.exec(line)?.[1];
    if (command) {
      const source = add("person", "user")!;
      const executable = command.split(/\s+/)[0];
      const tool = [...entities.values()].find(entity => entity.kind === "tool" && entity.name === canonicalEntityName(executable));
      if (tool) {
        const edge: Relation = { source, type: "uses", target: tool };
        relations.set(`${key(source)}:uses:${key(tool)}`, edge);
      }
      // The existing local summarizer treats git commits as durable decisions.
      if (/^git\s+commit\b/i.test(command)) {
        const target = add("decision", command);
        if (target) relations.set(`${key(source)}:decided:${key(target)}`, { source, type: "decided", target });
      }
      continue;
    }
    const prefix = /^([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*){0,2}):\s*/u.exec(line);
    if (prefix && !LABELS.has(prefix[1].toLowerCase())) {
      speaker = add("person", prefix[1]);
      line = line.slice(prefix[0].length);
    } else if (prefix) {
      line = line.slice(prefix[0].length);
    }
    const relation = /\b(works?\s+on|working\s+on|decided(?:\s+to|\s+on)?|prefers?|uses?|using|(?:is\s+)?blocked\s+by)\s+(.+)$/i.exec(line);
    if (!relation) continue;
    const verb = relation[1].toLowerCase();
    const type: RelationKind = verb.startsWith("work") ? "works_on" : verb.startsWith("decided") ? "decided"
      : verb.startsWith("prefer") ? "prefers" : verb.includes("blocked") ? "blocked_by" : "uses";
    let subject = line.slice(0, relation.index).trim().replace(/\s+(?:is|was|am|are)$/i, "");
    // Questions, negation and hypothetical statements are not affirmative edges.
    if (/\?|\b(?:not|never|no longer|might|may|could|should|would|can|does|did)\b|n['’]t\b/i.test(line.slice(0, relation.index))) continue;
    if (/^(?:i|we|he|she|they|user|assistant)?$/i.test(subject)) {
      // Third-person pronouns cannot be resolved safely without a parser.
      if (/^(he|she|they)$/i.test(subject)) continue;
      subject = speaker?.name ?? (/^we$/i.test(subject) ? "team" : "user");
    }
    // Avoid turning arbitrary preceding prose into a named subject.
    if (subject.split(/\s+/).length > 4 || /[,;!?]/.test(subject) || line.endsWith("?")) continue;
    const source = classify(subject, "person");
    let targetText = relation[2].replace(/[.!?]+$/, "").trim();
    if (type !== "decided") targetText = targetText.split(/\s+(?:for|with|because|but|and|instead|over|using|to)\s+/i)[0];
    targetText = targetText.replace(/^(?:the|a|an)\s+/i, "");
    const target = type === "decided" ? add("decision", targetText)
      : classify(targetText, type === "works_on" ? "project" : "tool");
    if (source && target && key(source) !== key(target)) {
      const edge = { source, type, target };
      relations.set(`${key(source)}:${type}:${key(target)}`, edge);
    }
  }
  return { entities: [...entities.values()].sort((a, b) => key(a).localeCompare(key(b))),
    relations: [...relations.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) };
}

/** Literal n-grams also match lowercase questions against known stored names. */
export function queryEntityNames(query: string): string[] {
  const words = canonicalEntityName(query).match(/[\p{L}\p{N}_.@/'-]+/gu) ?? [];
  const names = new Set<string>();
  for (let i = 0; i < Math.min(words.length, 64); i++) {
    for (let length = 1; length <= 8 && i + length <= words.length; length++) {
      names.add(canonicalEntityName(words.slice(i, i + length).join(" ")));
    }
  }
  return [...names];
}
