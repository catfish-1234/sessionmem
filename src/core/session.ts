export function onSessionDisconnect(adapterName: string, error?: Error): void {
  const reason = error ? error.message : "unknown cause";
  console.warn(
    `[sessionmem] ${adapterName} disconnected mid-session (${reason}). Continuing.`,
  );
}
