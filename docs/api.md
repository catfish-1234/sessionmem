# Local REST API

This is a local single-user API, not a hosted service. Run it from your project:

```bash
sessionmem serve --api
sessionmem serve --api --port 0  # Print an available port
```

The default address is `http://127.0.0.1:3778`. The server creates or upgrades
the normal local store and selects the same repository project as the CLI and
MCP. `SESSIONMEM_DB_PATH` and `SESSIONMEM_PROJECT_ID` work as usual. The project
is fixed for the lifetime of the process; request parameters cannot change it.
Press Ctrl-C to close the server and database.

## Authentication and browser access

Authentication is optional. Set `SESSIONMEM_API_TOKEN` in the server environment,
or pass `--token <token>` (the flag takes precedence). A configured token is
required on every route, including unknown routes and OPTIONS. Tokens are never
printed. An environment variable avoids placing a token in shell history or
process arguments. Without a token, local processes can read and modify memories.

```bash
# With SESSIONMEM_API_TOKEN already set in your shell:
sessionmem serve --api
curl -H "Authorization: Bearer $SESSIONMEM_API_TOKEN" \
  'http://127.0.0.1:3778/v1/search?query=database&limit=5'
```

All examples below assume authentication is off; add the same Authorization
header when enabled. No CORS permissions are granted. Origin must be absent or
exactly match the printed server origin. Host must match its authority, including
the port. Cross-site browser requests, opaque `null` origins and DNS rebinding
hosts are rejected. A browser app on another port is also a different origin.
The JavaScript client is intended for local scripts or the same origin.

Non-loopback binding is refused unless `--allow-remote` is supplied. For example,
`sessionmem serve --api --host 192.168.1.10 --allow-remote` prints a network exposure
warning. Only numeric IP addresses or `localhost` are accepted. This offers no
TLS, multi-user authorization or hosted-service protections. Use a bearer token
and a trusted network. Host checks continue to require the printed authority.
Wildcard binds print a loopback URL and accept only that authority.

## Routes

All responses are JSON. Success responses retain the MCP service envelope
(`ok: true`). Errors are `{ "ok": false, "error": { "code": "...", "message": "..." } }`.
Field names and filtering follow `searchMemoryIndex`, `memoryTimeline`,
`getMemory`, `storeMemory` and `forgetMemory` exactly.

| Method and path | Input and response |
| --- | --- |
| `GET /v1/search` | Required `query`; optional `limit` (default 10, maximum 50), `includeHistory` (default false), repeated `tags` (up to 10). Returns `memories` with `id`, one-line `summary` (160 characters maximum), `kind` (memory type), `date`, `score`, plus `hasMore`. |
| `GET /v1/timeline` | Either `memoryId` alone, or `fromDate` and `toDate` as ISO timestamps in chronological order. Optional `limit` (default 10, maximum 50) and `includeHistory` (default true). Returns the same compact envelope; scores are null. |
| `GET /v1/memories/:id` | Full detail in `memory`, scoped to this server's project. Percent-encode the ID as a single path segment. |
| `POST /v1/memories` | JSON with `memoryId`, `sessionId`, `sourceAdapter`, `kind`, `content`, `importance`. Optional `tags`, `expiresAt`, `redactionEnabled`. Returns the saved `memory` and `warningCodes`, HTTP 201. Existing IDs return 409. |
| `DELETE /v1/memories/:id` | Deletes through the existing project-scoped service, including its feedback recording and index cleanup. Returns `{ "ok": true }`. Deletion is permanent. |

Search preserves expiry, history and tag filtering, scores and ranking. Timeline
preserves the MCP date boundaries and anchor behavior. Full detail and deletion
retain the existing `getMemory` and `forgetMemory` visibility rules. Saving uses
the same validation, redaction and indexing as MCP. No multi-level scopes are added.

```bash
curl 'http://127.0.0.1:3778/v1/search?query=database&limit=5&tags=backend'
curl 'http://127.0.0.1:3778/v1/timeline?memoryId=example-1&limit=5'
curl 'http://127.0.0.1:3778/v1/timeline?fromDate=2026-01-01T00%3A00%3A00Z&toDate=2026-02-01T00%3A00%3A00Z'
curl -X POST 'http://127.0.0.1:3778/v1/memories' \
  -H 'Content-Type: application/json' \
  -d '{"memoryId":"example-1","sessionId":"local-script","sourceAdapter":"rest","kind":"decision","content":"Use SQLite for the local cache.","importance":7,"tags":["backend"]}'
curl 'http://127.0.0.1:3778/v1/memories/example-1'
curl -X DELETE 'http://127.0.0.1:3778/v1/memories/example-1'
```

Memory kinds are `decision`, `fact`, `warning`, `preference`, `summary`;
importance is an integer from 1 to 10. Content is limited to 10,000 characters.
The body limit is 64 KiB, including chunked uploads; compressed bodies are
rejected. Responses are capped at 1 MiB, URLs at 8,192 characters, queries at
1,000 characters and memory IDs at 200 characters. Requests and idle connections
time out after 10 seconds. Unknown or repeated scalar query parameters are
rejected. There is no unbounded list or export route.

Errors use 400 for invalid parameters or JSON, 401 for missing/incorrect tokens,
403 for origin/Host violations, 404 for unknown routes or missing memories,
405 for unsupported methods (with Allow), 409 for duplicate IDs or session
summaries, 413 for oversized bodies/responses, 414 for oversized URLs, 415 for
unsupported body formats and 500 for internal failures. Internal database details
are not returned.

## Typed JavaScript client

The package exports `sessionmem/client` for ESM, with TypeScript declarations.
It uses the runtime's built-in fetch and has no runtime imports or dependencies.
Use a supported Node version from `package.json`.

```ts
import { SessionmemClient, SessionmemApiError } from "sessionmem/client";

const client = new SessionmemClient("http://127.0.0.1:3778", {
  token: process.env.SESSIONMEM_API_TOKEN,
});
await client.storeMemory({
  memoryId: "example-1", sessionId: "script", sourceAdapter: "rest",
  kind: "fact", content: "The database is SQLite.", importance: 5,
});
const index = await client.searchMemoryIndex({ query: "database", limit: 5 });
const timeline = await client.memoryTimeline({ memoryId: "example-1", limit: 5 });
const range = await client.memoryTimeline({
  fromDate: "2026-01-01T00:00:00Z", toDate: "2026-12-31T23:59:59Z",
});
const detail = await client.getMemory("example-1");
await client.forgetMemory("example-1");

try { await client.getMemory("example-1"); }
catch (error) {
  if (error instanceof SessionmemApiError) console.log(error.status, error.code, error.message);
  else throw error;
}
```

Methods return the JSON success envelopes above. Non-success HTTP responses
throw `SessionmemApiError`; connection failures retain the runtime's fetch error.
The client encodes IDs, query strings and repeated tags, and sends bearer headers
when configured. It does not retry writes or delete operations.
