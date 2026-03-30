export type TaskStatus = 'available' | 'claimed' | 'working' | 'review' | 'done' | 'failed';
export type TaskPriority = 0 | 1 | 2 | 3;
export type ResultType = 'diff' | 'pr_url' | 'file' | 'text';
export type AgentStatus = 'idle' | 'working' | 'disconnected';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
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

export interface CreateTaskInput {
  title: string;
  description?: string;
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
  limit?: number;
}

export interface ConductorEvent {
  type: EventType;
  timestamp: string;
  data: Record<string, unknown>;
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
