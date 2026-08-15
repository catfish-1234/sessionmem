import { describe, expect, it } from "vitest";
import { ingestHookCommand } from "../../../src/cli/commands/ingestHook.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";
import { listSessionEventsBySession } from "../../../src/core/storage/sessionEventsRepo.js";

/**
 * Drive ingestHookCommand the way the PostToolUse hook does: JSON on stdin.
 * `process.stdin.isTTY` is false under vitest, so the command reads the stream;
 * push the payload and end it.
 */
async function runHook(
  ctx: Awaited<ReturnType<typeof createTestCliContext>>,
  payload: Record<string, unknown>,
): Promise<void> {
  const stdin = process.stdin as unknown as {
    isTTY?: boolean;
    setEncoding: () => void;
    on: (event: string, cb: (chunk?: string) => void) => void;
    removeAllListeners: () => void;
    pause: () => void;
  };
  const original = { ...stdin };

  const listeners: Record<string, Array<(chunk?: string) => void>> = {};
  Object.assign(stdin, {
    isTTY: false,
    setEncoding: () => {},
    on: (event: string, cb: (chunk?: string) => void) => {
      (listeners[event] ??= []).push(cb);
      if (event === "end") {
        // Deliver the payload once the command has wired up its listeners.
        setImmediate(() => {
          for (const dataCb of listeners.data ?? []) dataCb(JSON.stringify(payload));
          cb();
        });
      }
    },
    removeAllListeners: () => {},
    pause: () => {},
  });

  try {
    await ingestHookCommand(ctx);
  } finally {
    Object.assign(stdin, original);
  }
}

describe("ingestHookCommand (PostToolUse auto-ingest)", () => {
  it("stores an oversized tool payload as VALID JSON rather than dropping it", async () => {
    const ctx = await createTestCliContext();
    try {
      // A Write of a large file: the serialized payload far exceeds the
      // per-event cap. Truncating the serialized JSON produced an unparseable
      // string, which the payloadJson contract rejected — and the hook's
      // catch-all swallowed the error, losing the event silently.
      await runHook(ctx, {
        tool_name: "Write",
        session_id: "big-session",
        cwd: "/work/proj",
        tool_input: { file_path: "/work/proj/big.ts", content: "x".repeat(50_000) },
      });

      const events = listSessionEventsBySession(ctx.db, ctx.projectId, "big-session");
      expect(events).toHaveLength(1);
      expect(() => JSON.parse(events[0].payload_json)).not.toThrow();
      expect(events[0].payload_json.length).toBeLessThanOrEqual(4001);
      // The human-readable line the summarizer prefers.
      expect(JSON.parse(events[0].payload_json).text).toBe("Wrote /work/proj/big.ts");
    } finally {
      ctx.cleanup?.();
    }
  });

  it("assigns sequential event indices so same-millisecond tool uses all persist", async () => {
    const ctx = await createTestCliContext();
    try {
      // Wall-clock indices collided here: several hook invocations inside one
      // millisecond produced the same event_index, and INSERT OR IGNORE on the
      // UNIQUE key dropped every one but the first.
      for (let i = 0; i < 5; i += 1) {
        await runHook(ctx, {
          tool_name: "Bash",
          session_id: "rapid-session",
          cwd: "/work/proj",
          tool_input: { command: `echo ${i}` },
        });
      }

      const events = listSessionEventsBySession(ctx.db, ctx.projectId, "rapid-session");
      expect(events).toHaveLength(5);
      expect(events.map((e) => e.event_index)).toEqual([0, 1, 2, 3, 4]);
    } finally {
      ctx.cleanup?.();
    }
  });

  it("ignores tools outside the captured set", async () => {
    const ctx = await createTestCliContext();
    try {
      await runHook(ctx, {
        tool_name: "Read",
        session_id: "read-session",
        tool_input: { file_path: "/work/proj/a.ts" },
      });

      expect(
        listSessionEventsBySession(ctx.db, ctx.projectId, "read-session"),
      ).toHaveLength(0);
    } finally {
      ctx.cleanup?.();
    }
  });
});
