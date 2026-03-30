import { parse } from 'yaml';
import type { CreateTaskInput, TaskPriority } from '../types.js';

interface ManifestTask {
  title: string;
  priority?: number;
  description?: string;
  dependencies?: string[];
  context?: Record<string, unknown>;
}

interface Manifest {
  project: string;
  tasks: ManifestTask[];
}

/**
 * Parse a riff.yaml manifest and return CreateTaskInput[].
 * Dependencies use titles as-is -- the caller resolves them to IDs after creation.
 */
export function parseManifest(content: string): { project: string; tasks: CreateTaskInput[] } {
  const doc = parse(content) as Manifest;

  if (!doc?.project) {
    throw new Error('manifest must include a "project" field');
  }

  if (!Array.isArray(doc.tasks) || doc.tasks.length === 0) {
    throw new Error('manifest must include at least one task');
  }

  const tasks: CreateTaskInput[] = doc.tasks.map((t) => {
    if (!t.title?.trim()) {
      throw new Error('each task must have a title');
    }

    const input: CreateTaskInput = { title: t.title };

    if (t.description !== undefined) input.description = t.description;
    if (t.context !== undefined) input.context = t.context;
    if (t.dependencies !== undefined) input.dependencies = t.dependencies;
    if (t.priority !== undefined) input.priority = t.priority as TaskPriority;

    return input;
  });

  return { project: doc.project, tasks };
}
