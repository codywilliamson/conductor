# Projects Feature Design

First-class project entity that namespaces tasks into separate boards. Lightweight but real — projects are a proper table with metadata, not just a string tag.

## Principles

TDD, DRY, KISS, YAGNI, SRP. Lean implementation, no speculative features.

## Data Model

### `projects` table

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | `proj_` + ULID |
| `name` | TEXT UNIQUE NOT NULL | human-friendly slug |
| `description` | TEXT | optional |
| `status` | TEXT | `active` / `archived`, default `active` |
| `created_at` | TEXT | ISO timestamp |

### `tasks` table changes

Add `project_id TEXT NOT NULL` with FK to `projects.id`.

New index: `idx_tasks_project_status` on `(project_id, status)`.

### Migration

Auto-create a `default` project. Backfill all existing tasks with its `id`.

### Agents

No schema change. Existing `scope` field can be set to a project name to restrict an agent to that project. Enforcement at claim time.

## Active Project

The CLI tracks the current active project in `~/.riff/active-project` (plain text file containing the project name). All task commands use this by default, with `--project` flag as override.

A built-in `default` project is auto-created on first run. If no active project is set, falls back to `default`.

## CLI

### New `riff project` commands

| Command | Description |
|---|---|
| `riff project create <name> [-d description]` | Create a project |
| `riff project list` | List active projects (`--all` includes archived) |
| `riff project use <name>` | Set active project |
| `riff project which` | Show current active project |
| `riff project archive <name>` | Archive a project |

### Existing commands

All task commands scope to the active project by default, with `--project` override:

- `riff add "title"` — creates in active project
- `riff list` / `riff board` / `riff review` — scoped to active project
- `riff approve <id>` / `riff feedback <id> <msg>` — task ID is sufficient (task already belongs to a project)

### Manifest import

`riff add --from riff.yaml` uses the manifest's `project` field to resolve or create the target project. Falls back to active project if the manifest has no `project` field.

## REST API

### Project routes

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/projects` | Create a project |
| `GET` | `/api/v1/projects` | List projects |
| `GET` | `/api/v1/projects/:project_id` | Get a project |
| `PATCH` | `/api/v1/projects/:project_id` | Update (name, description, status) |

### Task routes (nested under projects)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/projects/:project_id/tasks` | Create a task |
| `GET` | `/api/v1/projects/:project_id/tasks` | List tasks |
| `GET` | `/api/v1/projects/:project_id/tasks/:id` | Get a task |
| `POST` | `/api/v1/projects/:project_id/tasks/:id/claim` | Claim a task |
| `PATCH` | `/api/v1/projects/:project_id/tasks/:id/status` | Update status |
| `POST` | `/api/v1/projects/:project_id/tasks/:id/result` | Submit result |
| `GET` | `/api/v1/projects/:project_id/tasks/:id/feedback` | Get feedback |
| `POST` | `/api/v1/projects/:project_id/tasks/:id/feedback` | Give feedback |
| `POST` | `/api/v1/projects/:project_id/tasks/:id/approve` | Approve |

### Agent routes (unchanged, global)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/agents` | Register |
| `GET` | `/api/v1/agents` | List |
| `DELETE` | `/api/v1/agents/:agent_id` | Disconnect |

### Bridge hooks (nested under projects)

| Method | Endpoint |
|---|---|
| `POST` | `/api/v1/projects/:project_id/hooks/ingest` |
| `POST` | `/api/v1/projects/:project_id/hooks/feedback` |
| `GET` | `/api/v1/projects/:project_id/hooks/status` |

### Events

`GET /api/v1/events` stays global. Events carry `project_id` in task payloads. Optional `?project_id=` query param for server-side filtering.

## MCP Tools

All task tools add a required `project_id` param:

| Tool | Change |
|---|---|
| `riff_register` | unchanged |
| `riff_list_tasks` | add required `project_id` |
| `riff_claim_task` | add required `project_id` |
| `riff_update_status` | add required `project_id` |
| `riff_submit_result` | add required `project_id` |
| `riff_get_feedback` | add required `project_id` |

New tool:

| Tool | Description |
|---|---|
| `riff_list_projects` | List active projects |

Agent scope enforcement: when an agent has `scope` matching a project name, `riff_claim_task` rejects claims outside that project.

## Service Layer

### New `ProjectService`

- `create(input: { name, description? }): Project`
- `get(id: string): Project | null`
- `getByName(name: string): Project | null`
- `list(filter?: { status? }): Project[]`
- `update(id: string, input: { name?, description?, status? }): Project`

### `TaskService` changes

- `create()` requires `project_id`
- `list()` accepts `project_id` filter
- `claim()` validates agent scope against task's project when agent has scope set

### Store changes

- New project CRUD methods
- `createTask()` requires `project_id`
- `listTasks()` accepts `project_id` filter
- New composite index for project+status queries
