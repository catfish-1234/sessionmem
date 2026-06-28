import { describe, it, expect, vi, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, rmSync } from "fs";
import { savingsCommand } from "../../../src/cli/commands/savings.js";
import { createTestCliContext } from "../../helpers/cliTestContext.js";
import { insertSessionEvent } from "../../../src/core/storage/sessionEventsRepo.js";
import { randomUUID } from "crypto";

describe("savingsCommand", () => {
  let ctx: Awaited<ReturnType<typeof createTestCliContext>> | undefined;
  let tmpConfigPath: string | undefined;

  afterEach(() => {
    vi.restoreAllMocks();
    ctx?.cleanup?.();
    ctx = undefined;
    if (tmpConfigPath) {
      try {
        rmSync(tmpConfigPath, { force: true });
      } catch {
        /* ignore */
      }
      tmpConfigPath = undefined;
    }
  });

  it("prints savings report with seeded data", async () => {
    ctx = await createTestCliContext();

    // Seed session events with longer payloads than the compressed memories
    for (let i = 0; i < 5; i++) {
      insertSessionEvent(ctx.db, {
        id: randomUUID(),
        project_id: ctx.projectId,
        session_id: "session-1",
        event_index: i,
        event_type: "tool_use",
        payload_json: JSON.stringify({
          tool: "read_file",
          path: `/src/components/UserDashboard-${i}.tsx`,
          content: "A fairly long payload representing raw session event content that would be much larger than compressed memories. ".repeat(5),
        }),
        created_at: new Date().toISOString(),
      });
    }

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    savingsCommand(ctx);

    expect(writeSpy).toHaveBeenCalled();
    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain("sessionmem token savings");
    expect(output).toContain("Storage compression:");
    expect(output).toContain("Raw session tokens:");
    expect(output).toContain("Memory tokens:");
    expect(output).toContain("Tokens saved:");
    expect(output).toContain("Session injection:");
    expect(output).toContain("Overall:");
  });

  it("uses injectionCap from policy config (not the default 450)", async () => {
    ctx = await createTestCliContext();

    // Seed at least one event so sessions > 0 (avgInjectionCost is 0 otherwise).
    insertSessionEvent(ctx.db, {
      id: randomUUID(),
      project_id: ctx.projectId,
      session_id: "session-1",
      event_index: 0,
      event_type: "tool_use",
      payload_json: JSON.stringify({
        tool: "read_file",
        content: "Some session event payload for the injectionCap test.",
      }),
      created_at: new Date().toISOString(),
    });

    // Write a temp policy config with a non-default injectionCap.
    tmpConfigPath = join(tmpdir(), `sessionmem-savings-cfg-${randomUUID()}.json`);
    writeFileSync(
      tmpConfigPath,
      JSON.stringify({ injectionCap: 600 }, null, 2),
      "utf8",
    );

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    // Text mode: assert the avgInjectionCost line reflects the configured 600.
    savingsCommand(ctx, { configPath: tmpConfigPath });

    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toMatch(/Avg injection cost:\s+600 tokens\/session/);
    expect(output).not.toContain("450 tokens/session");
  });

  it("reports the configured injectionCap in --json output", async () => {
    ctx = await createTestCliContext();

    insertSessionEvent(ctx.db, {
      id: randomUUID(),
      project_id: ctx.projectId,
      session_id: "session-1",
      event_index: 0,
      event_type: "tool_use",
      payload_json: JSON.stringify({ tool: "read_file", content: "payload" }),
      created_at: new Date().toISOString(),
    });

    tmpConfigPath = join(tmpdir(), `sessionmem-savings-cfg-${randomUUID()}.json`);
    writeFileSync(
      tmpConfigPath,
      JSON.stringify({ injectionCap: 600 }, null, 2),
      "utf8",
    );

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    savingsCommand(ctx, { json: true, configPath: tmpConfigPath });

    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(output);
    expect(parsed.injectionCap).toBe(600);
  });

  it("shows 'No session data yet' when DB is empty", async () => {
    ctx = await createTestCliContext();

    // Delete all seeded memories so both events and memories are zero
    ctx.db.prepare("DELETE FROM memories WHERE project_id = ?").run(ctx.projectId);

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    savingsCommand(ctx);

    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    expect(output).toContain(
      "No session data yet. Token savings will appear after your first session.",
    );
  });

  it("--json outputs valid JSON with expected keys", async () => {
    ctx = await createTestCliContext();

    // Seed some session events
    insertSessionEvent(ctx.db, {
      id: randomUUID(),
      project_id: ctx.projectId,
      session_id: "session-1",
      event_index: 0,
      event_type: "tool_use",
      payload_json: JSON.stringify({
        tool: "read_file",
        content: "Some session event payload data for the JSON test.",
      }),
      created_at: new Date().toISOString(),
    });

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    savingsCommand(ctx, { json: true });

    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(output);

    expect(parsed).toHaveProperty("memoryTokens");
    expect(parsed).toHaveProperty("rawEventTokens");
    expect(parsed).toHaveProperty("tokensSaved");
    expect(parsed).toHaveProperty("savingsPct");
    expect(parsed).toHaveProperty("sessions");
    expect(parsed).toHaveProperty("injectionCap");
    expect(parsed).toHaveProperty("estimatedReexplainTokens");
    expect(parsed).toHaveProperty("injectionSavings");
    expect(parsed).toHaveProperty("overallSaved");
    expect(parsed).toHaveProperty("overallPct");

    expect(typeof parsed.memoryTokens).toBe("number");
    expect(typeof parsed.rawEventTokens).toBe("number");
  });

  it("numbers are formatted with locale separators in text mode", async () => {
    ctx = await createTestCliContext();

    // Seed many events to create a large enough token count for thousands separators
    for (let i = 0; i < 20; i++) {
      insertSessionEvent(ctx.db, {
        id: randomUUID(),
        project_id: ctx.projectId,
        session_id: `session-${i % 3}`,
        event_index: i,
        event_type: "tool_use",
        payload_json: JSON.stringify({
          tool: "read_file",
          path: `/src/components/Component-${i}.tsx`,
          content: "Repeated content to bulk up the token count for this test case. ".repeat(20),
        }),
        created_at: new Date().toISOString(),
      });
    }

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    savingsCommand(ctx);

    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    // With 20 events each having ~260 tokens of content, raw event tokens should
    // be well over 1,000 and formatted with a comma separator.
    expect(output).toMatch(/\d{1,3},\d{3}/);
  });

  it("percentage calculation is correct", async () => {
    ctx = await createTestCliContext();

    // Seed events so we can verify the savings percentage
    for (let i = 0; i < 3; i++) {
      insertSessionEvent(ctx.db, {
        id: randomUUID(),
        project_id: ctx.projectId,
        session_id: "session-1",
        event_index: i,
        event_type: "tool_use",
        payload_json: JSON.stringify({
          tool: "read_file",
          content: "Event payload content for percentage calculation test. ".repeat(10),
        }),
        created_at: new Date().toISOString(),
      });
    }

    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    savingsCommand(ctx, { json: true });

    const output = writeSpy.mock.calls.map((c) => c[0] as string).join("");
    const parsed = JSON.parse(output);

    // Verify savings percentage: (rawEventTokens - memoryTokens) / rawEventTokens * 100
    const expectedPct =
      parsed.rawEventTokens > 0
        ? ((parsed.rawEventTokens - parsed.memoryTokens) / parsed.rawEventTokens) * 100
        : 0;
    expect(parsed.savingsPct).toBeCloseTo(
      Math.round(expectedPct * 10) / 10,
      1,
    );

    // Verify overallPct
    const estimatedReexplain = parsed.memoryTokens * 3;
    const injSavings = estimatedReexplain - parsed.sessions * parsed.injectionCap;
    const expectedOverall = parsed.tokensSaved + Math.max(0, injSavings);
    const expectedOverallPct =
      parsed.rawEventTokens + estimatedReexplain > 0
        ? (expectedOverall / (parsed.rawEventTokens + estimatedReexplain)) * 100
        : 0;
    expect(parsed.overallPct).toBeCloseTo(
      Math.round(expectedOverallPct * 10) / 10,
      1,
    );
  });
});
