import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { isIP } from "node:net";

export function parsePort(value: string | number): number {
  const port = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("--port must be an integer from 0 to 65535 (0 selects a free port)");
  }
  return port;
}

export function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

/** Exact authority matching also rejects DNS rebinding and alternate origins. */
export function sameOrigin(request: IncomingMessage, origin: string): boolean {
  return request.headers.host === new URL(origin).host
    && (request.headers.origin === undefined || request.headers.origin === origin)
    && request.headers["sec-fetch-site"] !== "cross-site";
}

export function bindHost(host = "127.0.0.1", allowRemote = false): string {
  if (host === "localhost") return "127.0.0.1";
  // Numeric addresses only: a DNS change must never turn a local bind remote.
  if (!isIP(host)) throw new Error("--host must be an IP address or localhost");
  const loopback = host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
  if (!loopback && !allowRemote) throw new Error("Non-loopback bind refused. Use --allow-remote explicitly to expose the local API.");
  return host;
}

export async function listenHttp(server: Server, port: number, host = "127.0.0.1") {
  parsePort(port);
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.setTimeout(10000);
  if (host !== "::1" && !(isIP(host) === 4 && host.startsWith("127."))) {
    console.warn("WARNING: binding the local single-user API outside loopback exposes memories to the network. This is not a hosted service; use a bearer token and trusted network.");
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP address");
  // Wildcard binds are reached locally through loopback. Accept only this
  // printed authority, even with --allow-remote, rather than trusting Host.
  const urlHost = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  const origin = `http://${isIP(urlHost) === 6 ? `[${urlHost}]` : urlHost}:${address.port}`;
  return {
    server, url: `${origin}/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}
