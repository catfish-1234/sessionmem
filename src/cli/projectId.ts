import { createHash } from "node:crypto";

/**
 * Sanitize a raw token to the filename-safe character set used across
 * sessionmem (mirrors localUsername). Any character outside [A-Za-z0-9._-]
 * becomes "_".
 */
function sanitizeToken(raw: string): string {
  return raw.replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * Derive a stable, collision-resistant project id from an absolute working
 * directory.
 *
 * Format: `<basename>-<hash8>` where `hash8` is the first 8 hex chars of the
 * SHA-256 of the FULL absolute path. The human-readable basename keeps the id
 * debuggable; the path hash guarantees two different projects that happen to
 * share a basename (e.g. `~/a/api` and `~/b/api`) get distinct memory buckets
 * instead of silently colliding.
 *
 * The basename-only scheme this replaces partitioned memory purely by the last
 * path segment, so same-named projects in different directories shared one
 * bucket with zero warning.
 */
export function projectIdFromCwd(cwd: string): string {
  // On Windows the same directory can surface with either a lowercase or
  // uppercase drive letter (e.g. `c:\proj` vs `C:\proj`). Lowercase the drive
  // letter before normalizing slashes so both spellings hash to the same id.
  let normalized =
    process.platform === "win32"
      ? cwd.replace(/^[A-Za-z]:[\\/]/, (m) => m.toLowerCase()).replace(/\\/g, "/")
      : cwd.replace(/\\/g, "/");

  // Normalize UNC path host and share (//server/share/...) case-insensitively
  // so `\\Server\Share\proj` and `\\server\share\proj` hash to the same id.
  normalized = normalized.replace(/^(\/\/[^/]+\/[^/]+)/, (m) => m.toLowerCase());
  const parts = normalized.split("/");
  const rawBase = parts[parts.length - 1] || "default";
  const sanitizedBase = sanitizeToken(rawBase);
  const base =
    sanitizedBase === "" || sanitizedBase === "." || sanitizedBase === ".."
      ? "default"
      : sanitizedBase;

  // Hash the normalized absolute path so the id is stable across runs from the
  // same directory but unique per directory.
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

/**
 * Resolve the effective project id: the `SESSIONMEM_PROJECT_ID` env override
 * (operator-controlled test/migration seam; also lets a user pin a legacy
 * basename-only id) wins, otherwise derive from `process.cwd()`.
 */
export function deriveProjectId(): string {
  const envProjectId = process.env.SESSIONMEM_PROJECT_ID;
  if (envProjectId && envProjectId.trim() !== "") {
    // Sanitize the operator-supplied id to prevent path traversal: the id is
    // later joined into filesystem paths (e.g. sync.ts `join(sharedPath,
    // projectId)`), so strip path separators and `..` traversal sequences and
    // bound the length. Fall through to the derived id only if nothing usable
    // remains.
    const sanitized = envProjectId
      .replace(/[/\\]/g, "")
      .replace(/\.\./g, "")
      .slice(0, 128);
    // Guard against empty or "." (current-dir) values, which would be unsafe or
    // meaningless when joined into filesystem paths; fall through to derived id.
    if (sanitized && sanitized !== ".") {
      return sanitized;
    }
  }
  return projectIdFromCwd(process.cwd());
}
