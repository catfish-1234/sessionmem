import { describe, expect, it, vi } from "vitest";

// Mock the @anthropic-ai/sdk module before importing the code under test
const mockCreate = vi.fn();

// Track constructor calls manually since vi.fn() arrow mocks aren't constructors
const constructorCalls: Array<Record<string, unknown>> = [];

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
    constructor(opts: Record<string, unknown>) {
      constructorCalls.push(opts);
    }
  }
  return { default: MockAnthropic };
});
import { summarizeWithCloud } from "../../../src/core/summarize/cloudSummarizer.js";
import { DEFAULT_SUMMARIZER_MODEL } from "../../../src/core/config/policyConfig.js";

// Minimal mock of local summarizer so we control its output
vi.mock("../../../src/core/summarize/localSummarizer.js", () => ({
  summarizeLocalSessionEvents: vi.fn().mockResolvedValue({
    summary: "local preprocessed summary text",
    warningCodes: [],
  }),
}));

describe("summarizeWithCloud", () => {
  it("calls Anthropic API with correct model, key, and preprocessed summary", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "compressed cloud summary" }],
    });

    const result = await summarizeWithCloud({
      events: [
        {
          id: "evt-1",
          project_id: "p1",
          session_id: "s1",
          event_index: 0,
          event_type: "user_message",
          payload_json: '{"text":"hello"}',
          created_at: "2026-06-20T00:00:00Z",
        },
      ],
      summaryTokenCap: 300,
      redactionEnabled: true,
      factMode: "summary+facts",
      anthropicApiKey: "sk-test-key-123",
    });

    // Verify Anthropic client was constructed with the API key
    expect(constructorCalls).toContainEqual({ apiKey: "sk-test-key-123" });

    // Verify messages.create was called with correct params
    expect(mockCreate).toHaveBeenCalledWith({
      model: DEFAULT_SUMMARIZER_MODEL,
      max_tokens: 450, // min(floor(summaryTokenCap * 1.5), 8192)
      system: expect.stringContaining("memory compressor"),
      messages: [{ role: "user", content: "local preprocessed summary text" }],
    });

    // Verify return value is the API response text (no [model:...] prefix)
    expect(result.summary).toBe("compressed cloud summary");
    expect(result.summary).not.toMatch(/^\[model:/);
  });

  it("uses custom model when provided", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "custom model response" }],
    });

    await summarizeWithCloud({
      events: [
        {
          id: "evt-2",
          project_id: "p1",
          session_id: "s1",
          event_index: 0,
          event_type: "user_message",
          payload_json: '{"text":"hello"}',
          created_at: "2026-06-20T00:00:00Z",
        },
      ],
      summaryTokenCap: 200,
      redactionEnabled: false,
      factMode: "summary+facts",
      anthropicApiKey: "sk-test-key-456",
      model: "claude-opus-4-20250514",
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-4-20250514",
        max_tokens: 300, // min(floor(summaryTokenCap * 1.5), 8192)
      }),
    );
  });

  it("throws on empty anthropicApiKey", async () => {
    await expect(
      summarizeWithCloud({
        events: [],
        summaryTokenCap: 300,
        redactionEnabled: true,
        factMode: "summary+facts",
        anthropicApiKey: "   ",
      }),
    ).rejects.toThrow("Missing anthropicApiKey");
  });

  it("propagates warning codes from local preprocessor", async () => {
    // Re-mock local summarizer to return warning codes
    const { summarizeLocalSessionEvents } = await import(
      "../../../src/core/summarize/localSummarizer.js"
    );
    vi.mocked(summarizeLocalSessionEvents).mockResolvedValueOnce({
      summary: "summary with warnings",
      warningCodes: ["redaction_applied"],
    });

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "cloud result" }],
    });

    const result = await summarizeWithCloud({
      events: [
        {
          id: "evt-3",
          project_id: "p1",
          session_id: "s1",
          event_index: 0,
          event_type: "user_message",
          payload_json: '{"text":"hello"}',
          created_at: "2026-06-20T00:00:00Z",
        },
      ],
      summaryTokenCap: 300,
      redactionEnabled: true,
      factMode: "summary+facts",
      anthropicApiKey: "sk-test-key-789",
    });

    expect(result.warningCodes).toEqual(["redaction_applied"]);
  });
});
