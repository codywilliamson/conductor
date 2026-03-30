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
    it('creates a task and emits event', () => {
      const listener = vi.fn();
      events.on('task.created', listener);

      const task = service.create({ title: 'New task' });

      expect(task.title).toBe('New task');
      expect(task.status).toBe('available');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('throws on empty title', () => {
      expect(() => service.create({ title: '' })).toThrow('title is required');
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
    it('claims an available task', () => {
      const listener = vi.fn();
      events.on('task.claimed', listener);

      const task = service.create({ title: 'Grab me' });
      const claimed = service.claim(task.id, 'agent-1');

      expect(claimed.status).toBe('claimed');
      expect(claimed.claimed_by).toBe('agent-1');
      expect(listener).toHaveBeenCalledOnce();
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
    it('transitions through valid states', () => {
      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      const working = service.updateStatus(task.id, 'working');

      expect(working.status).toBe('working');
    });

    it('throws on invalid transition', () => {
      const task = service.create({ title: 'A' });
      // available -> working is invalid (must go through claimed)
      expect(() => service.updateStatus(task.id, 'working')).toThrow('invalid transition');
    });

    it('throws for nonexistent task', () => {
      expect(() => service.updateStatus('task_nope', 'working')).toThrow('task not found');
    });

    it('emits task.failed on failure', () => {
      const listener = vi.fn();
      events.on('task.failed', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'failed', 'something broke');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.message).toBe('something broke');
    });

    it('emits task.completed on done', () => {
      const listener = vi.fn();
      events.on('task.completed', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');
      // submit result to get to review
      service.submitResult(task.id, 'text', 'done');
      // then review -> done
      service.updateStatus(task.id, 'done');

      expect(listener).toHaveBeenCalledOnce();
    });

    it('emits task.status_changed for other transitions', () => {
      const listener = vi.fn();
      events.on('task.status_changed', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.status).toBe('working');
    });
  });

  describe('submitResult', () => {
    it('submits a result and moves to review', () => {
      const listener = vi.fn();
      events.on('task.result_submitted', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');

      const result = service.submitResult(task.id, 'diff', 'patch content', 'fixed it');

      expect(result.status).toBe('review');
      expect(result.result).toEqual({
        result_type: 'diff',
        result_data: 'patch content',
        summary: 'fixed it',
      });
      expect(listener).toHaveBeenCalledOnce();
    });

    it('throws if task is not working', () => {
      const task = service.create({ title: 'A' });
      expect(() => service.submitResult(task.id, 'text', 'data')).toThrow('must be working');
    });

    it('throws for nonexistent task', () => {
      expect(() => service.submitResult('task_nope', 'text', 'data')).toThrow('task not found');
    });
  });

  describe('feedback', () => {
    it('gets feedback (none by default)', () => {
      const task = service.create({ title: 'A' });
      const fb = service.getFeedback(task.id);

      expect(fb.has_feedback).toBe(false);
      expect(fb.feedback).toBeNull();
    });

    it('gives feedback and moves back to working', () => {
      const listener = vi.fn();
      events.on('task.feedback_given', listener);

      const task = service.create({ title: 'A' });
      service.claim(task.id, 'agent-1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'done');

      const updated = service.giveFeedback(task.id, 'please fix X');

      expect(updated.status).toBe('working');
      expect(listener).toHaveBeenCalledOnce();

      const fb = service.getFeedback(task.id);
      expect(fb.has_feedback).toBe(true);
      expect(fb.feedback).toBe('please fix X');
    });

    it('throws if task is not in review', () => {
      const task = service.create({ title: 'A' });
      expect(() => service.giveFeedback(task.id, 'nope')).toThrow('must be in review');
    });

    it('throws for nonexistent task', () => {
      expect(() => service.getFeedback('task_nope')).toThrow('task not found');
    });
  });

  describe('approve', () => {
    it('approves a task in review', () => {
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

    it('throws if not in review', () => {
      const task = service.create({ title: 'A' });
      expect(() => service.approve(task.id)).toThrow('must be in review');
    });

    it('throws for nonexistent task', () => {
      expect(() => service.approve('task_nope')).toThrow('task not found');
    });
  });
});
