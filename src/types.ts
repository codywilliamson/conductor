export type TaskStatus = 'available' | 'claimed' | 'working' | 'review' | 'done' | 'failed';
export type TaskPriority = 0 | 1 | 2 | 3;
export type ResultType = 'diff' | 'pr_url' | 'file' | 'text';
export type AgentStatus = 'idle' | 'working' | 'disconnected';
export type ProjectStatus = 'active' | 'archived';
export type ApiKeyScope =
  | 'tasks:read'
  | 'tasks:write'
  | 'tasks:claim'
  | 'status:write'
  | 'result:write'
  | 'feedback:read'
  | 'feedback:write'
  | 'events:read'
  | 'admin';
export type BridgeTunnel = 'cloudflare' | 'ngrok' | 'tailscale' | 'none';

export interface Task {
  id: string;
  project_id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  scope: string | null;
  source: string | null;
  source_session_id: string | null;
  context: Record<string, unknown>;
  dependencies: string[];
  priority: TaskPriority;
  claimed_by: string | null;
  result: TaskResult | null;
  created_at: string;
  updated_at: string;
}

export interface TaskResult {
  result_type: ResultType;
  result_data: string;
  summary: string | null;
}

export interface Agent {
  agent_id: string;
  runtime: string | null;
  capabilities: string[];
  scope: string | null;
  connected_at: string;
  status: AgentStatus;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  status: ProjectStatus;
  created_at: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
}

export interface CreateTaskInput {
  project_id?: string;
  title: string;
  description?: string;
  scope?: string;
  source?: string;
  source_session_id?: string;
  context?: Record<string, unknown>;
  dependencies?: string[];
  priority?: TaskPriority;
}

export interface RegisterAgentInput {
  agent_id: string;
  runtime?: string;
  capabilities?: string[];
  scope?: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  priority_max?: TaskPriority;
  scope?: string;
  project_id?: string;
  limit?: number;
}

export interface RiffEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  expires_at: string | null;
  last_used: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface BridgeRequestLogEntry {
  id: number;
  key_name: string;
  method: string;
  path: string;
  ip: string;
  status_code: number;
  created_at: string;
}

export interface BridgeRequestLogFilter {
  keyName?: string;
  limit?: number;
}

export interface BridgeState {
  paused: boolean;
  public_url: string | null;
  tunnel: BridgeTunnel | null;
  updated_at: string;
}

export type EventType =
  | 'task.created'
  | 'task.claimed'
  | 'task.status_changed'
  | 'task.result_submitted'
  | 'task.feedback_given'
  | 'task.completed'
  | 'task.failed'
  | 'agent.registered'
  | 'agent.disconnected';

// valid status transitions
export const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  available: ['claimed'],
  claimed: ['working', 'failed', 'available'],
  working: ['review', 'failed', 'available'],
  review: ['done', 'working', 'available'],
  done: [],
  failed: ['available'],
};
