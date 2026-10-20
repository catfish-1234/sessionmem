import { createServer } from "node:http";
import { json, listenHttp, parsePort, sameOrigin } from "../http/server.js";
import type { CliContext } from "../cli/context.js";
import { listProjectKnowledge } from "../core/storage/knowledgeRepo.js";
import { listSupersessions } from "../core/storage/supersessionRepo.js";
import { HTML, CSS, JS } from "./assets.js";

type ViewerContext = Pick<CliContext, "db" | "service" | "projectId">;
export const DEFAULT_UI_PORT = 3777;

export function parseUiPort(value: string | number = DEFAULT_UI_PORT): number {
  return parsePort(value);
}

function integer(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) {
    throw new Error("Invalid pagination parameter");
  }
  return Number(value);
}

/** Fixed read routes only: never dispatch a caller-supplied service method. */
export async function startUiServer(context: ViewerContext, port = DEFAULT_UI_PORT) {
  parseUiPort(port);
  let origin = "";
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      json(response, 405, { error: "Read-only viewer: method not allowed" });
      return;
    }
    // Block DNS rebinding and cross-origin browser reads of the unauthenticated store.
    if (!sameOrigin(request, origin)) {
      json(response, 403, { error: "Local origin required" });
      return;
    }
    try {
      const url = new URL(request.url ?? "/", origin);
      if (url.origin !== origin) {
        json(response, 403, { error: "Local origin required" });
        return;
      }
      const assets: Record<string, [string, string]> = {
        "/": ["text/html", HTML], "/style.css": ["text/css", CSS], "/app.js": ["text/javascript", JS],
      };
      const asset = Object.hasOwn(assets, url.pathname) ? assets[url.pathname] : undefined;
      if (asset) {
        response.writeHead(200, { "Content-Type": `${asset[0]}; charset=utf-8` });
        response.end(request.method === "HEAD" ? undefined : asset[1]);
        return;
      }
      const params = url.searchParams;
      const projectId = params.get("project") ?? context.projectId;
      if (!projectId || projectId.length > 2000) throw new Error("Invalid project ID");
      switch (url.pathname) {
        case "/api/projects": {
          const projects = context.db.prepare(`SELECT project_id AS id, COUNT(*) AS count
            FROM memories GROUP BY project_id ORDER BY project_id`).all();
          json(response, 200, { defaultProjectId: context.projectId, projects });
          break;
        }
        case "/api/memories": {
          const query = params.get("q")?.trim();
          const limit = integer(params.get("limit"), 50, 100);
          if (!limit) throw new Error("Limit must be at least 1");
          if (query) {
            if (query.length > 1000) throw new Error("Query must be at most 1000 characters");
            const result = await context.service.call("retrieveMemories", {
              projectId, query, limit, mode: "on-demand", depth: "default",
              includeHistory: params.get("history") === "true",
            });
            if (!result.ok) {
              json(response, 400, { error: result.error.message });
              break;
            }
            json(response, 200, { memories: result.memories, total: result.total });
          } else {
            const offset = integer(params.get("offset"), 0, Number.MAX_SAFE_INTEGER);
            const memories = context.db.prepare(`SELECT id, kind, content, importance, author,
              created_at AS createdAt, updated_at AS updatedAt, expires_at AS expiresAt
              FROM memories WHERE project_id = ? ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
              .all(projectId, limit, offset);
            const { total } = context.db.prepare("SELECT COUNT(*) AS total FROM memories WHERE project_id = ?")
              .get(projectId) as { total: number };
            json(response, 200, { memories, total });
          }
          break;
        }
        case "/api/memory": {
          const id = params.get("id");
          if (!id || id.length > 200) throw new Error("Invalid memory ID");
          const result = await context.service.call("getMemory", { projectId, memoryId: id });
          json(response, result.ok ? 200 : 404, result.ok ? { memory: result.memory } : { error: result.error.message });
          break;
        }
        case "/api/entities":
          json(response, 200, listProjectKnowledge(context.db, projectId));
          break;
        case "/api/history":
          json(response, 200, { links: listSupersessions(context.db, projectId) });
          break;
        default:
          json(response, 404, { error: "Not found" });
      }
    } catch (error) {
      // Do not send database paths or raw SQL errors to the browser.
      const invalid = error instanceof Error && /^(Invalid |Limit must|Query must)/.test(error.message);
      json(response, invalid ? 400 : 500, { error: invalid ? error.message : "Unable to read the memory store" });
    }
  });
  const listener = await listenHttp(server, port);
  origin = new URL(listener.url).origin;
  return listener;
}
