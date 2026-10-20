import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { z } from "zod";
import type { CliContext } from "../cli/context.js";
import { DomainError } from "../core/api/errors.js";
import {
  memoryTimelineRequestSchema, searchMemoryIndexRequestSchema, storeMemoryRequestSchema,
} from "../core/api/contracts.js";
import { bindHost, json, listenHttp, parsePort, sameOrigin } from "../http/server.js";

export const DEFAULT_API_PORT = 3778;
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface ApiServerOptions {
  port?: string | number;
  host?: string;
  allowRemote?: boolean;
  token?: string;
}

export function parseApiOptions(options: ApiServerOptions = {}) {
  if (options.token !== undefined && (!options.token.length || options.token.length > 4096 || /\s/.test(options.token))) {
    throw new Error("API token must contain 1 to 4096 non-whitespace characters");
  }
  return { port: parsePort(options.port ?? DEFAULT_API_PORT), host: bindHost(options.host, options.allowRemote), token: options.token };
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function send(response: ServerResponse, status: number, value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_RESPONSE_BYTES) {
    throw new HttpError(413, "RESPONSE_TOO_LARGE", "Response exceeds 1 MiB");
  }
  json(response, status, value);
}

function authorized(header: string | undefined, token: string): boolean {
  const expected = Buffer.from(token);
  const actual = Buffer.from(header?.match(/^Bearer (\S+)$/i)?.[1] ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !== "application/json"
    || (request.headers["content-encoding"] && request.headers["content-encoding"] !== "identity")) {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Use uncompressed application/json");
  }
  if (Number(request.headers["content-length"]) > MAX_BODY_BYTES) {
    throw new HttpError(413, "BODY_TOO_LARGE", "Request body exceeds 64 KiB");
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(new HttpError(413, "BODY_TOO_LARGE", "Request body exceeds 64 KiB"));
      } else chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => {
      if (size > MAX_BODY_BYTES) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new HttpError(400, "INVALID_JSON", "Invalid JSON body")); }
    });
  });
}

function queryInput(params: URLSearchParams, allowed: string[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [key, value] of params) {
    if (!allowed.includes(key) || (key !== "tags" && Object.hasOwn(input, key))) {
      throw new HttpError(400, "VALIDATION", `Unknown or repeated query parameter: ${key}`);
    }
    if (key === "tags") input.tags = params.getAll("tags");
    else if (key === "limit") input.limit = /^\d+$/.test(value) ? Number(value) : value;
    else if (key === "includeHistory") input.includeHistory = value === "true" ? true : value === "false" ? false : value;
    else input[key] = value;
  }
  return input;
}

/** One project per process, using exactly the service methods exposed by MCP. */
export async function startApiServer(context: Pick<CliContext, "service" | "projectId">, options: ApiServerOptions = {}) {
  const { port, host, token } = parseApiOptions(options);
  let origin = "";
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    try {
      // Authenticate before dispatch, including unknown routes and OPTIONS.
      if (token !== undefined && !authorized(request.headers.authorization, token)) {
        response.setHeader("WWW-Authenticate", "Bearer");
        throw new HttpError(401, "UNAUTHORIZED", "Bearer token required");
      }
      if (!sameOrigin(request, origin)) throw new HttpError(403, "FORBIDDEN", "Local origin required");
      if ((request.url?.length ?? 0) > 8192) throw new HttpError(414, "URI_TOO_LONG", "Request URL exceeds 8192 characters");
      const url = new URL(request.url ?? "/", origin);
      if (url.origin !== origin) throw new HttpError(403, "FORBIDDEN", "Local origin required");
      const { pathname, searchParams } = url;
      const projectId = context.projectId;
      if (pathname === "/v1/search" || pathname === "/v1/timeline") {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET");
        }
        if (pathname === "/v1/search") {
          const input = queryInput(searchParams, ["query", "limit", "includeHistory", "tags"]);
          const result = await context.service.searchMemoryIndex(searchMemoryIndexRequestSchema.parse({ ...input, projectId }));
          send(response, 200, result);
        } else {
          const input = queryInput(searchParams, ["memoryId", "fromDate", "toDate", "limit", "includeHistory"]);
          const result = await context.service.memoryTimeline(memoryTimelineRequestSchema.parse({ ...input, projectId }));
          send(response, 200, result);
        }
      } else if (pathname === "/v1/memories") {
        if (request.method !== "POST") {
          response.setHeader("Allow", "POST");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use POST");
        }
        queryInput(searchParams, []);
        const input = storeMemoryRequestSchema.omit({ projectId: true }).strict().parse(await readBody(request));
        send(response, 201, await context.service.storeMemory({ ...input, projectId }));
      } else if (/^\/v1\/memories\/[^/]+$/.test(pathname)) {
        queryInput(searchParams, []);
        let memoryId: string;
        try { memoryId = decodeURIComponent(pathname.slice("/v1/memories/".length)); }
        catch { throw new HttpError(400, "VALIDATION", "Invalid memory ID encoding"); }
        if (request.method === "GET") send(response, 200, await context.service.getMemory({ projectId, memoryId }));
        else if (request.method === "DELETE") send(response, 200, await context.service.forgetMemory({ projectId, memoryId }));
        else {
          response.setHeader("Allow", "GET, DELETE");
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Use GET or DELETE");
        }
      } else throw new HttpError(404, "NOT_FOUND", "Not found");
    } catch (error) {
      let status = 500;
      let code = "INTERNAL";
      let message = "Unable to access the memory store";
      if (error instanceof HttpError) ({ status, code, message } = error);
      else if (error instanceof z.ZodError) { status = 400; code = "VALIDATION"; message = "Invalid request parameters"; }
      else if (error instanceof DomainError && error.code !== "INTERNAL") {
        status = { VALIDATION: 400, NOT_FOUND: 404, CONFLICT: 409 }[error.code];
        code = error.code;
        message = error.message;
      } else if (error instanceof Error && "code" in error
        && ["SQLITE_CONSTRAINT_PRIMARYKEY", "SQLITE_CONSTRAINT_UNIQUE"].includes(String(error.code))) {
        status = 409; code = "CONFLICT"; message = "Memory ID or session summary already exists";
      }
      // Finish rejected uploads without buffering or keeping their connection alive.
      response.setHeader("Connection", "close");
      request.resume();
      json(response, status, { ok: false, error: { code, message } });
    }
  });
  const listener = await listenHttp(server, port, host);
  origin = new URL(listener.url).origin;
  return listener;
}
