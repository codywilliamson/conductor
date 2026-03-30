import type { Task, Agent, TaskStatus } from '../types.js';

// ansi helpers
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

const PRIORITY_ICONS: Record<number, string> = {
  0: red('!!!'),
  1: yellow('!! '),
  2: blue('!  '),
  3: dim('.  '),
};

const STATUS_COLORS: Record<TaskStatus, (s: string) => string> = {
  available: cyan,
  claimed: yellow,
  working: magenta,
  review: blue,
  done: green,
  failed: red,
};

export function formatTask(task: Task): string {
  const pri = PRIORITY_ICONS[task.priority] ?? dim('.  ');
  const statusColor = STATUS_COLORS[task.status] ?? dim;
  const lines: string[] = [];

  lines.push(`${pri} ${bold(task.title)} ${statusColor(`[${task.status}]`)}`);
  lines.push(`   ${dim('id:')} ${task.id}`);

  if (task.description) {
    const desc = task.description.length > 80 ? task.description.slice(0, 77) + '...' : task.description;
    lines.push(`   ${dim('desc:')} ${desc}`);
  }

  if (task.claimed_by) {
    lines.push(`   ${dim('agent:')} ${task.claimed_by}`);
  }

  if (task.dependencies.length > 0) {
    lines.push(`   ${dim('deps:')} ${task.dependencies.join(', ')}`);
  }

  return lines.join('\n');
}

export function formatBoard(tasks: Task[]): string {
  const columns: TaskStatus[] = ['available', 'claimed', 'working', 'review', 'done', 'failed'];
  const grouped = new Map<TaskStatus, Task[]>();

  for (const col of columns) {
    grouped.set(col, []);
  }

  for (const task of tasks) {
    grouped.get(task.status)?.push(task);
  }

  const lines: string[] = [bold('--- Kanban Board ---'), ''];

  for (const col of columns) {
    const colTasks = grouped.get(col)!;
    const statusColor = STATUS_COLORS[col];
    const header = statusColor(col.toUpperCase());
    const count = dim(`(${colTasks.length})`);

    lines.push(`${bold(header)} ${count}`);

    if (colTasks.length === 0) {
      lines.push(`  ${dim('(empty)')}`);
    } else {
      for (const t of colTasks) {
        const pri = PRIORITY_ICONS[t.priority] ?? dim('.');
        lines.push(`  ${pri} ${t.title} ${dim(t.id)}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

export function formatAgents(agents: Agent[]): string {
  if (agents.length === 0) {
    return dim('No agents connected.');
  }

  const lines: string[] = [bold('--- Agents ---'), ''];

  for (const a of agents) {
    const statusColor = a.status === 'idle' ? green : a.status === 'working' ? yellow : red;
    lines.push(`${bold(a.agent_id)} ${statusColor(`[${a.status}]`)}`);

    if (a.runtime) {
      lines.push(`  ${dim('runtime:')} ${a.runtime}`);
    }

    if (a.capabilities.length > 0) {
      lines.push(`  ${dim('capabilities:')} ${a.capabilities.join(', ')}`);
    }

    if (a.scope) {
      lines.push(`  ${dim('scope:')} ${a.scope}`);
    }

    lines.push(`  ${dim('connected:')} ${a.connected_at}`);
    lines.push('');
  }

  return lines.join('\n');
}
