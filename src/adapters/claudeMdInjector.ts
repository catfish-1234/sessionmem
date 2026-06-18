import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";

export const SESSIONMEM_BLOCK_START = "<!-- sessionmem:start -->";
export const SESSIONMEM_BLOCK_END = "<!-- sessionmem:end -->";

const BLOCK_CONTENT = `
## sessionmem — Persistent Memory

sessionmem is an MCP memory layer that persists context across sessions. Use its tools to store important decisions, facts, and context so they're available in future sessions without the user re-explaining.

### When to store memories (storeMemory)
- User makes an architectural or design decision
- You discover a non-obvious project constraint or convention
- A debugging session reveals an important root cause
- User states a preference about how they want things done
- A warning or pitfall is discovered that future sessions should know about

### When to retrieve memories (retrieveMemories)
- At the start of a session or task to check for relevant prior context
- Before making architectural decisions (check if prior decisions exist)
- When the user references something from a previous session
- When working in an area of the codebase that may have stored warnings or decisions

### Memory kinds
- \`decision\` — architectural or design choices (importance: 7-9)
- \`fact\` — project constraints, conventions, patterns (importance: 5-7)
- \`warning\` — pitfalls, gotchas, things that broke before (importance: 8-10)
- \`preference\` — how the user likes things done (importance: 5-7)
- \`summary\` — session summaries (auto-generated, importance: 3-5)

### Other tools
- \`listMemories\` — browse all stored memories for this project
- \`getMemory\` — fetch a specific memory by ID
- \`forgetMemory\` — delete an outdated or incorrect memory
- \`stats\` — check memory count and health

### Guidelines
- Don't store trivial or easily re-derivable information
- Don't retrieve memories every single turn — retrieve at task boundaries
- Keep memory content concise (1-3 sentences)
- Use appropriate importance scores (see kinds above)
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
