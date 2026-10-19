import { createCliContext, type CliContext } from "../context.js";
import { deriveProjectId } from "../projectId.js";

/** Bounded hook input. Invalid input produces no context and never blocks a prompt. */
export async function promptSubmitCommand(ctx?: CliContext, supplied?: unknown): Promise<void> {
  let context: CliContext | undefined;
  try {
    let payload = supplied;
    if (payload === undefined) {
      payload = await new Promise<unknown>(resolve => {
        let text = "", finished = false;
        const done = () => {
          if (finished) return;
          finished = true; clearTimeout(timer);
          process.stdin.removeListener("data", data); process.stdin.removeListener("end", done); process.stdin.removeListener("error", done);
          process.stdin.pause();
          try { resolve(JSON.parse(text)); } catch { resolve({}); }
        };
        const data = (chunk: string) => { text += chunk; if (text.length > 65536) { text = ""; done(); } };
        const timer = setTimeout(done, 500); timer.unref();
        process.stdin.setEncoding("utf8"); process.stdin.on("data", data); process.stdin.on("end", done); process.stdin.on("error", done);
      });
    }
    if (!payload || typeof payload !== "object") return;
    const { prompt, cwd } = payload as { prompt?: unknown; cwd?: unknown };
    if (typeof prompt !== "string" || !prompt.trim()) return;
    context = ctx ?? createCliContext(typeof cwd === "string" ? { projectId: deriveProjectId(cwd) } : {});
    const result = await context.service.call("retrieveMemories", {
      projectId: context.projectId, query: prompt.slice(0, 1000), limit: 5, mode: "on-demand", depth: "default",
    });
    if (result.ok && result.startupInjection.trim()) process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: result.startupInjection },
    }));
  } catch { /* Hook failures do not interrupt the host. Doctor diagnoses the setup. */ }
  finally { if (!ctx) context?.db.close(); }
}
