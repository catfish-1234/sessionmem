import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export const SESSIONMEM_BLOCK_START = "<!-- sessionmem:start -->";
export const SESSIONMEM_BLOCK_END = "<!-- sessionmem:end -->";

const BLOCK_CONTENT = `
## sessionmem — Persistent Memory

sessionmem is an MCP memory layer that persists context across sessions. It is installed and active via the \`sessionmem\` MCP server. Use its tools to recall prior context and to store important decisions, facts, and context so they're available in future sessions without the user re-explaining. The user should never have to ask you to do this — it is part of how you work in this project.

### Startup
On Claude Code, prior context is injected automatically at session start by the
sessionmem \`SessionStart\` hook — you do not need to fetch it yourself. Do NOT
call \`startup_inject_memories\` on Claude Code: the hook already provides the
injection, so calling the tool would duplicate the context (it is not even
registered on Claude Code for this reason). If you do NOT see a "Relevant prior
context" block at the start of the session AND the \`startup_inject_memories\`
tool is available (e.g. the hook is not installed, or you are on a host without
hook support), call it once before any task work, or call \`retrieveMemories\`
with the current task as the query. Never inject twice if context was already
provided.

### Session event ingestion (auto-ingest path)
The \`PostToolUse\` hook installed by sessionmem automatically captures Bash, Edit,
Write, and MultiEdit tool uses as session events. These are summarized by the
\`SessionEnd\` hook into a durable memory — no manual action required. To ingest
additional context (e.g. key decisions made mid-session that weren't captured as
tool use), call \`ingestSessionEvents\` at task boundaries with a description of
what was accomplished.

### When to store memories explicitly (storeMemory / batchStoreMemory)
- User makes an architectural or design decision
- You discover a non-obvious project constraint or convention
- A debugging session reveals an important root cause
- User states a preference about how they want things done
- A warning or pitfall is discovered that future sessions should know about

Use \`tags\` to categorize memories for better retrieval (e.g. \`tags: ["auth", "security"]\`).
Use \`expiresAt\` for time-limited context (e.g. a temporary workaround).

### When to retrieve memories mid-session (retrieveMemories)
- Before making architectural decisions (check if prior decisions exist)
- When the user references something from a previous session
- When working in an area of the codebase that may have stored warnings or decisions

### At session end (RECOMMENDED — do this without being asked)
Before the session ends, persist what was accomplished so the next session starts
informed. Store a concise \`summary\` memory (importance 7) of the key outcomes, plus
any new decisions, facts, or warnings. Use \`batchStoreMemory\` to write several at
once. This is what makes context survive across sessions and saves tokens later.

Note: The SessionEnd hook also auto-summarizes captured session events — you only
need to call \`batchStoreMemory\` for decisions and facts NOT already captured.

### Memory kinds
- \`decision\` — architectural or design choices (importance: 7-9)
- \`fact\` — project constraints, conventions, patterns (importance: 5-7)
- \`warning\` — pitfalls, gotchas, things that broke before (importance: 8-10)
- \`preference\` — how the user likes things done (importance: 5-7)
- \`summary\` — session summaries (importance: 7)

### Other tools
- \`listMemories\` — browse all stored memories for this project
- \`getMemory\` — fetch a specific memory by ID
- \`forgetMemory\` — delete an outdated or incorrect memory
- \`batchStoreMemory\` — store multiple memories in one call (use at session end)
- \`ingestSessionEvents\` — push raw session events for auto-summarization
- \`stats\` — check memory count and health

### Guidelines
- Don't store trivial or easily re-derivable information
- Don't retrieve memories every single turn — retrieve at task boundaries
- Keep memory content concise (1-3 sentences) and self-contained
- Use appropriate importance scores (see kinds above)
- Use tags to group related memories (\`tags: ["topic"]\`)
`;

export function generateClaudeMdBlock(): string {
  return `${SESSIONMEM_BLOCK_START}\n${BLOCK_CONTENT}\n${SESSIONMEM_BLOCK_END}`;
}

export function injectClaudeMdBlock(filePath: string): boolean {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let content = "";
    if (existsSync(filePath)) {
      content = readFileSync(filePath, "utf8");
    }

    const block = generateClaudeMdBlock();

    if (hasClaudeMdBlock(filePath)) {
      // Replace existing block
      const startIdx = content.indexOf(SESSIONMEM_BLOCK_START);
      const endIdx = content.indexOf(SESSIONMEM_BLOCK_END) + SESSIONMEM_BLOCK_END.length;
      content = content.slice(0, startIdx) + block + content.slice(endIdx);
    } else {
      // Append to file
      if (content.length > 0 && !content.endsWith("\n")) {
        content += "\n";
      }
      content += "\n" + block + "\n";
    }

    writeFileSync(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Inject the sessionmem guidance block into an arbitrary host-guidance file
 * (CLAUDE.md, AGENTS.md, Windsurf global_rules.md, a Cursor `.mdc` rule, …).
 *
 * The block is the same markdown for every host. The only host-specific concern
 * is Cursor's `.mdc` rule format: a newly-created rule file needs an
 * `alwaysApply: true` frontmatter header for Cursor to apply it on every
 * request, so we seed that header before appending the block. Existing files
 * (and all non-`.mdc` targets) are handled exactly like CLAUDE.md.
 */
export function injectGuidanceBlock(filePath: string): boolean {
  try {
    if (filePath.endsWith(".mdc") && !existsSync(filePath)) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(
        filePath,
        "---\ndescription: sessionmem persistent memory guidance\nalwaysApply: true\n---\n",
        "utf8",
      );
    }
  } catch {
    // Best-effort frontmatter seeding; fall through to block injection which
    // creates the file itself if the seeding failed.
  }
  return injectClaudeMdBlock(filePath);
}

export function removeClaudeMdBlock(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) {
      return true;
    }

    const content = readFileSync(filePath, "utf8");
    const startIdx = content.indexOf(SESSIONMEM_BLOCK_START);
    if (startIdx === -1) {
      return true;
    }

    const endIdx = content.indexOf(SESSIONMEM_BLOCK_END);
    if (endIdx === -1) {
      return true;
    }

    const endOfBlock = endIdx + SESSIONMEM_BLOCK_END.length;

    // Remove the block and any trailing newline
    let before = content.slice(0, startIdx);
    let after = content.slice(endOfBlock);

    // Clean up extra blank lines around the removed block
    if (after.startsWith("\n")) {
      after = after.slice(1);
    }
    if (before.endsWith("\n\n")) {
      before = before.slice(0, -1);
    }

    writeFileSync(filePath, before + after, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function hasClaudeMdBlock(filePath: string): boolean {
  try {
    if (!existsSync(filePath)) {
      return false;
    }
    const content = readFileSync(filePath, "utf8");
    return (
      content.includes(SESSIONMEM_BLOCK_START) &&
      content.includes(SESSIONMEM_BLOCK_END)
    );
  } catch {
    return false;
  }
}
