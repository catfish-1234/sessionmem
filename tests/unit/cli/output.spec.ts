import { describe, it, expect } from "vitest";
import { formatTable, formatKeyValue } from "../../../src/cli/output.js";

const sampleRows = [
  {
    id: "mem-0000-0000-0001",
    importance: 8,
    createdAt: "2026-05-24T12:00:00Z",
    content: "User prefers short answers and concise explanations.",
  },
  {
    id: "mem-0000-0000-0002",
    importance: 5,
    createdAt: "2026-05-25T09:30:00Z",
    content: "The project uses TypeScript with NodeNext module resolution.",
  },
];

const sampleMemory = {
  id: "mem-0000-0000-0001",
  content: "User prefers short answers.",
  importance: 8,
  createdAt: "2026-05-24T12:00:00.000Z",
  sessionId: "session-abc",
  projectId: "my-project",
  sourceAdapter: "codex",
};

describe("formatTable", () => {
  it("includes a header line with ID, importance, date, and preview", () => {
    const output = formatTable(sampleRows);
    const lines = output.split("\n");
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("importance");
    expect(lines[0]).toContain("date");
    expect(lines[0]).toContain("preview");
  });

  it("uses ' | ' as column separator", () => {
    const output = formatTable(sampleRows);
    expect(output).toContain(" | ");
  });

  it("renders one data row per memory", () => {
    const output = formatTable(sampleRows);
    const lines = output.split("\n");
    // header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it("truncates content preview to 60 characters", () => {
    const longContent = "A".repeat(100);
    const rows = [{ id: "x", importance: 1, createdAt: "2026-01-01T00:00:00Z", content: longContent }];
    const output = formatTable(rows);
    const previewPart = output.split(" | ")[3];
    expect(previewPart.trimEnd().length).toBeLessThanOrEqual(60);
  });

  it("formats date as YYYY-MM-DD (10 chars)", () => {
    const output = formatTable(sampleRows);
    expect(output).toContain("2026-05-24");
  });

  it("contains no ANSI escape codes", () => {
    const output = formatTable(sampleRows);
    expect(output).not.toMatch(/\x1b\[/);
  });

  it("returns empty string (header only) for empty input", () => {
    const output = formatTable([]);
    expect(output).not.toBe("");
    expect(output.split("\n")).toHaveLength(1);
  });
});

describe("formatKeyValue", () => {
  it("contains 'source_adapter:' label mapping from sourceAdapter field", () => {
    const output = formatKeyValue(sampleMemory);
    expect(output).toContain("source_adapter: codex");
  });

  it("contains 'created_at:' label mapping from createdAt field", () => {
    const output = formatKeyValue(sampleMemory);
    expect(output).toContain("created_at:");
  });

  it("contains 'session_id:' label mapping from sessionId field", () => {
    const output = formatKeyValue(sampleMemory);
    expect(output).toContain("session_id: session-abc");
  });

  it("contains 'project_id:' label mapping from projectId field", () => {
    const output = formatKeyValue(sampleMemory);
    expect(output).toContain("project_id: my-project");
  });

  it("contains all required fields in order", () => {
    const output = formatKeyValue(sampleMemory);
    const lines = output.split("\n");
    expect(lines[0]).toMatch(/^id:/);
    expect(lines[1]).toMatch(/^content:/);
    expect(lines[2]).toMatch(/^importance:/);
    expect(lines[3]).toMatch(/^created_at:/);
    expect(lines[4]).toMatch(/^session_id:/);
    expect(lines[5]).toMatch(/^project_id:/);
    expect(lines[6]).toMatch(/^source_adapter:/);
  });

  it("contains no ANSI escape codes", () => {
    const output = formatKeyValue(sampleMemory);
    expect(output).not.toMatch(/\x1b\[/);
  });
});
