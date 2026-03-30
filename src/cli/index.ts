import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Command } from 'commander';
import { Store } from '../store/store.js';
import { formatTask, formatBoard, formatAgents } from './format.js';
import { parseManifest } from '../connectors/manifest.js';
import type { TaskStatus, TaskPriority } from '../types.js';

const DEFAULT_PORT = 7400;
const DEFAULT_DATA_DIR = join(homedir(), '.conductor');

function ensureDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function getStore(dataDir: string): Store {
  ensureDataDir(dataDir);
  return new Store(join(dataDir, 'conductor.db'));
}

const program = new Command();

program
  .name('conductor')
  .description('Coordinate AI agents around human-defined work')
  .version('0.1.0');

// --- start ---
program
  .command('start')
  .description('Start the HTTP daemon')
  .option('-p, --port <port>', 'port to listen on', String(DEFAULT_PORT))
  .option('-d, --data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action(async (opts) => {
    const port = parseInt(opts.port, 10);
    const dataDir: string = opts.dataDir;
    ensureDataDir(dataDir);
    const dbPath = join(dataDir, 'conductor.db');

    const { startServer } = await import('../api/server.js');
    await startServer(port, dbPath);

    console.log(`Conductor listening on http://localhost:${port}`);
  });

// --- stop ---
program
  .command('stop')
  .description('Stop the daemon')
  .action(() => {
    console.log('To stop Conductor, press Ctrl+C in the terminal running "conductor start".');
  });

// --- add ---
program
  .command('add [title]')
  .description('Create a task (or bulk import from YAML manifest)')
  .option('-p, --priority <n>', 'priority (0-3)', '2')
  .option('-s, --scope <scope>', 'scope')
  .option('-d, --description <desc>', 'description')
  .option('--from <file>', 'import tasks from a YAML manifest file')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((title, opts) => {
    const store = getStore(opts.dataDir);

    try {
      if (opts.from) {
        // bulk import from manifest
        const content = readFileSync(opts.from, 'utf-8');
        const manifest = parseManifest(content);

        // create tasks, resolving title-based dependencies to IDs as we go
        const titleToId = new Map<string, string>();

        for (const taskInput of manifest.tasks) {
          // resolve dependencies from titles to IDs of already-created tasks
          let resolvedDeps: string[] | undefined;
          if (taskInput.dependencies?.length) {
            resolvedDeps = taskInput.dependencies.map((dep) => {
              const depId = titleToId.get(dep);
              if (!depId) {
                console.warn(`  warning: dependency "${dep}" not found in manifest (yet)`);
                return dep;
              }
              return depId;
            });
          }

          const task = store.createTask({
            ...taskInput,
            dependencies: resolvedDeps ?? taskInput.dependencies,
          });
          titleToId.set(task.title, task.id);
        }

        console.log(`Imported ${manifest.tasks.length} tasks from ${manifest.project}`);

        for (const [taskTitle, id] of titleToId) {
          console.log(`  ${id} ${taskTitle}`);
        }
      } else {
        if (!title) {
          console.error('Error: title is required (or use --from for manifest import)');
          process.exit(1);
        }

        const task = store.createTask({
          title,
          description: opts.description,
          priority: parseInt(opts.priority, 10) as TaskPriority,
          context: opts.scope ? { scope: opts.scope } : undefined,
        });

        console.log(formatTask(task));
      }
    } finally {
      store.close();
    }
  });

// --- list ---
program
  .command('list')
  .description('List tasks')
  .option('-s, --status <status>', 'filter by status')
  .option('-l, --limit <n>', 'max results', '50')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((opts) => {
    const store = getStore(opts.dataDir);

    try {
      const tasks = store.listTasks({
        status: opts.status as TaskStatus | undefined,
        limit: parseInt(opts.limit, 10),
      });

      if (tasks.length === 0) {
        console.log('No tasks found.');
        return;
      }

      for (const task of tasks) {
        console.log(formatTask(task));
        console.log('');
      }

      console.log(`${tasks.length} task(s)`);
    } finally {
      store.close();
    }
  });

// --- board ---
program
  .command('board')
  .description('Pretty-print a kanban board view')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((opts) => {
    const store = getStore(opts.dataDir);

    try {
      const tasks = store.listTasks({ limit: 200 });
      console.log(formatBoard(tasks));
    } finally {
      store.close();
    }
  });

// --- review ---
program
  .command('review')
  .description('Show tasks in review status')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((opts) => {
    const store = getStore(opts.dataDir);

    try {
      const tasks = store.listTasks({ status: 'review' });

      if (tasks.length === 0) {
        console.log('No tasks in review.');
        return;
      }

      for (const task of tasks) {
        console.log(formatTask(task));
        console.log('');
      }
    } finally {
      store.close();
    }
  });

// --- approve ---
program
  .command('approve <task_id>')
  .description('Approve a task in review')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((taskId, opts) => {
    const store = getStore(opts.dataDir);

    try {
      const task = store.getTask(taskId);
      if (!task) {
        console.error(`Task ${taskId} not found.`);
        process.exit(1);
      }

      if (task.status !== 'review') {
        console.error(`Task is ${task.status}, must be in review to approve.`);
        process.exit(1);
      }

      store.updateTaskStatus(taskId, 'done');
      const updated = store.getTask(taskId)!;
      console.log(`Approved: ${updated.title}`);
      console.log(formatTask(updated));
    } finally {
      store.close();
    }
  });

// --- feedback ---
program
  .command('feedback <task_id> <message>')
  .description('Give feedback on a task in review')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((taskId, message, opts) => {
    const store = getStore(opts.dataDir);

    try {
      const task = store.getTask(taskId);
      if (!task) {
        console.error(`Task ${taskId} not found.`);
        process.exit(1);
      }

      if (task.status !== 'review') {
        console.error(`Task is ${task.status}, must be in review to give feedback.`);
        process.exit(1);
      }

      store.setTaskFeedback(taskId, message);
      store.updateTaskStatus(taskId, 'working');

      const updated = store.getTask(taskId)!;
      console.log(`Feedback sent, task moved back to working.`);
      console.log(formatTask(updated));
    } finally {
      store.close();
    }
  });

// --- agents ---
program
  .command('agents')
  .description('List connected agents')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((opts) => {
    const store = getStore(opts.dataDir);

    try {
      const agents = store.listAgents();
      console.log(formatAgents(agents));
    } finally {
      store.close();
    }
  });

// --- kick ---
program
  .command('kick <agent_id>')
  .description('Disconnect an agent')
  .option('--data-dir <dir>', 'data directory', DEFAULT_DATA_DIR)
  .action((agentId, opts) => {
    const store = getStore(opts.dataDir);

    try {
      const removed = store.removeAgent(agentId);
      if (removed) {
        console.log(`Agent ${agentId} disconnected.`);
      } else {
        console.error(`Agent ${agentId} not found.`);
        process.exit(1);
      }
    } finally {
      store.close();
    }
  });

program.parse();
