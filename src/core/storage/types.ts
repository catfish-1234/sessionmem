export interface SessionEventRecord {
  id: string;
  project_id: string;
  session_id: string;
  event_index: number;
  event_type: string;
  payload_json: string;
  created_at: string;
}

export interface MemoryRecord {
  id: string;
  project_id: string;
  session_id: string;
  source_adapter: string;
  kind: string;
  content: string;
  normalized_content: string;
  importance: number;
  embedding: string | null;
  embedding_dim: number | null;
  embedding_version: string | null;
  author: string;
  origin_project_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsertSessionEventInput {
  id: string;
  project_id: string;
  session_id: string;
  event_index: number;
  event_type: string;
  payload_json: string;
  created_at?: string;
}

export interface InsertMemoryInput {
  id: string;
  project_id: string;
  session_id: string;
  source_adapter: string;
  kind: string;
  content: string;
  normalized_content: string;
  importance: number;
  embedding?: string | null;
  embedding_dim?: number | null;
  embedding_version?: string | null;
  author?: string;
  origin_project_id?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SummarizationFailureRecord {
  id: string;
  project_id: string;
  session_id: string;
  source_adapter: string;
  reason: string;
  attempt_count: number;
  last_error_json: string;
  created_at: string;
  updated_at: string;
}

export interface InsertSummarizationFailureInput {
  id: string;
  project_id: string;
  session_id: string;
  source_adapter: string;
  reason: string;
  attempt_count: number;
  last_error_json: string;
  created_at?: string;
  updated_at?: string;
}
