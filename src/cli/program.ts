import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { Command } from 'commander';
import { Store } from '../store/store.js';
import { ApiKeyService } from '../bridge/api-key-service.js';
import { startTunnel, type TunnelHandle } from '../bridge/tunnel.js';
import { loadConfig, type RiffConfig } from '../config/config.js';
import { formatTask, formatBoard, formatAgents } from './format.js';
import { parseManifest } from '../connectors/manifest.js';
import type { BridgeTunnel, TaskPriority, TaskStatus } from '../types.js';
import { startServer } from '../api/server.js';

const DEFAULT_DATA_DIR = join(homedir(), '.riff');
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

type Writer = (line: string) => void;

export interface CliDeps {
  cwd?: string;
  homeDir?: string;
  now?: () => Date;
  writeOut?: Writer;
  writeErr?: Writer;
  startServer?: typeof startServer;
  startTunnel?: (options: {
    tunnel: BridgeTunnel;
    port: number;
    hostname?: string;
  }) => Promise<TunnelHandle | null>;
}

export function createProgram(deps: CliDeps = {}): Command {
  const cwd = deps.cwd ?? process.cwd();
  const homeDir = deps.homeDir ?? homedir();
  const now = deps.now ?? (() => new Date());
  const writeOut = deps.writeOut ?? ((line: string) => console.log(line));
  const writeErr = deps.writeErr ?? ((line: string) => console.error(line));
  const startServerFn = deps.startServer ?? startServer;
  const startTunnelFn = deps.startTunnel ?? startTunnel;

  const program = new Command();

  program.name('riff').description('Coordinate AI agents around human-defined work').version('0.1.0');

  program
    .command('start')
    .description('Start the HTTP daemon')
    .option('-p, --port <port>', 'port to listen on')
    .option('-d, --data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .option('--bridge', 'enable the webhook bridge')
    .option('--tunnel <provider>', 'tunnel provider (cloudflare|ngrok|tailscale|none)')
    .action(async (opts) => {
      const runtime = getRuntime(opts.dataDir, cwd, homeDir);
      const port = opts.port ? parseInt(opts.port, 10) : runtime.config.port;
      const bridgeEnabled = Boolean(opts.bridge) || runtime.config.bridge.enabled;
      const tunnel = (opts.tunnel ?? runtime.config.bridge.tunnel) as BridgeTunnel;
      const config: RiffConfig = {
        ...runtime.config,
        port,
        store: runtime.dbPath,
        bridge: {
          ...runtime.config.bridge,
          enabled: bridgeEnabled,
          tunnel,
        },
      };

      ensureDirectory(dirname(runtime.dbPath));
      const store = new Store(runtime.dbPath);
      const server = await startServerFn({ port, store, config });
      let tunnelHandle: TunnelHandle | null = null;

      if (bridgeEnabled) {
        tunnelHandle = await startTunnelFn({
          tunnel,
          port,
          hostname: config.bridge.hostname,
        });

        store.setBridgeState({
          paused: false,
          public_url: resolveBridgeUrl(config, port, tunnelHandle?.publicUrl ?? null),
          tunnel,
          updated_at: now().toISOString(),
        });
      } else {
        store.setBridgeState({
          paused: false,
          public_url: null,
          tunnel: null,
          updated_at: now().toISOString(),
        });
      }

      writeOut(`Riff daemon started on localhost:${port}`);
      if (bridgeEnabled) {
        const publicUrl = resolveBridgeUrl(config, port, tunnelHandle?.publicUrl ?? null);
        writeOut(`Bridge active: ${publicUrl ?? 'tunnel started, URL pending'}`);
      }

      const shutdown = () => {
        tunnelHandle?.stop();
        server.close();
        process.exit(0);
      };

      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    });

  program
    .command('stop')
    .description('Stop the daemon')
    .action(() => {
      writeOut('To stop Riff, press Ctrl+C in the terminal running "riff start".');
    });

  program
    .command('add [title]')
    .description('Create a task (or bulk import from YAML manifest)')
    .option('-p, --priority <n>', 'priority (0-3)', '2')
    .option('-s, --scope <scope>', 'scope')
    .option('-d, --description <desc>', 'description')
    .option('--from <file>', 'import tasks from a YAML manifest file')
    .option('--project <name>', 'target project (overrides active project)')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((title, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);

      try {
        if (opts.from) {
          const content = readFileSync(opts.from, 'utf-8');
          const manifest = parseManifest(content);
          const resolvedDataDir = resolve(cwd, opts.dataDir);
          const projectName = opts.project ?? manifest.project;
          let projectId: string;
          if (projectName) {
            const project = store.getProjectByName(projectName) ?? store.createProject({ name: projectName });
            projectId = project.id;
          } else {
            projectId = resolveProjectId(store, resolvedDataDir);
          }
          const titleToId = new Map<string, string>();

          for (const taskInput of manifest.tasks) {
            const resolvedDeps = taskInput.dependencies?.map((dependency) => {
              const existing = titleToId.get(dependency);
              if (!existing) {
                writeErr(`warning: dependency "${dependency}" not found in manifest (yet)`);
                return dependency;
              }
              return existing;
            });

            const task = store.createTask({
              ...taskInput,
              dependencies: resolvedDeps ?? taskInput.dependencies,
              project_id: projectId,
            });
            titleToId.set(task.title, task.id);
          }

          writeOut(`Imported ${manifest.tasks.length} tasks from ${manifest.project ?? projectName ?? 'default'}`);
          for (const [taskTitle, id] of titleToId) {
            writeOut(`  ${id} ${taskTitle}`);
          }
          return;
        }

        if (!title) {
          throw new Error('title is required (or use --from for manifest import)');
        }

        const resolvedDataDir = resolve(cwd, opts.dataDir);
        const projectId = resolveProjectId(store, resolvedDataDir, opts.project);
        const task = store.createTask({
          title,
          description: opts.description,
          priority: parseInt(opts.priority, 10) as TaskPriority,
          scope: opts.scope,
          project_id: projectId,
        });
        writeOut(formatTask(task));
      } finally {
        store.close();
      }
    });

  program
    .command('list')
    .description('List tasks')
    .option('-s, --status <status>', 'filter by status')
    .option('-l, --limit <n>', 'max results', '50')
    .option('--project <name>', 'target project (overrides active project)')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);

      try {
        const resolvedDataDir = resolve(cwd, opts.dataDir);
        const projectId = resolveProjectId(store, resolvedDataDir, opts.project);
        const tasks = store.listTasks({
          status: opts.status as TaskStatus | undefined,
          limit: parseInt(opts.limit, 10),
          project_id: projectId,
        });

        if (tasks.length === 0) {
          writeOut('No tasks found.');
          return;
        }

        tasks.forEach((task, index) => {
          writeOut(formatTask(task));
          if (index < tasks.length - 1) {
            writeOut('');
          }
        });
        writeOut(`${tasks.length} task(s)`);
      } finally {
        store.close();
      }
    });

  program
    .command('board')
    .description('Pretty-print a kanban board view')
    .option('--project <name>', 'target project (overrides active project)')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const resolvedDataDir = resolve(cwd, opts.dataDir);
        const projectId = resolveProjectId(store, resolvedDataDir, opts.project);
        writeOut(formatBoard(store.listTasks({ limit: 200, project_id: projectId })));
      } finally {
        store.close();
      }
    });

  program
    .command('review')
    .description('Show tasks in review status')
    .option('--project <name>', 'target project (overrides active project)')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const resolvedDataDir = resolve(cwd, opts.dataDir);
        const projectId = resolveProjectId(store, resolvedDataDir, opts.project);
        const tasks = store.listTasks({ status: 'review', project_id: projectId });
        if (tasks.length === 0) {
          writeOut('No tasks in review.');
          return;
        }

        tasks.forEach((task, index) => {
          writeOut(formatTask(task));
          if (index < tasks.length - 1) {
            writeOut('');
          }
        });
      } finally {
        store.close();
      }
    });

  program
    .command('approve <task_id>')
    .description('Approve a task in review')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((taskId, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const task = store.getTask(taskId);
        if (!task) {
          throw new Error(`Task ${taskId} not found.`);
        }
        if (task.status !== 'review') {
          throw new Error(`Task is ${task.status}, must be in review to approve.`);
        }

        store.updateTaskStatus(taskId, 'done');
        const updated = store.getTask(taskId)!;
        writeOut(`Approved: ${updated.title}`);
        writeOut(formatTask(updated));
      } finally {
        store.close();
      }
    });

  program
    .command('feedback <task_id> <message>')
    .description('Give feedback on a task in review')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((taskId, message, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const task = store.getTask(taskId);
        if (!task) {
          throw new Error(`Task ${taskId} not found.`);
        }
        if (task.status !== 'review') {
          throw new Error(`Task is ${task.status}, must be in review to give feedback.`);
        }

        store.setTaskFeedback(taskId, message);
        store.updateTaskStatus(taskId, 'working');
        writeOut('Feedback sent, task moved back to working.');
        writeOut(formatTask(store.getTask(taskId)!));
      } finally {
        store.close();
      }
    });

  program
    .command('agents')
    .description('List connected agents')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        writeOut(formatAgents(store.listAgents()));
      } finally {
        store.close();
      }
    });

  program
    .command('kick <agent_id>')
    .description('Disconnect an agent')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((agentId, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        if (!store.removeAgent(agentId)) {
          throw new Error(`Agent ${agentId} not found.`);
        }
        writeOut(`Agent ${agentId} disconnected.`);
      } finally {
        store.close();
      }
    });

  const keys = program.command('keys').description('Manage bridge API keys');

  keys
    .command('create')
    .requiredOption('--name <name>', 'key name')
    .requiredOption('--scopes <scopes>', 'comma-separated scopes')
    .option('--expires <duration>', 'optional expiry (for example 30d)')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const apiKeys = new ApiKeyService(store, { now });
        const created = apiKeys.create({
          name: opts.name,
          scopes: parseScopes(opts.scopes),
          expiresIn: opts.expires,
        });

        writeOut(`Key created: ${created.plaintext}`);
        writeOut(`Name: ${created.key.name}`);
        writeOut(`Scopes: ${created.key.scopes.join(', ')}`);
        writeOut(`Expires: ${created.key.expires_at ?? 'never'}`);
        writeOut("Save this key now; it won't be shown again.");
      } finally {
        store.close();
      }
    });

  keys
    .command('list')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const apiKeys = new ApiKeyService(store, { now }).list();
        if (apiKeys.length === 0) {
          writeOut('No active keys.');
          return;
        }

        apiKeys.forEach((key) => {
          writeOut(
            `${key.name} | scopes: ${key.scopes.join(', ')} | created: ${key.created_at} | last used: ${key.last_used ?? 'never'}`,
          );
        });
      } finally {
        store.close();
      }
    });

  keys
    .command('revoke <name>')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((name, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const apiKeys = new ApiKeyService(store, { now });
        if (!apiKeys.revoke(name)) {
          throw new Error(`api key "${name}" not found`);
        }
        writeOut(`Revoked key: ${name}`);
      } finally {
        store.close();
      }
    });

  keys
    .command('rotate <name>')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((name, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const apiKeys = new ApiKeyService(store, { now });
        const rotated = apiKeys.rotate(name);
        writeOut(`Key rotated: ${rotated.plaintext}`);
        writeOut(`Name: ${rotated.key.name}`);
        writeOut(`Scopes: ${rotated.key.scopes.join(', ')}`);
        writeOut(`Expires: ${rotated.key.expires_at ?? 'never'}`);
        writeOut("Save this key now; it won't be shown again.");
      } finally {
        store.close();
      }
    });

  const bridge = program.command('bridge').description('Manage the webhook bridge');

  bridge
    .command('status')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const apiKeys = new ApiKeyService(store, { now }).list();
        const state = store.getBridgeState();
        const lastRequest = store.getLatestBridgeRequest();
        const requestsToday = store.countAllBridgeRequestsSince(startOfDay(now()).toISOString());
        const bridgeState = state.paused ? 'paused' : state.tunnel ? 'active' : 'inactive';

        writeOut(`Bridge: ${bridgeState}`);
        writeOut(`URL: ${state.public_url ?? 'not configured'}`);
        writeOut(`Active keys: ${apiKeys.length}`);
        writeOut(`Requests today: ${requestsToday}`);
        writeOut(
          `Last request: ${lastRequest ? `${formatAge(lastRequest.created_at, now())} ago from "${lastRequest.key_name}"` : 'never'}`,
        );
      } finally {
        store.close();
      }
    });

  bridge
    .command('log')
    .option('--key <name>', 'filter by key name')
    .option('--last <n>', 'number of requests to show', '20')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const entries = store.listBridgeRequests({
          keyName: opts.key,
          limit: parseInt(opts.last, 10),
        });

        if (entries.length === 0) {
          writeOut('No bridge requests recorded.');
          return;
        }

        entries.forEach((entry) => {
          writeOut(
            `${entry.created_at} ${entry.status_code} ${entry.method} ${entry.path} ${entry.ip} ${entry.key_name}`,
          );
        });
      } finally {
        store.close();
      }
    });

  bridge
    .command('pause')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const state = store.getBridgeState();
        store.setBridgeState({
          ...state,
          paused: true,
          updated_at: now().toISOString(),
        });
        writeOut('Bridge paused.');
      } finally {
        store.close();
      }
    });

  bridge
    .command('resume')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const state = store.getBridgeState();
        store.setBridgeState({
          ...state,
          paused: false,
          updated_at: now().toISOString(),
        });
        writeOut('Bridge resumed.');
      } finally {
        store.close();
      }
    });

  const project = program.command('project').description('Manage projects');

  project
    .command('create <name>')
    .description('Create a new project')
    .option('-d, --description <desc>', 'project description')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((name, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const created = store.createProject({ name, description: opts.description });
        writeOut(`Created project: ${created.name} (${created.id})`);
      } finally {
        store.close();
      }
    });

  project
    .command('list')
    .description('List projects')
    .option('--all', 'include archived projects')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const projects = store.listProjects({ includeArchived: opts.all });
        if (projects.length === 0) {
          writeOut('No projects found.');
          return;
        }
        const resolvedDataDir = resolve(cwd, opts.dataDir);
        const activeProjectName = readActiveProject(resolvedDataDir);
        for (const p of projects) {
          const marker = p.name === activeProjectName ? ' *' : '';
          const status = p.status === 'archived' ? ' (archived)' : '';
          writeOut(`${p.name}${marker}${status}  ${dim(p.id)}`);
        }
      } finally {
        store.close();
      }
    });

  project
    .command('use <name>')
    .description('Set the active project')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((name, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const found = store.getProjectByName(name);
        if (!found) throw new Error(`project "${name}" not found`);
        writeActiveProject(resolve(cwd, opts.dataDir), name);
        writeOut(`Active project: ${name}`);
      } finally {
        store.close();
      }
    });

  project
    .command('which')
    .description('Show the current active project')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((opts) => {
      const name = readActiveProject(resolve(cwd, opts.dataDir)) ?? 'default';
      writeOut(name);
    });

  project
    .command('archive <name>')
    .description('Archive a project')
    .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
    .action((name, opts) => {
      const store = openStore(opts.dataDir, cwd, homeDir);
      try {
        const found = store.getProjectByName(name);
        if (!found) throw new Error(`project "${name}" not found`);
        store.updateProject(found.id, { status: 'archived' });
        writeOut(`Archived project: ${name}`);
      } finally {
        store.close();
      }
    });

  program.exitOverride();
  program.configureOutput({
    writeErr: (line) => writeErr(line.trimEnd()),
  });

  return program;
}

function openStore(dataDir: string, cwd: string, homeDir: string): Store {
  const runtime = getRuntime(dataDir, cwd, homeDir);
  ensureDirectory(dirname(runtime.dbPath));
  return new Store(runtime.dbPath);
}

function getRuntime(dataDir: string, cwd: string, homeDir: string): { config: RiffConfig; dbPath: string } {
  const resolvedDataDir = resolve(cwd, dataDir);
  const config = loadConfig({
    cwd,
    homeDir,
    defaultStore: join(resolvedDataDir, 'riff.db'),
  });

  return {
    config,
    dbPath: dataDir === DEFAULT_DATA_DIR ? config.store : join(resolvedDataDir, 'riff.db'),
  };
}

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function parseScopes(value: string): string[] {
  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function resolveBridgeUrl(
  config: RiffConfig,
  port: number,
  tunnelUrl: string | null,
): string | null {
  if (config.bridge.hostname) {
    return `https://${config.bridge.hostname}`;
  }

  if (tunnelUrl) {
    return tunnelUrl;
  }

  if (config.bridge.tunnel === 'none') {
    return `http://${config.bridge.bind ?? '0.0.0.0'}:${port}`;
  }

  return null;
}

function startOfDay(date: Date): Date {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  return dayStart;
}

function formatAge(timestamp: string, currentTime: Date): string {
  const diffMs = Math.max(0, currentTime.getTime() - new Date(timestamp).getTime());
  if (diffMs < 60_000) {
    return `${Math.floor(diffMs / 1_000)}s`;
  }
  if (diffMs < 3_600_000) {
    return `${Math.floor(diffMs / 60_000)}m`;
  }
  if (diffMs < 86_400_000) {
    return `${Math.floor(diffMs / 3_600_000)}h`;
  }
  return `${Math.floor(diffMs / 86_400_000)}d`;
}

function getActiveProjectFile(resolvedDataDir: string): string {
  return join(resolvedDataDir, 'active-project');
}

function readActiveProject(resolvedDataDir: string): string | null {
  const file = getActiveProjectFile(resolvedDataDir);
  if (!existsSync(file)) return null;
  const content = readFileSync(file, 'utf-8').trim();
  return content || null;
}

function writeActiveProject(resolvedDataDir: string, name: string): void {
  mkdirSync(dirname(getActiveProjectFile(resolvedDataDir)), { recursive: true });
  writeFileSync(getActiveProjectFile(resolvedDataDir), name, 'utf-8');
}

function resolveProjectId(store: Store, resolvedDataDir: string, projectOverride?: string): string {
  const projectName = projectOverride ?? readActiveProject(resolvedDataDir) ?? 'default';
  const project = store.getProjectByName(projectName);
  if (!project) throw new Error(`project "${projectName}" not found`);
  return project.id;
}
