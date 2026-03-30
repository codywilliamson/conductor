import type { Store } from '../store/store.js';
import type { EventBus } from '../events/event-bus.js';
import type {
  Task,
  TaskStatus,
  CreateTaskInput,
  TaskFilter,
  ResultType,
} from '../types.js';
import { VALID_TRANSITIONS } from '../types.js';

export class TaskService {
  constructor(
    private store: Store,
    private events: EventBus,
  ) {}

  create(input: CreateTaskInput): Task {
    if (!input.title?.trim()) {
      throw new Error('title is required');
    }
    const task = this.store.createTask(input);
    this.events.emit('task.created', { task });
    return task;
  }

  createBatch(inputs: CreateTaskInput[]): Task[] {
    if (inputs.length === 0) {
      throw new Error('tasks are required');
    }

    inputs.forEach((input) => {
      if (!input.title?.trim()) {
        throw new Error('title is required');
      }
    });

    const tasks = this.store.runInTransaction(() => {
      const created = inputs.map((input) =>
        this.store.createTask({
          ...input,
          dependencies: [],
        }),
      );

      created.forEach((task, index) => {
        const dependencies = (inputs[index].dependencies ?? []).map((dependency) =>
          this.resolveDependency(dependency, created),
        );
        this.store.updateTaskDependencies(task.id, dependencies);
      });

      return created.map((task) => this.store.getTask(task.id)!);
    });

    tasks.forEach((task) => this.events.emit('task.created', { task }));
    return tasks;
  }

  get(id: string): Task | null {
    return this.store.getTask(id);
  }

  list(filter: TaskFilter = {}): Task[] {
    return this.store.listTasks(filter);
  }

  claim(taskId: string, agentId: string): Task {
    const task = this.store.claimTask(taskId, agentId);
    if (!task) {
      const existing = this.store.getTask(taskId);
      if (!existing) throw new Error('task not found');
      if (existing.status !== 'available') {
        throw new Error(`task is ${existing.status}, not available`);
      }
      throw new Error('task has unmet dependencies');
    }
    this.events.emit('task.claimed', { task, agent_id: agentId });
    return task;
  }

  updateStatus(taskId: string, status: TaskStatus, message?: string): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('task not found');

    if (!VALID_TRANSITIONS[task.status].includes(status)) {
      throw new Error(`invalid transition: ${task.status} → ${status}`);
    }

    this.store.updateTaskStatus(taskId, status);

    if (status === 'failed') {
      this.events.emit('task.failed', { task_id: taskId, message });
    } else if (status === 'done') {
      this.events.emit('task.completed', { task_id: taskId });
    } else {
      this.events.emit('task.status_changed', { task_id: taskId, status, message });
    }

    return this.store.getTask(taskId)!;
  }

  submitResult(
    taskId: string,
    resultType: ResultType,
    resultData: string,
    summary?: string,
  ): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('task not found');
    if (task.status !== 'working') {
      throw new Error(`task is ${task.status}, must be working to submit result`);
    }

    this.store.setTaskResult(taskId, {
      result_type: resultType,
      result_data: resultData,
      summary: summary ?? null,
    });

    this.events.emit('task.result_submitted', { task_id: taskId, result_type: resultType });
    return this.store.getTask(taskId)!;
  }

  getFeedback(taskId: string): { has_feedback: boolean; feedback: string | null } {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('task not found');

    const feedback = this.store.getTaskFeedback(taskId);
    return { has_feedback: feedback !== null, feedback };
  }

  giveFeedback(taskId: string, feedback: string): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('task not found');
    if (task.status !== 'review') {
      throw new Error(`task is ${task.status}, must be in review to give feedback`);
    }

    this.store.setTaskFeedback(taskId, feedback);
    // move back to working so agent can address feedback
    this.store.updateTaskStatus(taskId, 'working');

    this.events.emit('task.feedback_given', { task_id: taskId, feedback });
    return this.store.getTask(taskId)!;
  }

  approve(taskId: string): Task {
    const task = this.store.getTask(taskId);
    if (!task) throw new Error('task not found');
    if (task.status !== 'review') {
      throw new Error(`task is ${task.status}, must be in review to approve`);
    }

    this.store.updateTaskStatus(taskId, 'done');
    this.events.emit('task.completed', { task_id: taskId });
    return this.store.getTask(taskId)!;
  }

  private resolveDependency(dependency: string, createdTasks: Task[]): string {
    if (!dependency.startsWith('$')) {
      return dependency;
    }

    const index = Number.parseInt(dependency.slice(1), 10);
    if (!Number.isInteger(index) || index < 0 || index >= createdTasks.length) {
      throw new Error(`invalid batch dependency: ${dependency}`);
    }

    return createdTasks[index].id;
  }
}
