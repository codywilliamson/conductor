import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  Task,
  TaskResult,
  TaskStatus,
  TaskPriority,
  Agent,
  AgentStatus,
  CreateTaskInput,
  RegisterAgentInput,
  TaskFilter,
} from '../types.js';

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  context: string;
  dependencies: string;
  priority: number;
  claimed_by: string | null;
  result: string | null;
  feedback: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  agent_id: string;
  runtime: string | null;
  capabilities: string;
  scope: string | null;
  connected_at: string;
  status: string;
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        description TEXT,
        context TEXT NOT NULL DEFAULT '{}',
        dependencies TEXT NOT NULL DEFAULT '[]',
        priority INTEGER NOT NULL DEFAULT 2,
        claimed_by TEXT,
        result TEXT,
        feedback TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        runtime TEXT,
        capabilities TEXT NOT NULL DEFAULT '[]',
        scope TEXT,
        connected_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle'
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
      CREATE INDEX IF NOT EXISTS idx_tasks_claimed_by ON tasks(claimed_by);
    `);
  }

  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      description: row.description,
      context: JSON.parse(row.context),
      dependencies: JSON.parse(row.dependencies),
      priority: row.priority as TaskPriority,
      claimed_by: row.claimed_by,
      result: row.result ? JSON.parse(row.result) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private rowToAgent(row: AgentRow): Agent {
    return {
      agent_id: row.agent_id,
      runtime: row.runtime,
      capabilities: JSON.parse(row.capabilities),
      scope: row.scope,
      connected_at: row.connected_at,
      status: row.status as AgentStatus,
    };
  }

  createTask(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const id = `task_${ulid()}`;
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, title, status, description, context, dependencies, priority, created_at, updated_at)
      VALUES (?, ?, 'available', ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.title,
      input.description ?? null,
      JSON.stringify(input.context ?? {}),
      JSON.stringify(input.dependencies ?? []),
      input.priority ?? 2,
      now,
      now,
    );

    return this.getTask(id)!;
  }

  getTask(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined;
    return row ? this.rowToTask(row) : null;
  }

  listTasks(filter: TaskFilter = {}): Task[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    if (filter.priority_max !== undefined) {
      conditions.push('priority <= ?');
      params.push(filter.priority_max);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;

    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY priority ASC, created_at ASC LIMIT ?`)
      .all(...params, limit) as TaskRow[];

    return rows.map((r) => this.rowToTask(r));
  }

  updateTaskStatus(id: string, status: TaskStatus, claimedBy?: string | null): boolean {
    const now = new Date().toISOString();
    const sets = ['status = ?', 'updated_at = ?'];
    const params: unknown[] = [status, now];

    if (claimedBy !== undefined) {
      sets.push('claimed_by = ?');
      params.push(claimedBy);
    }

    if (status === 'available') {
      sets.push('claimed_by = NULL', 'result = NULL', 'feedback = NULL');
    }

    params.push(id);
    const result = this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return result.changes > 0;
  }

  setTaskResult(id: string, result: TaskResult): boolean {
    const now = new Date().toISOString();
    const res = this.db
      .prepare('UPDATE tasks SET result = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(result), 'review', now, id);
    return res.changes > 0;
  }

  setTaskFeedback(id: string, feedback: string): boolean {
    const now = new Date().toISOString();
    const res = this.db
      .prepare('UPDATE tasks SET feedback = ?, updated_at = ? WHERE id = ?')
      .run(feedback, now, id);
    return res.changes > 0;
  }

  getTaskFeedback(id: string): string | null {
    const row = this.db.prepare('SELECT feedback FROM tasks WHERE id = ?').get(id) as
      | { feedback: string | null }
      | undefined;
    return row?.feedback ?? null;
  }

  claimTask(taskId: string, agentId: string): Task | null {
    const claim = this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT * FROM tasks WHERE id = ? AND status = 'available'")
        .get(taskId) as TaskRow | undefined;
      if (!row) return null;

      const deps: string[] = JSON.parse(row.dependencies);
      if (deps.length > 0) {
        const placeholders = deps.map(() => '?').join(',');
        const doneCount = this.db
          .prepare(`SELECT COUNT(*) as cnt FROM tasks WHERE id IN (${placeholders}) AND status = 'done'`)
          .get(...deps) as { cnt: number };
        if (doneCount.cnt !== deps.length) return null;
      }

      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE tasks SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ?")
        .run(agentId, now, taskId);

      return this.getTask(taskId);
    });

    return claim();
  }

  registerAgent(input: RegisterAgentInput): Agent {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO agents (agent_id, runtime, capabilities, scope, connected_at, status)
         VALUES (?, ?, ?, ?, ?, 'idle')`,
      )
      .run(
        input.agent_id,
        input.runtime ?? null,
        JSON.stringify(input.capabilities ?? []),
        input.scope ?? null,
        now,
      );

    return this.getAgent(input.agent_id)!;
  }

  getAgent(agentId: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as
      | AgentRow
      | undefined;
    return row ? this.rowToAgent(row) : null;
  }

  listAgents(): Agent[] {
    const rows = this.db.prepare('SELECT * FROM agents ORDER BY connected_at DESC').all() as AgentRow[];
    return rows.map((r) => this.rowToAgent(r));
  }

  updateAgentStatus(agentId: string, status: AgentStatus): boolean {
    const res = this.db.prepare('UPDATE agents SET status = ? WHERE agent_id = ?').run(status, agentId);
    return res.changes > 0;
  }

  removeAgent(agentId: string): boolean {
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE tasks SET status = 'available', claimed_by = NULL, updated_at = ? WHERE claimed_by = ? AND status IN ('claimed', 'working')",
      )
      .run(now, agentId);

    const res = this.db.prepare('DELETE FROM agents WHERE agent_id = ?').run(agentId);
    return res.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
