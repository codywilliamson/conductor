import Database from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  Task,
  TaskResult,
  TaskStatus,
  TaskPriority,
  Agent,
  AgentStatus,
  Project,
  ProjectStatus,
  CreateProjectInput,
  CreateTaskInput,
  RegisterAgentInput,
  TaskFilter,
  ApiKeyRecord,
  BridgeRequestLogEntry,
  BridgeRequestLogFilter,
  BridgeState,
  BridgeTunnel,
} from '../types.js';

interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  scope: string | null;
  source: string | null;
  source_session_id: string | null;
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

interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;
  expires_at: string | null;
  last_used: string | null;
  created_at: string;
  revoked_at: string | null;
}

interface BridgeRequestRow {
  id: number;
  key_name: string;
  method: string;
  path: string;
  ip: string;
  status_code: number;
  created_at: string;
}

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
}

interface BridgeStateRow {
  paused: number;
  public_url: string | null;
  tunnel: string | null;
  updated_at: string;
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
    const now = new Date().toISOString();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        description TEXT,
        scope TEXT,
        source TEXT,
        source_session_id TEXT,
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

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        scopes TEXT NOT NULL,
        expires_at TEXT,
        last_used TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_active_name
      ON api_keys(name)
      WHERE revoked_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

      CREATE TABLE IF NOT EXISTS bridge_request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_name TEXT NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        ip TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_bridge_request_log_key_time
      ON bridge_request_log(key_name, created_at);

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS bridge_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        paused INTEGER NOT NULL DEFAULT 0,
        public_url TEXT,
        tunnel TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    this.db
      .prepare(
        `INSERT OR IGNORE INTO bridge_state (id, paused, public_url, tunnel, updated_at)
         VALUES (1, 0, NULL, NULL, ?)`,
      )
      .run(now);

    this.ensureColumn('tasks', 'scope', 'TEXT');
    this.ensureColumn('tasks', 'source', 'TEXT');
    this.ensureColumn('tasks', 'source_session_id', 'TEXT');
    this.ensureColumn('tasks', 'project_id', 'TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status)');
    this.ensureDefaultProject();
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((existing) => existing.name === column)) {
      return;
    }

    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  private ensureDefaultProject(): void {
    const existing = this.db
      .prepare("SELECT id FROM projects WHERE name = 'default'")
      .get() as { id: string } | undefined;
    if (existing) {
      this.db.prepare('UPDATE tasks SET project_id = ? WHERE project_id IS NULL').run(existing.id);
      return;
    }
    const id = `proj_${ulid()}`;
    const now = new Date().toISOString();
    this.db
      .prepare('INSERT INTO projects (id, name, status, created_at) VALUES (?, ?, ?, ?)')
      .run(id, 'default', 'active', now);
    this.db.prepare('UPDATE tasks SET project_id = ? WHERE project_id IS NULL').run(id);
  }

  private getDefaultProjectId(): string {
    const row = this.db
      .prepare("SELECT id FROM projects WHERE name = 'default'")
      .get() as { id: string };
    return row.id;
  }

  private rowToProject(row: ProjectRow): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status as ProjectStatus,
      created_at: row.created_at,
    };
  }

  private rowToTask(row: TaskRow): Task {
    return {
      id: row.id,
      title: row.title,
      status: row.status,
      description: row.description,
      scope: row.scope,
      source: row.source,
      source_session_id: row.source_session_id,
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

  private rowToApiKey(row: ApiKeyRow): ApiKeyRecord {
    return {
      id: row.id,
      name: row.name,
      key_hash: row.key_hash,
      key_prefix: row.key_prefix,
      scopes: row.scopes
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean) as ApiKeyRecord['scopes'],
      expires_at: row.expires_at,
      last_used: row.last_used,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
    };
  }

  private rowToBridgeRequest(row: BridgeRequestRow): BridgeRequestLogEntry {
    return {
      id: row.id,
      key_name: row.key_name,
      method: row.method,
      path: row.path,
      ip: row.ip,
      status_code: row.status_code,
      created_at: row.created_at,
    };
  }

  private rowToBridgeState(row: BridgeStateRow): BridgeState {
    return {
      paused: row.paused === 1,
      public_url: row.public_url,
      tunnel: row.tunnel as BridgeTunnel | null,
      updated_at: row.updated_at,
    };
  }

  createProject(input: CreateProjectInput): Project {
    const id = `proj_${ulid()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT INTO projects (id, name, description, status, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, input.name, input.description ?? null, 'active', now);
    return this.getProject(id)!;
  }

  getProject(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      | ProjectRow
      | undefined;
    return row ? this.rowToProject(row) : null;
  }

  getProjectByName(name: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as
      | ProjectRow
      | undefined;
    return row ? this.rowToProject(row) : null;
  }

  listProjects(filter: { includeArchived?: boolean } = {}): Project[] {
    if (filter.includeArchived) {
      const rows = this.db
        .prepare('SELECT * FROM projects ORDER BY created_at ASC')
        .all() as ProjectRow[];
      return rows.map((r) => this.rowToProject(r));
    }
    const rows = this.db
      .prepare("SELECT * FROM projects WHERE status = 'active' ORDER BY created_at ASC")
      .all() as ProjectRow[];
    return rows.map((r) => this.rowToProject(r));
  }

  updateProject(
    id: string,
    updates: { name?: string; description?: string; status?: ProjectStatus },
  ): Project | null {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.name !== undefined) {
      sets.push('name = ?');
      params.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push('description = ?');
      params.push(updates.description);
    }
    if (updates.status !== undefined) {
      sets.push('status = ?');
      params.push(updates.status);
    }

    if (sets.length === 0) return this.getProject(id);

    params.push(id);
    const result = this.db
      .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
      .run(...params);
    if (result.changes === 0) return null;
    return this.getProject(id);
  }

  createTask(input: CreateTaskInput, taskId?: string): Task {
    const now = new Date().toISOString();
    const id = taskId ?? `task_${ulid()}`;
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id,
        title,
        status,
        description,
        scope,
        source,
        source_session_id,
        context,
        dependencies,
        priority,
        created_at,
        updated_at
      )
      VALUES (?, ?, 'available', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.title,
      input.description ?? null,
      input.scope ?? null,
      input.source ?? null,
      input.source_session_id ?? null,
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

    if (filter.scope) {
      conditions.push('scope = ?');
      params.push(filter.scope);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;

    const rows = this.db
      .prepare(`SELECT * FROM tasks ${where} ORDER BY priority ASC, created_at ASC LIMIT ?`)
      .all(...params, limit) as TaskRow[];

    return rows.map((r) => this.rowToTask(r));
  }

  updateTaskDependencies(id: string, dependencies: string[]): boolean {
    const now = new Date().toISOString();
    const result = this.db
      .prepare('UPDATE tasks SET dependencies = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(dependencies), now, id);
    return result.changes > 0;
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

  createApiKey(input: ApiKeyRecord): ApiKeyRecord {
    this.db
      .prepare(
        `INSERT INTO api_keys (id, name, key_hash, key_prefix, scopes, expires_at, last_used, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.key_hash,
        input.key_prefix,
        input.scopes.join(','),
        input.expires_at,
        input.last_used,
        input.created_at,
        input.revoked_at,
      );

    return this.getApiKeyByHash(input.key_hash)!;
  }

  getApiKeyByHash(keyHash: string): ApiKeyRecord | null {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as
      | ApiKeyRow
      | undefined;
    return row ? this.rowToApiKey(row) : null;
  }

  getActiveApiKeyByName(name: string): ApiKeyRecord | null {
    const row = this.db
      .prepare('SELECT * FROM api_keys WHERE name = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1')
      .get(name) as ApiKeyRow | undefined;
    return row ? this.rowToApiKey(row) : null;
  }

  listApiKeys(): ApiKeyRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC')
      .all() as ApiKeyRow[];
    return rows.map((row) => this.rowToApiKey(row));
  }

  touchApiKey(id: string, lastUsed: string = new Date().toISOString()): boolean {
    const result = this.db.prepare('UPDATE api_keys SET last_used = ? WHERE id = ?').run(lastUsed, id);
    return result.changes > 0;
  }

  revokeApiKey(id: string, revokedAt: string = new Date().toISOString()): boolean {
    const result = this.db
      .prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
      .run(revokedAt, id);
    return result.changes > 0;
  }

  logBridgeRequest(
    input: Omit<BridgeRequestLogEntry, 'id'>,
  ): BridgeRequestLogEntry {
    const result = this.db
      .prepare(
        `INSERT INTO bridge_request_log (key_name, method, path, ip, status_code, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.key_name, input.method, input.path, input.ip, input.status_code, input.created_at);

    const row = this.db
      .prepare('SELECT * FROM bridge_request_log WHERE id = ?')
      .get(result.lastInsertRowid) as BridgeRequestRow;
    return this.rowToBridgeRequest(row);
  }

  listBridgeRequests(filter: BridgeRequestLogFilter = {}): BridgeRequestLogEntry[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.keyName) {
      conditions.push('key_name = ?');
      params.push(filter.keyName);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 50;
    const rows = this.db
      .prepare(`SELECT * FROM bridge_request_log ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as BridgeRequestRow[];

    return rows.map((row) => this.rowToBridgeRequest(row));
  }

  countBridgeRequestsSince(keyName: string, since: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count
         FROM bridge_request_log
         WHERE key_name = ? AND created_at >= ?`,
      )
      .get(keyName, since) as { count: number };
    return row.count;
  }

  countAllBridgeRequestsSince(since: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as count
         FROM bridge_request_log
         WHERE created_at >= ?`,
      )
      .get(since) as { count: number };
    return row.count;
  }

  getLatestBridgeRequest(): BridgeRequestLogEntry | null {
    const row = this.db
      .prepare('SELECT * FROM bridge_request_log ORDER BY created_at DESC LIMIT 1')
      .get() as BridgeRequestRow | undefined;
    return row ? this.rowToBridgeRequest(row) : null;
  }

  getBridgeState(): BridgeState {
    const row = this.db.prepare('SELECT paused, public_url, tunnel, updated_at FROM bridge_state WHERE id = 1').get() as
      | BridgeStateRow
      | undefined;

    if (!row) {
      const state: BridgeState = {
        paused: false,
        public_url: null,
        tunnel: null,
        updated_at: new Date().toISOString(),
      };
      this.setBridgeState(state);
      return state;
    }

    return this.rowToBridgeState(row);
  }

  setBridgeState(state: BridgeState): BridgeState {
    this.db
      .prepare(
        `INSERT INTO bridge_state (id, paused, public_url, tunnel, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           paused = excluded.paused,
           public_url = excluded.public_url,
           tunnel = excluded.tunnel,
           updated_at = excluded.updated_at`,
      )
      .run(state.paused ? 1 : 0, state.public_url, state.tunnel, state.updated_at);

    return this.getBridgeState();
  }

  runInTransaction<T>(callback: () => T): T {
    const transaction = this.db.transaction(callback);
    return transaction();
  }

  close(): void {
    this.db.close();
  }
}
