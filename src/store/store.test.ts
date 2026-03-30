import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from './store.js';

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // --- tasks ---

  describe('tasks', () => {
    it('creates a task with defaults', () => {
      const task = store.createTask({ title: 'Do stuff' });

      expect(task.id).toMatch(/^task_/);
      expect(task.title).toBe('Do stuff');
      expect(task.status).toBe('available');
      expect(task.description).toBeNull();
      expect(task.context).toEqual({});
      expect(task.dependencies).toEqual([]);
      expect(task.priority).toBe(2);
      expect(task.claimed_by).toBeNull();
      expect(task.result).toBeNull();
      expect(task.created_at).toBeDefined();
      expect(task.updated_at).toBeDefined();
    });

    it('creates a task with all fields', () => {
      const task = store.createTask({
        title: 'Full task',
        description: 'A description',
        context: { repo: 'test' },
        dependencies: ['dep1'],
        priority: 0,
      });

      expect(task.title).toBe('Full task');
      expect(task.description).toBe('A description');
      expect(task.context).toEqual({ repo: 'test' });
      expect(task.dependencies).toEqual(['dep1']);
      expect(task.priority).toBe(0);
    });

    it('gets a task by id', () => {
      const created = store.createTask({ title: 'Find me' });
      const found = store.getTask(created.id);

      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for nonexistent task', () => {
      expect(store.getTask('task_nope')).toBeNull();
    });

    it('lists tasks with no filter', () => {
      store.createTask({ title: 'A' });
      store.createTask({ title: 'B' });

      const tasks = store.listTasks();
      expect(tasks).toHaveLength(2);
    });

    it('filters tasks by status', () => {
      const t = store.createTask({ title: 'A' });
      store.createTask({ title: 'B' });
      store.updateTaskStatus(t.id, 'claimed', 'agent-1');

      const available = store.listTasks({ status: 'available' });
      expect(available).toHaveLength(1);
      expect(available[0].title).toBe('B');
    });

    it('filters tasks by priority_max', () => {
      store.createTask({ title: 'High', priority: 0 });
      store.createTask({ title: 'Medium', priority: 2 });

      const highOnly = store.listTasks({ priority_max: 1 });
      expect(highOnly).toHaveLength(1);
      expect(highOnly[0].title).toBe('High');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) {
        store.createTask({ title: `Task ${i}` });
      }

      const limited = store.listTasks({ limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it('orders tasks by priority asc then created_at asc', () => {
      store.createTask({ title: 'Low', priority: 3 });
      store.createTask({ title: 'High', priority: 0 });
      store.createTask({ title: 'Medium', priority: 2 });

      const tasks = store.listTasks();
      expect(tasks.map((t) => t.title)).toEqual(['High', 'Medium', 'Low']);
    });

    it('updates task status', () => {
      const task = store.createTask({ title: 'A' });
      const ok = store.updateTaskStatus(task.id, 'claimed', 'agent-1');

      expect(ok).toBe(true);
      const updated = store.getTask(task.id)!;
      expect(updated.status).toBe('claimed');
      expect(updated.claimed_by).toBe('agent-1');
    });

    it('resets claimed_by when moving to available', () => {
      const task = store.createTask({ title: 'A' });
      store.updateTaskStatus(task.id, 'claimed', 'agent-1');
      store.updateTaskStatus(task.id, 'available');

      const updated = store.getTask(task.id)!;
      expect(updated.status).toBe('available');
      expect(updated.claimed_by).toBeNull();
    });

    it('returns false for update on nonexistent task', () => {
      expect(store.updateTaskStatus('task_nope', 'claimed')).toBe(false);
    });

    it('sets task result and moves to review', () => {
      const task = store.createTask({ title: 'A' });
      store.setTaskResult(task.id, {
        result_type: 'text',
        result_data: 'done',
        summary: 'all good',
      });

      const updated = store.getTask(task.id)!;
      expect(updated.status).toBe('review');
      expect(updated.result).toEqual({
        result_type: 'text',
        result_data: 'done',
        summary: 'all good',
      });
    });

    it('sets and gets task feedback', () => {
      const task = store.createTask({ title: 'A' });
      store.setTaskFeedback(task.id, 'needs changes');

      expect(store.getTaskFeedback(task.id)).toBe('needs changes');
    });

    it('returns null feedback for task without feedback', () => {
      const task = store.createTask({ title: 'A' });
      expect(store.getTaskFeedback(task.id)).toBeNull();
    });

    it('returns null feedback for nonexistent task', () => {
      expect(store.getTaskFeedback('task_nope')).toBeNull();
    });
  });

  // --- claim ---

  describe('claimTask', () => {
    it('claims an available task', () => {
      const task = store.createTask({ title: 'A' });
      const claimed = store.claimTask(task.id, 'agent-1');

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('claimed');
      expect(claimed!.claimed_by).toBe('agent-1');
    });

    it('returns null if task is not available', () => {
      const task = store.createTask({ title: 'A' });
      store.updateTaskStatus(task.id, 'claimed', 'agent-1');

      expect(store.claimTask(task.id, 'agent-2')).toBeNull();
    });

    it('returns null if dependencies are not done', () => {
      const dep = store.createTask({ title: 'Dep' });
      const task = store.createTask({ title: 'Blocked', dependencies: [dep.id] });

      expect(store.claimTask(task.id, 'agent-1')).toBeNull();
    });

    it('allows claim when dependencies are done', () => {
      const dep = store.createTask({ title: 'Dep' });
      store.updateTaskStatus(dep.id, 'done');

      const task = store.createTask({ title: 'Unblocked', dependencies: [dep.id] });
      const claimed = store.claimTask(task.id, 'agent-1');

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('claimed');
    });

    it('returns null for nonexistent task', () => {
      expect(store.claimTask('task_nope', 'agent-1')).toBeNull();
    });
  });

  // --- agents ---

  describe('agents', () => {
    it('registers an agent', () => {
      const agent = store.registerAgent({ agent_id: 'agent-1' });

      expect(agent.agent_id).toBe('agent-1');
      expect(agent.runtime).toBeNull();
      expect(agent.capabilities).toEqual([]);
      expect(agent.scope).toBeNull();
      expect(agent.status).toBe('idle');
      expect(agent.connected_at).toBeDefined();
    });

    it('registers agent with all fields', () => {
      const agent = store.registerAgent({
        agent_id: 'agent-2',
        runtime: 'claude',
        capabilities: ['code', 'review'],
        scope: 'backend',
      });

      expect(agent.runtime).toBe('claude');
      expect(agent.capabilities).toEqual(['code', 'review']);
      expect(agent.scope).toBe('backend');
    });

    it('re-registers (upserts) an agent', () => {
      store.registerAgent({ agent_id: 'agent-1', runtime: 'v1' });
      const updated = store.registerAgent({ agent_id: 'agent-1', runtime: 'v2' });

      expect(updated.runtime).toBe('v2');
      expect(store.listAgents()).toHaveLength(1);
    });

    it('gets agent by id', () => {
      store.registerAgent({ agent_id: 'agent-1' });
      expect(store.getAgent('agent-1')).toBeDefined();
    });

    it('returns null for nonexistent agent', () => {
      expect(store.getAgent('nope')).toBeNull();
    });

    it('lists agents', () => {
      store.registerAgent({ agent_id: 'a' });
      store.registerAgent({ agent_id: 'b' });

      expect(store.listAgents()).toHaveLength(2);
    });

    it('updates agent status', () => {
      store.registerAgent({ agent_id: 'agent-1' });
      store.updateAgentStatus('agent-1', 'working');

      expect(store.getAgent('agent-1')!.status).toBe('working');
    });

    it('returns false for updating nonexistent agent', () => {
      expect(store.updateAgentStatus('nope', 'working')).toBe(false);
    });

    it('removes agent and releases its tasks', () => {
      store.registerAgent({ agent_id: 'agent-1' });
      const task = store.createTask({ title: 'Assigned' });
      store.updateTaskStatus(task.id, 'claimed', 'agent-1');

      const removed = store.removeAgent('agent-1');

      expect(removed).toBe(true);
      expect(store.getAgent('agent-1')).toBeNull();
      const released = store.getTask(task.id)!;
      expect(released.status).toBe('available');
      expect(released.claimed_by).toBeNull();
    });

    it('returns false for removing nonexistent agent', () => {
      expect(store.removeAgent('nope')).toBe(false);
    });
  });
});
