import { describe, expect, it } from "vitest";
import { assertLocalOnlyPolicy } from "../../../src/core/api/localOnlyPolicy.js";
import { createMemoryCoreService } from "../../../src/core/api/memoryCoreService.js";
import { openDb } from "../../../src/core/storage/db.js";

describe("local-only policy", () => {
  it("blocks enabled external providers in local-only mode", () => {
    expect(() =>
      assertLocalOnlyPolicy({
        localOnly: true,
        providers: {
          openai: {
            enabled: true,
            mode: "cloud",
          },
        },
      }),
    ).toThrow(/Local-only mode blocks external providers/);
  });

  it("allows explicit opt-in for external provider usage", () => {
    expect(() =>
      assertLocalOnlyPolicy({
        localOnly: true,
        allowExternalProviders: true,
        providers: {
          openai: {
            enabled: true,
            mode: "cloud",
          },
        },
      }),
    ).not.toThrow();
  });

  it("returns validation envelope from service initialization gate", async () => {
    const db = openDb();
    const createService = () =>
      createMemoryCoreService({
        db,
        policyConfig: {
          localOnly: true,
          providers: {
            anthropic: {
              enabled: true,
              mode: "external",
            },
          },
        },
      });

    expect(createService).toThrow(/Local-only mode blocks external providers/);
    db.close();
  });
});
