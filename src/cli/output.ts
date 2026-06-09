interface MemoryTableRow {
  id: string;
  importance: number;
  createdAt: string;
  content: string;
}

interface MemoryKeyValueDto {
  id: string;
  content: string;
  importance: number;
  createdAt: string;
  sessionId: string;
  projectId: string;
  sourceAdapter: string;
}

export function formatTable(rows: MemoryTableRow[]): string {
  const ID_WIDTH = 36;
  const IMP_WIDTH = 10;
  const DATE_WIDTH = 10;
  const PREVIEW_WIDTH = 60;

  const header =
    "ID".padEnd(ID_WIDTH) +
    " | " +
    "importance".padEnd(IMP_WIDTH) +
    " | " +
    "date".padEnd(DATE_WIDTH) +
    " | " +
    "preview";

  const lines = rows.map((row) => {
    const preview = row.content.replace(/\s+/g, " ").slice(0, PREVIEW_WIDTH);
    const date = row.createdAt.slice(0, 10);
    return (
      row.id.padEnd(ID_WIDTH) +
      " | " +
      String(row.importance).padEnd(IMP_WIDTH) +
      " | " +
      date.padEnd(DATE_WIDTH) +
      " | " +
      preview
    );
  });

  return [header, ...lines].join("\n");
}

export function formatKeyValue(memory: MemoryKeyValueDto): string {
  const lines = [
    `id: ${memory.id}`,
    `content: ${memory.content}`,
    `importance: ${memory.importance}`,
    `created_at: ${memory.createdAt}`,
    `session_id: ${memory.sessionId}`,
    `project_id: ${memory.projectId}`,
    `source_adapter: ${memory.sourceAdapter}`,
  ];
  return lines.join("\n");
}
