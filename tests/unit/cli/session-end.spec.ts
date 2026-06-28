import { describe, it, expect, vi, afterEach } from "vitest";
import { sessionEndCommand } from "../../../src/cli/commands/sessionEnd.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";

function captureStdout(): { getText: () => string; restore: () => void } {
  let buffer = "";
  const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
    buffer += args.join(" ") + "\n";
  });
  return {
    getText: () => buffer,
    restore: () => spy.mockRestore(),
  };
}

describe("sessionEndCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs the session-end pipeline and prints a brief summary", async () => {
    const ctx = await createTestCliContext();
    const out = captureStdout();
    try {
      // With no ingested session events, handleSessionEnd reports the
      // threshold-skip path but still applies the retention prune.
      await sessionEndCommand(ctx);
    } finally {
      out.restore();
      ctx.cleanup?.();
    }

    const text = out.getText();
    expect(text).toContain("sessionmem:");
    expect(text.toLowerCase()).toContain("retention prune");
  });

  it("stores a summary when enough session events were ingested", async () => {
    const ctx = await createTestCliContext();
    const sessionId = "se-summary-session";

    // Ingest enough events to clear the default minimumEventThreshold (3).
    await ctx.service.ingestSessionEvents({
      projectId: ctx.projectId,
      sessionId,
      events: Array.from({ length: 4 }, (_, i) => ({
        id: `se-evt-${i}`,
        eventIndex: i,
        eventType: "tool_use",
        payloadJson: JSON.stringify({ step: i }),
      })),
    });

    const out = captureStdout();
    try {
      // The CLI derives the sessionId from the env var when no hook payload is
      // present; set it so handleSessionEnd targets the ingested session.
      const prev = process.env.CLAUDE_CODE_SESSION_ID;
      process.env.CLAUDE_CODE_SESSION_ID = sessionId;
      try {
        await sessionEndCommand(ctx);
      } finally {
        if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
        else process.env.CLAUDE_CODE_SESSION_ID = prev;
      }
    } finally {
      out.restore();
    }

    const text = out.getText();
    expect(text).toContain("session summary stored");

    // The summary memory should now exist for the session.
    const list = await ctx.service.listMemories({ projectId: ctx.projectId });
    ctx.cleanup?.();
    expect(list.ok).toBe(true);
    const summaries = list.memories.filter((m) => m.kind === "summary");
    expect(summaries.length).toBeGreaterThanOrEqual(1);
  });
});
