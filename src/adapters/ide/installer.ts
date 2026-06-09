export class IDEInstaller {
  static parseJsonc(content: string): Record<string, unknown> {
    const stripped = content
      .replace(/\/\/[^\n]*/g, "")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(stripped) as Record<string, unknown>;
  }

  static injectMcpBlock(
    content: string,
    serverName: string,
    command: string,
    args: string[],
  ): string {
    const config: Record<string, unknown> = content.trim()
      ? this.parseJsonc(content)
      : {};
    if (!config.mcpServers) config.mcpServers = {};
    (config.mcpServers as Record<string, unknown>)[serverName] = {
      command,
      args,
    };
    return JSON.stringify(config, null, 2);
  }

  static removeMcpBlock(content: string, serverName: string): string {
    const config: Record<string, unknown> = content.trim()
      ? this.parseJsonc(content)
      : {};
    if (config.mcpServers) {
      delete (config.mcpServers as Record<string, unknown>)[serverName];
    }
    return JSON.stringify(config, null, 2);
  }

  static async injectMcpConfig(
    filePath: string,
    serverName: string,
    command: string,
    args: string[],
  ): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync } = await import("fs");
      const existing = existsSync(filePath)
        ? readFileSync(filePath, "utf-8")
        : "{}";
      const updated = this.injectMcpBlock(existing, serverName, command, args);
      writeFileSync(filePath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  static async removeMcpConfig(
    filePath: string,
    serverName: string,
  ): Promise<boolean> {
    try {
      const { readFileSync, writeFileSync, existsSync } = await import("fs");
      if (!existsSync(filePath)) return true;
      const existing = readFileSync(filePath, "utf-8");
      const updated = this.removeMcpBlock(existing, serverName);
      writeFileSync(filePath, updated, "utf-8");
      return true;
    } catch {
      return false;
    }
  }
}
