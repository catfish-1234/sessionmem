import { describe, it, expect, vi, afterEach } from "vitest";
import { sessionStartCommand } from "../../../src/cli/commands/sessionStart.js";
import {
  createTestCliContext,
  createTeamUserContext,
} from "../../helpers/cliTestContext.js";

function captureStdout(): { getText: () => string; restore: () => void } {
  let buffer = "";
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      buffer += String(chunk);
      return true;
    });
  return {
    getText: () => buffer,
    restore: () => spy.mockRestore(),
  };
}

describe("sessionStartCommand", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a Claude Code SessionStart hook envelope when memories exist", async () => {
    const ctx = await createTestCliContext();
    const out = captureStdout();
    try {
      await sessionStartCommand(ctx);
    } finally {
      out.restore();
      ctx.cleanup?.();
    }

    const text = out.getText();
    expect(text.length).toBeGreaterThan(0);
    const parsed = JSON.parse(text) as {
      hookSpecificOutput?: {
        hookEventName?: string;
        additionalContext?: string;
      };
    };
    expect(parsed.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(parsed.hookSpecificOutput?.additionalContext).toContain(
      "Relevant prior context",
    );
    // The seeded warning memory should surface in the injected context.
    expect(parsed.hookSpecificOutput?.additionalContext).toContain(
      "Never commit secrets",
    );
  });

  it("emits nothing for a project with no memories (clean start)", async () => {
    const ctx = createTeamUserContext({ username: "nobody" });
    const out = captureStdout();
    try {
      await sessionStartCommand(ctx);
    } finally {
      out.restore();
      ctx.cleanup?.();
    }
    expect(out.getText()).toBe("");
  });

  it("never throws and emits nothing when the service call fails", async () => {
    const failingCtx = {
      projectId: "broken",
      service: {
        call: async () => ({
          ok: false as const,
          error: { code: "INTERNAL", message: "db gone" },
        }),
      },
    } as never;

    const out = captureStdout();
    try {
      await expect(sessionStartCommand(failingCtx)).resolves.toBeUndefined();
    } finally {
      out.restore();
    }
    expect(out.getText()).toBe("");
  });
});
