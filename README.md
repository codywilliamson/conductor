# Conductor

A lightweight daemon that coordinates AI agents around human-defined tasks.

## Quick Start

```bash
pnpm install && pnpm build        # build from source
conductor start                    # start the daemon on :7400
conductor add "Refactor auth module" -p 1  # create a task
conductor add --from conductor.yaml        # bulk import from manifest
conductor board                    # kanban view
conductor review                   # see tasks awaiting approval
conductor approve <task_id>        # approve a completed task
```

## Architecture

```
 Upstream Sources               Conductor Daemon              Downstream Agents
 ──────────────────     ────────────────────────────     ──────────────────────────
                        ┌──────────────────────────┐
  CLI (conductor add) ──┤                          ├──  Claude Code (MCP stdio)
                        │   SQLite   ←→  Services  │
  REST / Webhooks ──────┤                          ├──  Cursor / Agents (REST)
                        │   EventBus ←→  Hono API  │
  conductor.yaml ───────┤                          ├──  CI / Scripts (REST)
                        └──────────────────────────┘
```

Tasks flow in from the left (CLI, REST API, webhook, or YAML manifest), are stored in SQLite, and are consumed by agents on the right via MCP tools or REST endpoints. The daemon is the single source of truth.

## Core Concepts

### Task

| Field | Description |
|---|---|
| `id` | Auto-generated ULID (`task_...`) |
| `title` | Short description of the work |
| `status` | Current lifecycle status |
| `priority` | `0` (critical) to `3` (low), default `2` |
| `dependencies` | List of task IDs that must be `done` before this task can be claimed |
| `claimed_by` | Agent ID holding the task |
| `result` | Work product (`diff`, `pr_url`, `file`, or `text`) |

### Status Lifecycle

```
available ──→ claimed ──→ working ──→ review ──→ done
    ↑            │           │          │
    └────────────┴───────────┴──────────┘
                                        │
                 failed ←───────────────┘
                   │
                   └──→ available (retry)
```

- **available** -- ready to be claimed
- **claimed** -- locked by an agent
- **working** -- agent is actively working
- **review** -- result submitted, awaiting human approval
- **done** -- approved and complete
- **failed** -- can be retried (transitions back to available)

### Agent

Agents register with an `agent_id`, optional `runtime` label, `capabilities` list, and `scope`. When disconnected, their in-progress tasks are released back to `available`.

## Interfaces

### CLI

| Command | Description |
|---|---|
| `conductor start` | Start the HTTP daemon (default port 7400) |
| `conductor add <title>` | Create a task |
| `conductor add --from <file>` | Bulk import from YAML manifest |
| `conductor list [-s status]` | List tasks, optionally filtered |
| `conductor board` | Kanban board view |
| `conductor review` | Show tasks in review |
| `conductor approve <task_id>` | Approve a reviewed task |
| `conductor feedback <id> <msg>` | Send feedback (moves task back to working) |
| `conductor agents` | List connected agents |
| `conductor kick <agent_id>` | Disconnect an agent |

### REST API

Base path: `/api/v1`

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/agents` | Register an agent |
| `GET` | `/agents` | List agents |
| `DELETE` | `/agents/:agent_id` | Disconnect an agent |
| `POST` | `/tasks` | Create a task |
| `GET` | `/tasks` | List tasks (query: `status`, `priority_max`, `limit`) |
| `GET` | `/tasks/:id` | Get a task |
| `POST` | `/tasks/:id/claim` | Claim a task (`{ agent_id }`) |
| `PATCH` | `/tasks/:id/status` | Update status (`{ status, message? }`) |
| `POST` | `/tasks/:id/result` | Submit result (`{ result_type, result_data, summary? }`) |
| `GET` | `/tasks/:id/feedback` | Check for feedback |
| `POST` | `/tasks/:id/feedback` | Give feedback (`{ feedback }`) |
| `POST` | `/tasks/:id/approve` | Approve a task |
| `GET` | `/events` | SSE event stream |
| `POST` | `/hooks/ingest` | Webhook ingest (auto-creates a task) |

### MCP Server

Exposed via stdio transport. Tools available to MCP clients:

| Tool | Description |
|---|---|
| `conductor_register` | Register an agent session |
| `conductor_list_tasks` | List tasks (filterable by status, priority, scope) |
| `conductor_claim_task` | Atomically claim a task |
| `conductor_update_status` | Push a status transition |
| `conductor_submit_result` | Submit work product |
| `conductor_get_feedback` | Check for human review feedback |

## Manifest File

Bulk-import tasks from a `conductor.yaml`:

```yaml
project: my-project
tasks:
  - title: Set up database schema
    priority: 0
    description: Create initial migration files
  - title: Build API endpoints
    priority: 1
    dependencies:
      - Set up database schema
  - title: Write tests
    priority: 2
    dependencies:
      - Build API endpoints
```

Dependencies reference other tasks by title and are resolved to IDs on import.

## Configuration

Add Conductor as an MCP server in your Claude Code config (or any MCP-compatible client):

```json
{
  "mcpServers": {
    "conductor": {
      "command": "node",
      "args": ["dist/mcp/stdio.js"],
      "env": {
        "CONDUCTOR_DB": "~/.conductor/conductor.db"
      }
    }
  }
}
```

The `CONDUCTOR_DB` env var controls the database path (defaults to `conductor.db` in the working directory).

## License

MIT
