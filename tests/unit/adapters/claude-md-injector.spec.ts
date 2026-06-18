import { describe, it, expect } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "fs";
import {
  SESSIONMEM_BLOCK_START,
  SESSIONMEM_BLOCK_END,
  generateClaudeMdBlock,
  injectClaudeMdBlock,
  removeClaudeMdBlock,
  hasClaudeMdBlock,
} from "../../../src/adapters/claudeMdInjector.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sessionmem-claude-md-"));
}

describe("generateClaudeMdBlock", () => {
  it("returns string with start and end sentinels", () => {
    const block = generateClaudeMdBlock();
    expect(block).toContain(SESSIONMEM_BLOCK_START);
    expect(block).toContain(SESSIONMEM_BLOCK_END);
    expect(block.indexOf(SESSIONMEM_BLOCK_START)).toBeLessThan(
      block.indexOf(SESSIONMEM_BLOCK_END),
    );
  });

  it("content includes tool names", () => {
    const block = generateClaudeMdBlock();
    expect(block).toContain("storeMemory");
    expect(block).toContain("retrieveMemories");
    expect(block).toContain("listMemories");
    expect(block).toContain("getMemory");
    expect(block).toContain("forgetMemory");
    expect(block).toContain("stats");
  });
});

describe("injectClaudeMdBlock", () => {
  it("creates file when missing", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");

    expect(existsSync(filePath)).toBe(false);
    const result = injectClaudeMdBlock(filePath);

    expect(result).toBe(true);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain(SESSIONMEM_BLOCK_START);
    expect(content).toContain(SESSIONMEM_BLOCK_END);

    rmSync(dir, { recursive: true, force: true });
  });

  it("appends to existing content", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");
    const existing = "# My Project\n\nSome existing content.\n";
    writeFileSync(filePath, existing, "utf8");

    const result = injectClaudeMdBlock(filePath);

    expect(result).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("# My Project");
    expect(content).toContain("Some existing content.");
    expect(content).toContain(SESSIONMEM_BLOCK_START);
    expect(content).toContain(SESSIONMEM_BLOCK_END);

    rmSync(dir, { recursive: true, force: true });
  });

  it("replaces existing block (idempotent)", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");
    const existing = "# Header\n";
    writeFileSync(filePath, existing, "utf8");

    // Inject once
    injectClaudeMdBlock(filePath);
    const firstContent = readFileSync(filePath, "utf8");

    // Inject again — should replace, not duplicate
    injectClaudeMdBlock(filePath);
    const secondContent = readFileSync(filePath, "utf8");

    expect(secondContent).toBe(firstContent);

    // Verify only one start sentinel
    const startCount = secondContent.split(SESSIONMEM_BLOCK_START).length - 1;
    expect(startCount).toBe(1);

    rmSync(dir, { recursive: true, force: true });
  });

  it("creates parent directory if needed", () => {
    const dir = makeTmpDir();
    const nestedDir = join(dir, "sub", "dir");
    const filePath = join(nestedDir, "CLAUDE.md");

    expect(existsSync(nestedDir)).toBe(false);
    const result = injectClaudeMdBlock(filePath);

    expect(result).toBe(true);
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf8");
    expect(content).toContain(SESSIONMEM_BLOCK_START);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("removeClaudeMdBlock", () => {
  it("removes block from file", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");

    injectClaudeMdBlock(filePath);
    expect(hasClaudeMdBlock(filePath)).toBe(true);

    const result = removeClaudeMdBlock(filePath);
    expect(result).toBe(true);
    expect(hasClaudeMdBlock(filePath)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("preserves surrounding content", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");
    writeFileSync(filePath, "# Before\n", "utf8");
    injectClaudeMdBlock(filePath);

    // Add content after the block
    const withBlock = readFileSync(filePath, "utf8");
    writeFileSync(filePath, withBlock + "\n# After\n", "utf8");

    removeClaudeMdBlock(filePath);

    const content = readFileSync(filePath, "utf8");
    expect(content).toContain("# Before");
    expect(content).toContain("# After");
    expect(content).not.toContain(SESSIONMEM_BLOCK_START);
    expect(content).not.toContain(SESSIONMEM_BLOCK_END);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when no block exists", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");
    writeFileSync(filePath, "# No block here\n", "utf8");

    const result = removeClaudeMdBlock(filePath);
    expect(result).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns true when file is missing", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "nonexistent.md");

    const result = removeClaudeMdBlock(filePath);
    expect(result).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe("hasClaudeMdBlock", () => {
  it("returns true when block exists", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");

    injectClaudeMdBlock(filePath);
    expect(hasClaudeMdBlock(filePath)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when block does not exist", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "CLAUDE.md");
    writeFileSync(filePath, "# No sessionmem here\n", "utf8");

    expect(hasClaudeMdBlock(filePath)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when file does not exist", () => {
    const dir = makeTmpDir();
    const filePath = join(dir, "nonexistent.md");

    expect(hasClaudeMdBlock(filePath)).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });
});
