import { describe, expect, it } from "vitest";
import { canonicalEntityName, extractKnowledge, queryEntityNames } from "../../../src/core/extract/knowledge.js";

describe("deterministic knowledge extraction", () => {
  it("extracts all six entity kinds and five typed relations with stable deduplication", () => {
    const text = "Alice works on project Atlas. Alice uses SQLite. Alice decided to use SQLite for storage. " +
      "Alice prefers TypeScript over JavaScript. Project Atlas is blocked by GitHub. Edited src/db.ts";
    const result = extractKnowledge(text);
    expect(new Set(result.entities.map(entity => entity.kind))).toEqual(new Set(["person", "project", "tool", "service", "file", "decision"]));
    expect(result.entities).toContainEqual({ kind: "person", name: "alice" });
    expect(result.entities).toContainEqual({ kind: "file", name: "src/db.ts" });
    expect(new Set(result.relations.map(edge => edge.type))).toEqual(new Set(["works_on", "decided", "prefers", "uses", "blocked_by"]));
    expect(result.relations).toContainEqual({ source: { kind: "project", name: "atlas" }, type: "blocked_by", target: { kind: "service", name: "github" } });
    expect(extractKnowledge(`${text}\n${text}`)).toEqual(result);
    expect(extractKnowledge(text)).toEqual(result);
  });

  it("resolves first person only to a labeled speaker or the session user", () => {
    const result = extractKnowledge("Alice: I use Docker.\nBob: I prefer Python.\nHe uses Redis.");
    expect(result.relations.map(edge => [edge.source.name, edge.type, edge.target.name])).toEqual([
      ["alice", "uses", "docker"], ["bob", "prefers", "python"],
    ]);
    expect(extractKnowledge("Use SQLite").relations[0].source.name).toBe("user");
  });

  it("ignores negated, hypothetical and question relations and redacts secrets", () => {
    const result = extractKnowledge("Alice does not use Docker. Alice never uses Redis. Alice might use Python. Does Alice use SQLite? " +
      "Alice decided to set password=SuperSecret. Alice uses sk-abcdefghijklmnop123456.");
    expect(result.relations).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/SuperSecret|abcdefghijklmnop|redacted/i);
    expect(extractKnowledge("Nothing relevant happened.")).toEqual({ entities: [], relations: [] });
  });

  it("normalizes Unicode and literal query names without substring or case assumptions", () => {
    expect(canonicalEntityName(" `ＡＴＬＡＳ` ")).toBe("atlas");
    const query = queryEntityNames("What is Alice’s preference for VS Code and src/db.ts?");
    expect(query).toContain("alice");
    expect(query).toContain("vs code");
    expect(query).toContain("src/db.ts");
    expect(queryEntityNames("Malice")).not.toContain("alice");
    expect(queryEntityNames("O’Connor's tools")).toContain("o'connor");
  });

  it("shares the summary pipeline's tool and commit cues", () => {
    const graph = extractKnowledge('Ran: npm test\nRan: git commit -m "Use SQLite"\nEdited src/db.ts');
    expect(graph.relations).toContainEqual({ source: { kind: "person", name: "user" }, type: "uses", target: { kind: "tool", name: "npm" } });
    expect(graph.relations.some(edge => edge.type === "decided" && edge.target.kind === "decision")).toBe(true);
    expect(graph.entities).toContainEqual({ kind: "file", name: "src/db.ts" });
  });
});
