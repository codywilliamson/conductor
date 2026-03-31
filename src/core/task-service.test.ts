import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { TaskService } from './task-service.js';

describe('TaskService', () => {
  let store: Store;
  let events: EventBus;
  let service: TaskService;

  beforeEach(() => {
    store = new Store(':memory:');
    events = new EventBus();
    service = new TaskService(store, events);
  });

  afterEach(() => {
    store.close();
  });

  describe('create', () => {
    it('creates a task and emits task.created', () => {
      const listener = vi.fn();
      events.on('task.created', listener);

      const task = service.create({ title: 'New task' });

      expect(task.title).toBe('New task');
      expect(task.status).toBe('available');
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.task.id).toBe(task.id);
    });

    it('throws on empty title', () => {
      expect(() => service.create({ title: '' })).toThrow('title is required');
    });

    it('throws on whitespace-only title', () => {
      expect(() => service.create({ title: '   ' })).toThrow('title is required');
    });
  });

  describe('get', () => {
    it('returns task by id', () => {
      const task = service.create({ title: 'Find me' });
      expect(service.get(task.id)?.title).toBe('Find me');
    });

    it('returns null for nonexistent', () => {
      expect(service.get('task_nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('lists all tasks', () => {
      service.create({ title: 'A' });
      service.create({ title: 'B' });
      expect(service.list()).toHaveLength(2);
    });

    it('filters by status', () => {
      service.create({ title: 'A' });
      service.create({ title: 'B' });
      expect(service.list({ status: 'available' })).toHaveLength(2);
      expect(service.list({ status: 'claimed' })).toHaveLength(0);
    });
  });

  describe('claim', () => {
    it('claims an available task and emits task.claimed', () => {
      const listener = vi.fn();
      events.on('task.claimed', listener);

      const task = service.create({ title: 'Grab me' });
      const claimed = service.claim(task.id, 'agent-1');

      expect(claimed.status).toBe('claimed');
      expect(claimed.claimed_by).toBe('agent-1');
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.agent_id).toBe('agent-1');
    });

    it('throws if task not found', () => {
      expect(() => service.claim('task_nope', 'agent-1')).toThrow('task not found');
    });

    it('throws if task is not available', () => {
      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');

      expect(() => service.claim(task.id, 'agent-2')).toThrow('not available');
    });

    it('throws if dependencies are unmet', () => {
      const dep = service.create({ title: 'Dep' });
      const task = service.create({ title: 'Blocked', dependencies: [dep.id] });

      expect(() => service.claim(task.id, 'agent-1')).toThrow('unmet dependencies');
    });
  });

  describe('updateStatus', () => {
    it('transitions claimed -> working and emits status_changed', () => {
      const listener = vi.fn();
      events.on('task.status_changed', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      const working = service.updateStatus(task.id, 'working');

      expect(working.status).toBe('working');
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.status).toBe('working');
    });

    it('transitions to failed and emits task.failed', () => {
      const listener = vi.fn();
      events.on('task.failed', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'failed', 'something broke');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.message).toBe('something broke');
    });

    it('transitions review -> done and emits task.completed', () => {
      const listener = vi.fn();
      events.on('task.completed', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'done');
      const done = service.updateStatus(task.id, 'done');

      expect(done.status).toBe('done');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('throws on invalid transition', () => {
      const task = service.create({ title: 'A' });
      expect(() => service.updateStatus(task.id, 'working')).toThrow('invalid transition');
    });

    it('throws on invalid transition from done', () => {
      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'x');
      service.updateStatus(task.id, 'done');

      expect(() => service.updateStatus(task.id, 'available')).toThrow('invalid transition');
    });

    it('throws for non-existent task', () => {
      expect(() => service.updateStatus('task_nope', 'working')).toThrow('task not found');
    });

    it('allows failed -> available (retry)', () => {
      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'failed');

      const retried = service.updateStatus(task.id, 'available');
      expect(retried.status).toBe('available');
    });

    it('allows working -> available (cancel)', () => {
      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');

      const cancelled = service.updateStatus(task.id, 'available');
      expect(cancelled.status).toBe('available');
    });

    it('allows review -> working (revision)', () => {
      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'x');

      const revision = service.updateStatus(task.id, 'working');
      expect(revision.status).toBe('working');
    });
  });

  describe('submitResult', () => {
    it('submits result for a working task and emits event', () => {
      const listener = vi.fn();
      events.on('task.result_submitted', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');

      const updated = service.submitResult(task.id, 'diff', 'patch data', 'fixed bug');

      expect(updated.status).toBe('review');
      expect(updated.result).toEqual({
        result_type: 'diff',
        result_data: 'patch data',
        summary: 'fixed bug',
      });
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.result_type).toBe('diff');
    });

    it('defaults summary to null', () => {
      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');

      const updated = service.submitResult(task.id, 'text', 'data');
      expect(updated.result!.summary).toBeNull();
    });

    it('throws when task is not working', () => {
      const task = service.create({ title: 'A' });
      expect(() => service.submitResult(task.id, 'text', 'data')).toThrow('must be working');
    });

    it('throws for non-existent task', () => {
      expect(() => service.submitResult('task_nope', 'text', 'data')).toThrow('task not found');
    });
  });

  describe('getFeedback / giveFeedback', () => {
    it('returns no feedback initially', () => {
      const task = service.create({ title: 'A' });
      const fb = service.getFeedback(task.id);

      expect(fb.has_feedback).toBe(false);
      expect(fb.feedback).toBeNull();
    });

    it('gives feedback, moves task back to working, and emits event', () => {
      const listener = vi.fn();
      events.on('task.feedback_given', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'result');

      const updated = service.giveFeedback(task.id, 'needs more tests');

      expect(updated.status).toBe('working');
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.feedback).toBe('needs more tests');

      const fb = service.getFeedback(task.id);
      expect(fb.has_feedback).toBe(true);
      expect(fb.feedback).toBe('needs more tests');
    });

    it('throws when giving feedback on non-review task', () => {
      const task = service.create({ title: 'A' });
      expect(() => service.giveFeedback(task.id, 'nope')).toThrow('must be in review');
    });

    it('throws getFeedback for non-existent task', () => {
      expect(() => service.getFeedback('task_nope')).toThrow('task not found');
    });

    it('throws giveFeedback for non-existent task', () => {
      expect(() => service.giveFeedback('task_nope', 'nope')).toThrow('task not found');
    });
  });

  describe('project scoping', () => {
    it('create sets project_id on the task', () => {
      const project = store.createProject({ name: 'test-proj' });
      const task = service.create({ title: 'Scoped', project_id: project.id });
      expect(task.project_id).toBe(project.id);
    });

    it('list filters by project_id', () => {
      const projA = store.createProject({ name: 'a' });
      const projB = store.createProject({ name: 'b' });
      service.create({ title: 'Task A', project_id: projA.id });
      service.create({ title: 'Task B', project_id: projB.id });

      const tasks = service.list({ project_id: projA.id });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Task A');
    });

    it('claim validates agent scope against task project', () => {
      const project = store.createProject({ name: 'scoped-proj' });
      const task = service.create({ title: 'Scoped task', project_id: project.id });
      store.registerAgent({ agent_id: 'agent-1', scope: 'other-proj' });

      expect(() => service.claim(task.id, 'agent-1')).toThrow('agent scope');
    });

    it('claim allows unscoped agents to claim any project', () => {
      const project = store.createProject({ name: 'any-proj' });
      const task = service.create({ title: 'Any task', project_id: project.id });
      store.registerAgent({ agent_id: 'agent-global' });

      const claimed = service.claim(task.id, 'agent-global');
      expect(claimed.status).toBe('claimed');
    });
  });

  describe('approve', () => {
    it('approves a task in review and emits task.completed', () => {
      const listener = vi.fn();
      events.on('task.completed', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'done');

      const approved = service.approve(task.id);

      expect(approved.status).toBe('done');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('throws when task is not in review', () => {
      const task = service.create({ title: 'A' });
      expect(() => service.approve(task.id)).toThrow('must be in review to approve');
    });

    it('throws for non-existent task', () => {
      expect(() => service.approve('task_nope')).toThrow('task not found');
    });
  });
});
