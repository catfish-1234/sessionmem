/**
 * Human-readable project memory, for review, onboarding, or committing next to AGENTS.md.
 *
 * The JSON export is the lossless, re-importable format. This one is for people: memories are
 * grouped by kind, most important first, with provenance on each line. Content is untrusted text
 * (teammates sync it, agents write it), so it is rendered inert: HTML is escaped, control and
 * bidi characters are removed, and a line that would open a code fence or a heading is escaped,
 * so one memory cannot restructure or hide the rest of the document.
 */

export interface MarkdownExportOptions {
  projectId: string;
  /** ISO timestamp the document says it was generated at; also the cutoff for expired memories. */
  generatedAt: string;
  /** Leave out memories below this importance (1-10). */
  minImportance?: number;
  /** Keep memories whose expiry has passed. Off by default: expired memories are not recalled. */
  includeExpired?: boolean;
}

/** The fields of an exported memory this renderer reads. */
export interface ExportedMemory {
  id: string;
  kind: string;
  content: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
  author?: string | null;
  tags?: string[] | null;
  expiresAt?: string | null;
  scope?: string | null;
}

const SECTIONS: ReadonlyArray<{ kind: string; title: string }> = [
  { kind: "warning", title: "Warnings" },
  { kind: "decision", title: "Decisions" },
  { kind: "fact", title: "Facts and conventions" },
  { kind: "preference", title: "Preferences" },
  { kind: "summary", title: "Session summaries" },
];

// eslint-disable-next-line no-control-regex -- intentional: strip controls except tab and newline
const UNSAFE = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g;

/** Inline text: one line, HTML-escaped, no layout characters. */
function inline(text: string): string {
  return escapeHtml(text.replace(/[\r\n\t]+/g, " ").replace(UNSAFE, "")).trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Multi-line content as the body of one list item. */
function block(text: string): string {
  const lines = escapeHtml(text.replace(/\r\n?/g, "\n").replace(UNSAFE, "").replace(/\t/g, "  "))
    .split("\n")
    .map((line) => line.trimEnd())
    // A fence or heading marker would end the list and swallow or restructure what follows.
    .map((line) => line.replace(/^(\s*)(`{3,}|~{3,}|#{1,6}(?=\s|$))/, (_, indent: string, marker: string) => `${indent}\\${marker}`));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  return lines.map((line, index) => (index === 0 ? line : line === "" ? "" : `  ${line}`)).join("\n");
}

function provenance(memory: ExportedMemory): string {
  const parts: string[] = [];
  if (memory.author) parts.push(inline(memory.author));
  parts.push(memory.updatedAt.slice(0, 10));
  if (memory.scope) parts.push(`scope: ${inline(memory.scope)}`);
  if (memory.tags && memory.tags.length > 0) parts.push(`tags: ${memory.tags.map(inline).join(", ")}`);
  if (memory.expiresAt) parts.push(`expires ${memory.expiresAt.slice(0, 10)}`);
  parts.push(`id ${inline(memory.id)}`);
  return parts.join(" · ");
}

function byImportanceThenRecency(left: ExportedMemory, right: ExportedMemory): number {
  return right.importance - left.importance
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.id.localeCompare(right.id);
}

export function renderMemoriesMarkdown(memories: ExportedMemory[], options: MarkdownExportOptions): string {
  const minImportance = options.minImportance ?? 1;
  const kept = memories.filter((memory) =>
    memory.importance >= minImportance
    && (options.includeExpired || !memory.expiresAt || memory.expiresAt > options.generatedAt));

  const lines: string[] = [
    `# Project memory: ${inline(options.projectId)}`,
    "",
    `Exported by sessionmem on ${options.generatedAt.slice(0, 10)}. ` +
      `${kept.length} of ${memories.length} ${memories.length === 1 ? "memory" : "memories"} shown` +
      (minImportance > 1 ? `, importance ${minImportance} and above` : "") +
      (options.includeExpired ? "" : ", expired ones left out") +
      ". Grouped by kind, most important first. Secrets were redacted when each memory was stored; " +
      "review this file before sharing it anyway.",
  ];

  const known = new Set(SECTIONS.map((section) => section.kind));
  const groups = [
    ...SECTIONS.map((section) => ({ title: section.title, items: kept.filter((m) => m.kind === section.kind) })),
    { title: "Other context", items: kept.filter((m) => !known.has(m.kind)) },
  ];

  for (const group of groups) {
    if (group.items.length === 0) continue;
    lines.push("", `## ${group.title} (${group.items.length})`, "");
    for (const memory of [...group.items].sort(byImportanceThenRecency)) {
      lines.push(`- **${memory.importance}/10** ${block(memory.content)}`);
      lines.push(`  <sub>${provenance(memory)}</sub>`);
    }
  }

  if (kept.length === 0) lines.push("", "_No memories match these filters._");
  return `${lines.join("\n")}\n`;
}
