import { describe, expect, it } from "vitest";
import { projectIdFromCwd } from "../../../src/cli/projectId.js";

describe("projectIdFromCwd (HIGH-3: collision-resistant project ids)", () => {
  it("includes a human-readable basename prefix", () => {
    const id = projectIdFromCwd("/home/user/projects/my-app");
    expect(id.startsWith("my-app-")).toBe(true);
  });

  it("is stable for the same path", () => {
    const a = projectIdFromCwd("/home/user/projects/my-app");
    const b = projectIdFromCwd("/home/user/projects/my-app");
    expect(a).toBe(b);
  });

  it("distinguishes two projects that share a basename but differ in path", () => {
    const a = projectIdFromCwd("/home/user/a/api");
    const b = projectIdFromCwd("/home/user/b/api");
    expect(a).not.toBe(b);
    // Both keep the readable prefix; only the path hash differs.
    expect(a.startsWith("api-")).toBe(true);
    expect(b.startsWith("api-")).toBe(true);
  });

  it("normalizes Windows-style separators to the same id as POSIX", () => {
    const win = projectIdFromCwd("C:\\Users\\kavis\\my-app");
    const posix = projectIdFromCwd("C:/Users/kavis/my-app");
    expect(win).toBe(posix);
  });

  it("falls back to a 'default' prefix for a root-like path", () => {
    const id = projectIdFromCwd("/");
    expect(id.startsWith("default-")).toBe(true);
  });

  it("produces same id for uppercase and lowercase drive letter on Windows", () => {
    // The drive-letter case fold is gated on process.platform === 'win32', so
    // force win32 to make the assertion platform-independent.
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const id1 = projectIdFromCwd("C:\\Users\\kavis\\myproject");
      const id2 = projectIdFromCwd("c:\\Users\\kavis\\myproject");
      expect(id1).toBe(id2);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
  });

  it("produces same id for UNC paths differing only in host/share case", () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(
      process,
      "platform",
    );
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const id1 = projectIdFromCwd("\\\\Server\\Share\\proj");
      const id2 = projectIdFromCwd("\\\\server\\share\\proj");
      expect(id1).toBe(id2);
    } finally {
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      }
    }
  });
});
