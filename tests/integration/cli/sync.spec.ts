import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { syncCommand } from "../../../src/cli/commands/sync.js";
import {
  createTeamUserContext,
  withSharedDir,
  type TestCliContext,
} from "../../helpers/cliTestContext.js";

const cleanups: Array<() => void> = [];
const tmpFiles: string[] = [];

function track(ctx: TestCliContext): TestCliContext {
  if (ctx.cleanup) cleanups.push(ctx.cleanup);
  return ctx;
}

function trackDir(d: { sharedPath: string; cleanup: () => void }): string {
  cleanups.push(d.cleanup);
  return d.sharedPath;
}

/** Write a temp policy-config.json and return its path. */
function teamConfig(opts: { enabled: boolean; sharedPath?: string }): string {
  const path = join(tmpdir(), `sessionmem-sync-config-${randomUUID()}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      retentionDays: 90,
      redactionEnabled: false,
      team: { enabled: opts.enabled, ...(opts.sharedPath ? { sharedPath: opts.sharedPath } : {}) },
    }),
    "utf8",
  );
  tmpFiles.push(path);
  return path;
}

async function seed(ctx: TestCliContext, id: string, content: string, importance = 5) {
  await ctx.service.storeMemory({
    memoryId: id,
    projectId: ctx.projectId,
    sessionId: "s1",
    sourceAdapter: "codex",
    kind: "fact",
    content,
    importance,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const c of cleanups.splice(0)) c();
  for (const f of tmpFiles.splice(0)) {
    try {
      unlinkSync(f);
    } catch {
      // ignore
    }
  }
});

describe("sync command (TEAM-01)", () => {
  it("no-ops with a clear message and exit 0 when team mode is disabled (D-13)", async () => {
    const ctx = track(createTeamUserContext({ username: "alice" }));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const configPath = teamConfig({ enabled: false });

    await syncCommand(ctx, { configPath });

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(logs.some((m) => m.includes("Team mode is not enabled"))).toBe(true);
  });

  it("pushes a full snapshot to {sharedPath}/{projectId}/{username}.json and overwrites idempotently (D-03/D-04)", async () => {
    const ctx = track(createTeamUserContext({ username: "alice", projectId: "proj" }));
    await seed(ctx, "a-1", "Alice memory one.");
    await seed(ctx, "a-2", "Alice memory two.");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const sharedPath = trackDir(withSharedDir());
    const configPath = teamConfig({ enabled: true, sharedPath });

    await syncCommand(ctx, { configPath });

    const snapshot = join(sharedPath, "proj", "alice.json");
    expect(existsSync(snapshot)).toBe(true);
    const arr = JSON.parse(readFileSync(snapshot, "utf8"));
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.length).toBe(2);

    // No leftover temp file.
    expect(readdirSync(join(sharedPath, "proj")).some((f) => f.endsWith(".tmp"))).toBe(false);

    // Re-running overwrites (idempotent).
    await syncCommand(ctx, { configPath });
    const arr2 = JSON.parse(readFileSync(snapshot, "utf8"));
    expect(arr2.length).toBe(2);
  });

  it("two-user round-trip: B pulls A's memories and skips its own file (TEAM-01)", async () => {
    const alice = track(createTeamUserContext({ username: "alice", projectId: "proj" }));
    const bob = track(createTeamUserContext({ username: "bob", projectId: "proj" }));
    await seed(alice, "a-1", "Decision from Alice.");
    await seed(bob, "b-1", "Bob's own memory.");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const sharedPath = trackDir(withSharedDir());
    const aliceConfig = teamConfig({ enabled: true, sharedPath });
    const bobConfig = teamConfig({ enabled: true, sharedPath });

    // Alice pushes.
    await syncCommand(alice, { configPath: aliceConfig });
    // Bob syncs: pushes his own, pulls Alice's.
    await syncCommand(bob, { configPath: bobConfig });

    const bobList = await bob.service.listMemories({ projectId: "proj" });
    expect(bobList.ok).toBe(true);
    if (bobList.ok) {
      const ids = bobList.memories.map((m) => m.id);
      expect(ids).toContain("a-1"); // pulled from Alice
      expect(ids).toContain("b-1"); // his own, untouched
      // Bob did NOT re-import his own file as a duplicate (still one b-1).
      expect(ids.filter((id) => id === "b-1").length).toBe(1);
    }

    // Alice's pulled memory carries her authorship in Bob's DB.
    const a1 = bob.db
      .prepare("SELECT author, origin_project_id FROM memories WHERE id = ?")
      .get("a-1") as { author: string; origin_project_id: string | null };
    expect(a1.author).toBe("alice");
  });

  it("prints the exact D-16 summary string", async () => {
    const alice = track(createTeamUserContext({ username: "alice", projectId: "proj" }));
    const bob = track(createTeamUserContext({ username: "bob", projectId: "proj" }));
    await seed(alice, "a-1", "Alice one.");
    await seed(alice, "a-2", "Alice two.");
    await seed(bob, "b-1", "Bob one.");
    vi.spyOn(console, "log").mockImplementation(() => {});

    const sharedPath = trackDir(withSharedDir());
    await syncCommand(alice, { configPath: teamConfig({ enabled: true, sharedPath }) });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await syncCommand(bob, { configPath: teamConfig({ enabled: true, sharedPath }) });

    const logs = logSpy.mock.calls.map((c) => c.join(" "));
    expect(
      logs.some((m) =>
        m.includes("Pushed 1 memories, pulled 2 new + updated 0 from teammates."),
      ),
    ).toBe(true);
  });

  it("exits non-zero on a missing/unwritable shared path (D-03)", async () => {
    const ctx = track(createTeamUserContext({ username: "alice", projectId: "proj" }));
    await seed(ctx, "a-1", "Alice memory.");
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);

    // A shared path nested under a non-existent file (mkdir will fail).
    const badParent = join(tmpdir(), `sessionmem-bad-${randomUUID()}`);
    writeFileSync(badParent, "not a directory", "utf8");
    tmpFiles.push(badParent);
    const sharedPath = join(badParent, "shared"); // parent is a file -> EEXIST/ENOTDIR
    const configPath = teamConfig({ enabled: true, sharedPath });

    await expect(syncCommand(ctx, { configPath })).rejects.toThrow(
      "process.exit called",
    );
    expect(errSpy).toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("skips a corrupt/non-array teammate file without aborting the pull (Pitfall 4)", async () => {
    const alice = track(createTeamUserContext({ username: "alice", projectId: "proj" }));
    const bob = track(createTeamUserContext({ username: "bob", projectId: "proj" }));
    await seed(alice, "a-1", "Valid Alice memory.");
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const sharedPath = trackDir(withSharedDir());
    await syncCommand(alice, { configPath: teamConfig({ enabled: true, sharedPath }) });

    // Drop a truncated file from a third teammate into the project dir.
    const projDir = join(sharedPath, "proj");
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "carol.json"), "[{ truncated", "utf8");
    // And a non-array file from a fourth teammate.
    writeFileSync(join(projDir, "dave.json"), JSON.stringify({ not: "array" }), "utf8");

    await syncCommand(bob, { configPath: teamConfig({ enabled: true, sharedPath }) });

    // Bob still pulled Alice's valid memory despite the two bad files.
    const bobList = await bob.service.listMemories({ projectId: "proj" });
    expect(bobList.ok).toBe(true);
    if (bobList.ok) {
      expect(bobList.memories.map((m) => m.id)).toContain("a-1");
    }
  });
});
