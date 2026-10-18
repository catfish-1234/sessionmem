import { mkdirSync, openSync, closeSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Redirect both streams before opening storage so headless startup failures land
 * in the same log as per-file capture failures. Never reads stdin or uses a TTY. */
export function openWatchLog(path?: string): () => void {
  if (!path) return () => {};
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const fd = openSync(absolute, "a", 0o600);
  const stdout = process.stdout.write;
  const stderr = process.stderr.write;
  const write = ((chunk: string | Uint8Array, encodingOrCallback?: BufferEncoding | (() => void), callback?: () => void): boolean => {
    const value = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    writeSync(fd, `${new Date().toISOString()} ${value}`);
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    done?.();
    return true;
  }) as typeof process.stdout.write;
  process.stdout.write = write;
  process.stderr.write = write;
  return () => { process.stdout.write = stdout; process.stderr.write = stderr; closeSync(fd); };
}
