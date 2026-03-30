import { describe, it, expect, beforeEach } from 'vitest';
import { Store } from './store.js';

describe('Store', () => {
  let store: Store;

  beforeEach(() => {
    store = new Store(':memory:');
  });

  describe('createTask', () => {
    it('creates a task with defaults', () => {
      const task = store.createTask({ title: 'test task' });

      expect(task.id).toMatch(/^task_/);
      expect(task.title).toBe('test task');
      expect(task.status).toBe('available');
      expect(task.description).toBeNull();
      expect(task.context).toEqual({});
      expect(task.dependencies).toEqual([]);
      expect(task.priority).toBe(2);
      expect(task.claimed_by).toBeNull();
      expect(task.result).toBeNull();
      expect(task.created_at).toBeTruthy();
      expect(task.updated_at).toBeTruthy();
    });

    it('creates a task with custom fields', () => {
      const task = store.createTask({
        title: 'custom',
        description: 'a description',
        context: { repo: 'foo' },
        dependencies: ['dep1', 'dep2'],
        priority: 0,
      });

      expect(task.title).toBe('custom');
      expect(task.description).toBe('a description');
      expect(task.context).toEqual({ repo: 'foo' });
      expect(task.dependencies).toEqual(['dep1', 'dep2']);
      expect(task.priority).toBe(0);
    });
  });

  describe('getTask', () => {
    it('returns an existing task', () => {
      const created = store.createTask({ title: 'find me' });
      const found = store.getTask(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
    });

    it('returns null for non-existent id', () => {
      expect(store.getTask('task_nope')).toBeNull();
    });
  });

  describe('listTasks', () => {
    it('returns all tasks when no filter', () => {
      store.createTask({ title: 'a' });
      store.createTask({ title: 'b' });

      expect(store.listTasks()).toHaveLength(2);
    });

    it('filters by status', () => {
      const t = store.createTask({ title: 'a' });
      store.createTask({ title: 'b' });
      store.updateTaskStatus(t.id, 'claimed', 'agent1');

      const available = store.listTasks({ status: 'available' });
      expect(available).toHaveLength(1);
      expect(available[0].title).toBe('b');
    });

    it('filters by priority_max', () => {
      store.createTask({ title: 'urgent', priority: 0 });
      store.createTask({ title: 'normal', priority: 2 });
      store.createTask({ title: 'low', priority: 3 });

      const highPri = store.listTasks({ priority_max: 1 });
      expect(highPri).toHaveLength(1);
      expect(highPri[0].title).toBe('urgent');
    });

    it('respects limit', () => {
      for (let i = 0; i < 5; i++) store.createTask({ title: `t${i}` });

      expect(store.listTasks({ limit: 3 })).toHaveLength(3);
    });

    it('orders by priority asc then created_at asc', () => {
      store.createTask({ title: 'low', priority: 3 });
      store.createTask({ title: 'high', priority: 0 });
      store.createTask({ title: 'mid', priority: 1 });

      const tasks = store.listTasks();
      expect(tasks.map((t) => t.title)).toEqual(['high', 'mid', 'low']);
    });
  });

  describe('updateTaskStatus', () => {
    it('updates status and sets claimed_by', () => {
      const task = store.createTask({ title: 'x' });
      store.updateTaskStatus(task.id, 'claimed', 'agent1');

      const updated = store.getTask(task.id)!;
      expect(updated.status).toBe('claimed');
      expect(updated.claimed_by).toBe('agent1');
    });

    it('resets claimed_by, result, and feedback when set to available', () => {
      const task = store.createTask({ title: 'x' });
      store.updateTaskStatus(task.id, 'claimed', 'agent1');
      store.updateTaskStatus(task.id, 'working');
      store.setTaskResult(task.id, { result_type: 'text', result_data: 'hi', summary: null });
      store.setTaskFeedback(task.id, 'looks good');

      store.updateTaskStatus(task.id, 'available');

      const reset = store.getTask(task.id)!;
      expect(reset.status).toBe('available');
      expect(reset.claimed_by).toBeNull();
      expect(reset.result).toBeNull();
      expect(store.getTaskFeedback(task.id)).toBeNull();
    });

    it('returns false for non-existent task', () => {
      expect(store.updateTaskStatus('nope', 'claimed')).toBe(false);
    });
  });

  describe('claimTask', () => {
    it('claims an available task', () => {
      const task = store.createTask({ title: 'claimable' });
      const claimed = store.claimTask(task.id, 'agent1');

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('claimed');
      expect(claimed!.claimed_by).toBe('agent1');
    });

    it('returns null if task is already claimed', () => {
      const task = store.createTask({ title: 'taken' });
      store.claimTask(task.id, 'agent1');

      expect(store.claimTask(task.id, 'agent2')).toBeNull();
    });

    it('returns null if dependencies are not done', () => {
      const dep = store.createTask({ title: 'dependency' });
      const task = store.createTask({ title: 'dependent', dependencies: [dep.id] });

      expect(store.claimTask(task.id, 'agent1')).toBeNull();
    });

    it('allows claim when all dependencies are done', () => {
      const dep = store.createTask({ title: 'dep' });
      store.updateTaskStatus(dep.id, 'claimed', 'a');
      store.updateTaskStatus(dep.id, 'working');
      store.updateTaskStatus(dep.id, 'review');
      store.updateTaskStatus(dep.id, 'done');

      const task = store.createTask({ title: 'after dep', dependencies: [dep.id] });
      const claimed = store.claimTask(task.id, 'agent1');

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe('claimed');
    });

    it('returns null for non-existent task', () => {
      expect(store.claimTask('nope', 'agent1')).toBeNull();
    });
  });

  describe('setTaskResult / getTaskFeedback', () => {
    it('sets result and moves task to review', () => {
      const task = store.createTask({ title: 'r' });
      store.setTaskResult(task.id, { result_type: 'text', result_data: 'done', summary: 'ok' });

      const updated = store.getTask(task.id)!;
      expect(updated.status).toBe('review');
      expect(updated.result).toEqual({ result_type: 'text', result_data: 'done', summary: 'ok' });
    });

    it('sets and gets feedback', () => {
      const task = store.createTask({ title: 'f' });
      store.setTaskFeedback(task.id, 'needs work');

      expect(store.getTaskFeedback(task.id)).toBe('needs work');
    });

    it('returns null feedback for task with none set', () => {
      const task = store.createTask({ title: 'no feedback' });
      expect(store.getTaskFeedback(task.id)).toBeNull();
    });

    it('returns null feedback for non-existent task', () => {
      expect(store.getTaskFeedback('nope')).toBeNull();
    });
  });

  describe('registerAgent', () => {
    it('registers an agent with defaults', () => {
      const agent = store.registerAgent({ agent_id: 'a1' });

      expect(agent.agent_id).toBe('a1');
      expect(agent.runtime).toBeNull();
      expect(agent.capabilities).toEqual([]);
      expect(agent.scope).toBeNull();
      expect(agent.status).toBe('idle');
      expect(agent.connected_at).toBeTruthy();
    });

    it('registers an agent with custom fields', () => {
      const agent = store.registerAgent({
        agent_id: 'a2',
        runtime: 'claude',
        capabilities: ['code', 'test'],
        scope: 'backend',
      });

      expect(agent.runtime).toBe('claude');
      expect(agent.capabilities).toEqual(['code', 'test']);
      expect(agent.scope).toBe('backend');
    });
  });

  describe('getAgent', () => {
    it('returns existing agent', () => {
      store.registerAgent({ agent_id: 'a1' });
      expect(store.getAgent('a1')).not.toBeNull();
    });

    it('returns null for non-existent agent', () => {
      expect(store.getAgent('nope')).toBeNull();
    });
  });

  describe('listAgents', () => {
    it('returns all agents', () => {
      store.registerAgent({ agent_id: 'a1' });
      store.registerAgent({ agent_id: 'a2' });

      expect(store.listAgents()).toHaveLength(2);
    });
  });

  describe('updateAgentStatus', () => {
    it('updates status', () => {
      store.registerAgent({ agent_id: 'a1' });
      store.updateAgentStatus('a1', 'working');

      expect(store.getAgent('a1')!.status).toBe('working');
    });

    it('returns false for non-existent agent', () => {
      expect(store.updateAgentStatus('nope', 'idle')).toBe(false);
    });
  });

  describe('removeAgent', () => {
    it('removes the agent', () => {
      store.registerAgent({ agent_id: 'a1' });
      expect(store.removeAgent('a1')).toBe(true);
      expect(store.getAgent('a1')).toBeNull();
    });

    it('releases claimed and working tasks back to available', () => {
      store.registerAgent({ agent_id: 'a1' });
      const t1 = store.createTask({ title: 'claimed' });
      const t2 = store.createTask({ title: 'working' });

      store.claimTask(t1.id, 'a1');
      store.claimTask(t2.id, 'a1');
      store.updateTaskStatus(t2.id, 'working');

      store.removeAgent('a1');

      expect(store.getTask(t1.id)!.status).toBe('available');
      expect(store.getTask(t1.id)!.claimed_by).toBeNull();
      expect(store.getTask(t2.id)!.status).toBe('available');
      expect(store.getTask(t2.id)!.claimed_by).toBeNull();
    });

    it('returns false for non-existent agent', () => {
      expect(store.removeAgent('nope')).toBe(false);
    });
  });
});
