import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";

// Install before importing production code. Any attempted network access fails
// the evaluation, including attempts caught by a provider's fallback handler.
export function blockNetwork() {
  let attempts = 0;
  const restore = [];
  function replace(target, key) {
    const original = target[key];
    target[key] = () => {
      attempts += 1;
      throw new Error(`Offline benchmark blocked network access: ${key}`);
    };
    restore.push(() => { target[key] = original; });
  }
  replace(globalThis, "fetch");
  replace(net.Socket.prototype, "connect");
  replace(tls, "connect");
  replace(dgram.Socket.prototype, "send");
  for (const module of [http, https]) {
    replace(module, "request");
    replace(module, "get");
  }
  replace(http2, "connect");
  for (const module of [dns, dns.promises]) {
    for (const key of Object.keys(module).filter((key) => /^(lookup|resolve|reverse)/.test(key) && typeof module[key] === "function")) {
      replace(module, key);
    }
  }
  syncBuiltinESMExports();
  return {
    assertOffline() {
      if (attempts) throw new Error(`Offline benchmark observed ${attempts} network attempt(s)`);
    },
    restore() {
      for (const undo of restore.reverse()) undo();
      syncBuiltinESMExports();
    },
  };
}
