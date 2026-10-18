import BetterSqlite3, { type Database } from "better-sqlite3";
import type { Dirent } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createdAt, object, unsupported, type JsonObject, type Transcript } from "./types.js";

export function cursorUserDirectory(platform = process.platform): string {
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Cursor", "User");
  if (platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Cursor", "User");
  return join(homedir(), ".config", "Cursor", "User");
}

async function fileStamp(path: string): Promise<string | undefined> {
  try {
    const info = await stat(path, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Never give SQLite a connection to the source, including its WAL/SHM files. */
async function snapshot<T>(path: string, read: (db: Database) => T): Promise<T> {
  const temp = await mkdtemp(join(tmpdir(), "sessionmem-cursor-"));
  try {
    const target = join(temp, "state.vscdb");
    // Copy the WAL too: immutable connections to a live database ignore it and
    // would silently miss recently committed messages. Detect checkpoints and
    // concurrent writes during the copy, then retry on a later sweep if busy.
    const suffixes = ["", "-wal", "-journal"];
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await Promise.all(suffixes.map(suffix => fileStamp(path + suffix)));
      if (!before[0]) throw new Error(`Cursor database disappeared: ${path}`);
      try {
        for (const [index, suffix] of suffixes.entries()) {
          await rm(target + suffix, { force: true });
          if (before[index]) await copyFile(path + suffix, target + suffix);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      const after = await Promise.all(suffixes.map(suffix => fileStamp(path + suffix)));
      if (JSON.stringify(before) !== JSON.stringify(after)) continue;
      let db: Database | undefined;
      try {
        // better-sqlite3 normally compiles with SQLITE_USE_URI=0. Try immutable
        // only on a copy without sidecars; otherwise use a read-only temp copy
        // where SQLite can reconstruct its private WAL index safely.
        if (!before[1] && !before[2]) {
          try { db = new BetterSqlite3(`${pathToFileURL(target).href}?mode=ro&immutable=1`, { readonly: true, fileMustExist: true }); }
          catch { /* URI opens are unavailable in the bundled SQLite build. */ }
        }
        db ??= new BetterSqlite3(target, { readonly: true, fileMustExist: true, timeout: 0 });
        return read(db);
      } finally { db?.close(); }
    }
    throw new Error("Cursor database changed while copying; will retry");
  } finally { await rm(temp, { recursive: true, force: true }); }
}

function json(value: unknown, label: string): unknown {
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") unsupported("cursor", `${label} is not JSON text`);
  try { return JSON.parse(value); }
  catch { unsupported("cursor", `invalid JSON in ${label}`); }
}

function requireTable(db: Database, table: "ItemTable" | "cursorDiskKV"): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!["key", "value"].every(name => columns.some(column => column.name === name))) {
    unsupported("cursor", `missing ${table} table or key/value columns`);
  }
}

function item(db: Database, key: string): unknown {
  const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as { value: unknown } | undefined;
  return row ? json(row.value, key) : undefined;
}

function workspacePath(value: unknown): string | undefined {
  const uri = object(value);
  if (typeof uri?.fsPath === "string" && isAbsolute(uri.fsPath)) return uri.fsPath;
  if (typeof value === "string" && isAbsolute(value)) return value;
  if (typeof value === "string" && value.startsWith("file:")) {
    try { return fileURLToPath(value); }
    catch { return undefined; }
  }
  // URI components are used in some workspaceIdentifier entries.
  if (uri?.scheme === "file" && typeof uri.path === "string") {
    try { return fileURLToPath(`file://${typeof uri.authority === "string" ? uri.authority : ""}${uri.path}`); }
    catch { return undefined; }
  }
  return undefined;
}

function composers(value: unknown, key: string): JsonObject[] {
  const entries = Array.isArray(value) ? value : object(value)?.allComposers;
  if (!Array.isArray(entries)) unsupported("cursor", `${key} needs an array of composers`);
  return entries.map(entry => {
    const composer = object(entry);
    if (!composer || typeof composer.composerId !== "string" || !composer.composerId.trim() || composer.composerId.length > 200) {
      unsupported("cursor", `invalid composerId in ${key}`);
    }
    return composer;
  });
}

/** Resolve a User directory or a global/workspace state.vscdb override. */
export async function cursorDatabasePath(directory: string): Promise<string | undefined> {
  try {
    if ((await stat(directory)).isFile()) {
      if (basename(dirname(dirname(directory))) === "workspaceStorage") {
        return join(dirname(dirname(dirname(directory))), "globalStorage", "state.vscdb");
      }
      return directory;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const path = join(directory, "globalStorage", "state.vscdb");
  return await fileStamp(path) ? path : undefined;
}

function parseBubble(value: unknown, id: string): { role: string; text: string; timestamp?: string } | undefined {
  const bubble = object(json(value, `bubble ${id}`));
  if (!bubble) unsupported("cursor", `invalid bubble ${id}`);
  // Cursor uses 1=user and 2=assistant. Tool, system and internal bubbles are
  // not conversation messages. Never stringify code, tool results or context.
  const role = bubble.type === 1 || bubble.type === "user" ? "user"
    : bubble.type === 2 || bubble.type === "assistant" ? "assistant" : undefined;
  if (!role) {
    if (bubble.type === undefined) unsupported("cursor", `missing message type in bubble ${id}`);
    return undefined;
  }
  if (bubble.text === undefined || bubble.text === null) return undefined;
  if (typeof bubble.text !== "string") unsupported("cursor", `invalid text in bubble ${id}`);
  if (!bubble.text.trim()) return undefined;
  const timestamp = typeof bubble.createdAt === "number" && Number.isFinite(bubble.createdAt)
    ? new Date(bubble.createdAt).toISOString() : createdAt(bubble.createdAt);
  return { role, text: bubble.text.slice(0, 4000), timestamp };
}

export async function readCursorTranscripts(path: string): Promise<Transcript[]> {
  const global = await snapshot(path, db => {
    requireTable(db, "cursorDiskKV");
    // Older layouts only need ItemTable in the workspace databases.
    const hasHeadersTable = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'").get();
    if (hasHeadersTable) requireTable(db, "ItemTable");
    const headers = hasHeadersTable ? item(db, "composer.composerHeaders") : undefined;
    // Materialize only the relevant rows, one value at a time. Large tool and
    // code fields are discarded immediately rather than retained in memory.
    const metadata = new Map<string, JsonObject>();
    const bubbles = new Map<string, { id: string; message: ReturnType<typeof parseBubble> }[]>();
    for (const row of db.prepare("SELECT key, value FROM cursorDiskKV WHERE key GLOB 'composerData:*' OR key GLOB 'bubbleId:*' ORDER BY key").iterate() as Iterable<{ key: string; value: unknown }>) {
      if (row.key.startsWith("composerData:")) {
        const data = object(json(row.value, row.key));
        if (!data) unsupported("cursor", `invalid ${row.key}`);
        metadata.set(row.key.slice("composerData:".length), data);
      } else {
        const parts = row.key.split(":");
        if (parts.length !== 3 || !parts[1] || !parts[2]) unsupported("cursor", `invalid bubble key ${row.key}`);
        const entries = bubbles.get(parts[1]) ?? [];
        entries.push({ id: parts[2], message: parseBubble(row.value, parts[2]) });
        bubbles.set(parts[1], entries);
      }
    }
    return { headers, metadata, bubbles };
  });

  const index = new Map<string, string>();
  const add = (composer: JsonObject, cwd: string | undefined) => {
    const id = composer.composerId as string;
    if (!cwd) unsupported("cursor", `missing workspace path for composer ${id}`);
    if (index.has(id) && resolve(index.get(id)!) !== resolve(cwd)) unsupported("cursor", `conflicting workspaces for composer ${id}`);
    index.set(id, cwd);
  };
  let foundIndex = global.headers !== undefined;
  if (foundIndex) {
    for (const composer of composers(global.headers, "composer.composerHeaders")) {
      add(composer, workspacePath(object(composer.workspaceIdentifier)?.uri));
    }
  }
  const workspaces = join(dirname(dirname(path)), "workspaceStorage");
  let directories: Dirent[];
  try { directories = await readdir(workspaces, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    directories = [];
  }
  for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const workspace = join(workspaces, entry.name);
    const database = join(workspace, "state.vscdb");
    if (!await fileStamp(database)) continue;
    const legacy = await snapshot(database, db => {
      requireTable(db, "ItemTable");
      return item(db, "composer.composerData");
    });
    if (legacy === undefined) continue;
    foundIndex = true;
    const entries = composers(legacy, "composer.composerData");
    if (!entries.length) continue;
    let info: JsonObject | undefined;
    try { info = object(json(await readFile(join(workspace, "workspace.json"), "utf8"), "workspace.json")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") unsupported("cursor", "missing workspace.json for composer index");
      throw error;
    }
    for (const composer of entries) {
      // Current central headers take precedence over stale workspace indexes.
      if (!index.has(composer.composerId as string)) add(composer, workspacePath(info?.folder ?? info?.workspace));
    }
  }
  if (!foundIndex) unsupported("cursor", "missing composer.composerHeaders and workspace composer.composerData indexes");

  const transcripts: Transcript[] = [];
  for (const [sessionId, cwd] of index) {
    const metadata = global.metadata.get(sessionId);
    if (!metadata) unsupported("cursor", `missing composerData:${sessionId}`);
    const headers = metadata.fullConversationHeadersOnly ?? metadata.conversation;
    if (headers !== undefined && !Array.isArray(headers)) unsupported("cursor", `invalid conversation headers for ${sessionId}`);
    const order = new Map<string, number>();
    const entries = global.bubbles.get(sessionId) ?? [];
    const bubbleIds = new Set(entries.map(bubble => bubble.id));
    for (const [position, raw] of (Array.isArray(headers) ? headers : []).entries()) {
      const header = object(raw);
      if (typeof header?.bubbleId !== "string") unsupported("cursor", `invalid conversation header for ${sessionId}`);
      order.set(header.bubbleId, position);
      if (!bubbleIds.has(header.bubbleId)) {
        unsupported("cursor", `missing bubbleId:${sessionId}:${header.bubbleId}`);
      }
    }
    entries.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity)
      || (a.message?.timestamp ?? "").localeCompare(b.message?.timestamp ?? "") || a.id.localeCompare(b.id));
    transcripts.push({ host: "cursor", cwd, sessionId, malformed: false,
      events: entries.flatMap(({ id, message }) => message ? [{
        id: `bubble-${id}`, eventType: `message:${message.role}`, payloadJson: JSON.stringify({ text: message.text }), createdAt: message.timestamp,
      }] : []),
    });
  }
  return transcripts;
}
