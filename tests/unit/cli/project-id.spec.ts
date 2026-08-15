import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  deriveProjectId,
  findProjectRoot,
  projectIdFromCwd,
} from "../../../src/cli/projectId.js";

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

describe("findProjectRoot / deriveProjectId (repository anchoring)", () => {
  function makeRepo(): { root: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), "sessionmem-repo-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    // realpathSync: macOS resolves /var -> /private/var, and process.cwd()
    // reports the resolved form, so compare against that.
    return {
      root: realpathSync(root),
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  }

  it("finds the repository root from a nested directory", () => {
    const repo = makeRepo();
    try {
      expect(findProjectRoot(join(repo.root, "src", "deep"))).toBe(repo.root);
    } finally {
      repo.cleanup();
    }
  });

  it("returns null outside any repository", () => {
    const bare = mkdtempSync(join(tmpdir(), "sessionmem-bare-"));
    try {
      // tmpdir() itself is not inside a repo on CI runners.
      expect(findProjectRoot(bare)).toBe(null);
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("anchors a linked worktree, where .git is a file", () => {
    // realpathSync up front, as makeRepo does: on macOS tmpdir() reports
    // /var/... while the real path is /private/var/.... findProjectRoot
    // normalizes but deliberately does NOT resolve symlinks — in production its
    // input is process.cwd(), which is already resolved — so the test has to
    // feed it a resolved path rather than compare a resolved result.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "sessionmem-wt-")));
    try {
      writeFileSync(join(root, ".git"), "gitdir: /elsewhere/.git/worktrees/wt");
      mkdirSync(join(root, "pkg"), { recursive: true });
      expect(findProjectRoot(join(root, "pkg"))).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("gives every directory in one repository the SAME project id", () => {
    const repo = makeRepo();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      const atRoot = deriveProjectId();
      process.chdir(join(repo.root, "src", "deep"));
      const atDepth = deriveProjectId();

      // Running a command from a subdirectory used to hash that subdirectory,
      // landing on a different bucket — so `sessionmem stats` typed in src/
      // reported an empty store while the hooks were writing at the root.
      expect(atDepth).toBe(atRoot);
    } finally {
      process.chdir(originalCwd);
      repo.cleanup();
    }
  });

  it("keeps the id unchanged for a session already running at the repo root", () => {
    const repo = makeRepo();
    const originalCwd = process.cwd();
    try {
      process.chdir(repo.root);
      // Backward compatibility: the root IS the cwd, so anchoring must produce
      // byte-identical ids to the pre-anchoring derivation and existing stores
      // stay reachable.
      expect(deriveProjectId()).toBe(projectIdFromCwd(repo.root));
    } finally {
      process.chdir(originalCwd);
      repo.cleanup();
    }
  });

  it("still honors the SESSIONMEM_PROJECT_ID override", () => {
    const previous = process.env.SESSIONMEM_PROJECT_ID;
    process.env.SESSIONMEM_PROJECT_ID = "pinned-id";
    try {
      expect(deriveProjectId()).toBe("pinned-id");
    } finally {
      if (previous === undefined) delete process.env.SESSIONMEM_PROJECT_ID;
      else process.env.SESSIONMEM_PROJECT_ID = previous;
    }
  });
});
