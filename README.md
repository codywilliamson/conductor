# Riff

A lightweight daemon that coordinates AI agents around human-defined tasks.

## Quick Start

```bash
pnpm install && pnpm build        # build from source
riff start                    # start the daemon on :7400
riff add "Refactor auth module" -p 1  # create a task
riff add --from riff.yaml        # bulk import from manifest
riff board                    # kanban view
riff review                   # see tasks awaiting approval
riff approve <task_id>        # approve a completed task
```

## Architecture

```
 Upstream Sources               Riff Daemon              Downstream Agents
 ──────────────────     ────────────────────────────     ──────────────────────────
                        ┌──────────────────────────┐
  CLI (riff add) ──┤                          ├──  Claude Code (MCP stdio)
                        │   SQLite   ←→  Services  │
  REST / Webhooks ──────┤                          ├──  Cursor / Agents (REST)
                        │   EventBus ←→  Hono API  │
  riff.yaml ───────┤                          ├──  CI / Scripts (REST)
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
| `riff start` | Start the HTTP daemon (default port 7400) |
| `riff add <title>` | Create a task |
| `riff add --from <file>` | Bulk import from YAML manifest |
| `riff list [-s status]` | List tasks, optionally filtered |
| `riff board` | Kanban board view |
| `riff review` | Show tasks in review |
| `riff approve <task_id>` | Approve a reviewed task |
| `riff feedback <id> <msg>` | Send feedback (moves task back to working) |
| `riff agents` | List connected agents |
| `riff kick <agent_id>` | Disconnect an agent |
| `riff keys create/list/revoke/rotate` | Manage bridge API keys |
| `riff bridge status/log/pause/resume` | Inspect and control the webhook bridge |

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

## Webhook Bridge

Riff can expose authenticated remote endpoints through a tunnel so cloud agents, CI, or bots can create and update work on your local board.

```bash
riff keys create --name "claude-ai" --scopes "tasks:write,tasks:read,feedback:write"
riff start --bridge
riff bridge status
```

Bridge keys are stored hashed in SQLite, remote REST access is scope-gated, and localhost access remains unauthenticated by default. Remote requests are audited in the bridge request log and rate-limited per key.

Key bridge endpoints:

| Method | Endpoint | Scope |
|---|---|---|
| `POST` | `/api/v1/hooks/ingest` | `tasks:write` |
| `POST` | `/api/v1/hooks/feedback` | `feedback:write` |
| `GET` | `/api/v1/hooks/status` | `tasks:read` |
| `GET` | `/api/v1/events` | `events:read` |

Example config:

```yaml
port: 7400
store: ./riff.db

bridge:
  enabled: true
  tunnel: cloudflare
  hostname: riff.yourdomain.com
  rate_limit:
    default: 60
    per_key:
      github-actions: 120
  ip_allowlist: []
  max_body_size: 1mb
  cors:
    origins:
      - https://claude.ai
      - https://chatgpt.com
```

### MCP Server

Exposed via stdio transport. Tools available to MCP clients:

| Tool | Description |
|---|---|
| `riff_register` | Register an agent session |
| `riff_list_tasks` | List tasks (filterable by status, priority, scope) |
| `riff_claim_task` | Atomically claim a task |
| `riff_update_status` | Push a status transition |
| `riff_submit_result` | Submit work product |
| `riff_get_feedback` | Check for human review feedback |

## Manifest File

Bulk-import tasks from a `riff.yaml`:

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

Add Riff as an MCP server in your Claude Code config (or any MCP-compatible client):

```json
{
  "mcpServers": {
    "riff": {
      "command": "node",
      "args": ["dist/mcp/stdio.js"],
      "env": {
        "RIFF_DB": "~/.conductor/riff.db"
      }
    }
  }
}
```

The `RIFF_DB` env var controls the database path (defaults to `riff.db` in the working directory).

## License

MIT
