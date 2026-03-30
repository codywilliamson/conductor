import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { TaskService } from './task-service.js';
import type { ConductorEvent } from '../types.js';

describe('TaskService', () => {
  let store: Store;
  let events: EventBus;
  let service: TaskService;

  beforeEach(() => {
    store = new Store(':memory:');
    events = new EventBus();
    service = new TaskService(store, events);
  });

  describe('create', () => {
    it('creates a task and emits task.created', () => {
      const fn = vi.fn();
      events.on('task.created', fn);

      const task = service.create({ title: 'new task' });

      expect(task.title).toBe('new task');
      expect(task.status).toBe('available');
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.task.id).toBe(task.id);
    });

    it('throws on empty title', () => {
      expect(() => service.create({ title: '' })).toThrow('title is required');
    });

    it('throws on whitespace-only title', () => {
      expect(() => service.create({ title: '   ' })).toThrow('title is required');
    });
  });

  describe('claim', () => {
    it('claims an available task and emits task.claimed', () => {
      const fn = vi.fn();
      events.on('task.claimed', fn);

      const task = service.create({ title: 'claimable' });
      const claimed = service.claim(task.id, 'agent1');

      expect(claimed.status).toBe('claimed');
      expect(claimed.claimed_by).toBe('agent1');
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.agent_id).toBe('agent1');
    });

    it('throws for non-existent task', () => {
      expect(() => service.claim('nope', 'agent1')).toThrow('task not found');
    });

    it('throws when task is not available', () => {
      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');

      expect(() => service.claim(task.id, 'agent2')).toThrow('task is claimed, not available');
    });

    it('throws when dependencies are unmet', () => {
      const dep = service.create({ title: 'dep' });
      const task = service.create({ title: 'blocked', dependencies: [dep.id] });

      expect(() => service.claim(task.id, 'agent1')).toThrow('task has unmet dependencies');
    });
  });

  describe('updateStatus', () => {
    it('transitions claimed -> working and emits status_changed', () => {
      const fn = vi.fn();
      events.on('task.status_changed', fn);

      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');
      const updated = service.updateStatus(task.id, 'working');

      expect(updated.status).toBe('working');
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.status).toBe('working');
    });

    it('transitions to failed and emits task.failed', () => {
      const fn = vi.fn();
      events.on('task.failed', fn);

      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');
      service.updateStatus(task.id, 'failed', 'something broke');

      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.message).toBe('something broke');
    });

    it('transitions review -> done and emits task.completed', () => {
      const fn = vi.fn();
      events.on('task.completed', fn);

      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');
      service.updateStatus(task.id, 'working');
      store.setTaskResult(task.id, { result_type: 'text', result_data: 'x', summary: null });
      // task is now in review via setTaskResult
      const done = service.updateStatus(task.id, 'done');

      expect(done.status).toBe('done');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('throws on invalid transition', () => {
      const task = service.create({ title: 't' });
      expect(() => service.updateStatus(task.id, 'done')).toThrow(
        'invalid transition: available \u2192 done',
      );
    });

    it('throws for non-existent task', () => {
      expect(() => service.updateStatus('nope', 'working')).toThrow('task not found');
    });

    it('allows failed -> available (retry)', () => {
      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');
      service.updateStatus(task.id, 'failed');

      const retried = service.updateStatus(task.id, 'available');
      expect(retried.status).toBe('available');
    });
  });

  describe('submitResult', () => {
    it('submits result for a working task and emits event', () => {
      const fn = vi.fn();
      events.on('task.result_submitted', fn);

      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');
      service.updateStatus(task.id, 'working');

      const updated = service.submitResult(task.id, 'diff', 'patch data', 'fixed bug');

      expect(updated.status).toBe('review');
      expect(updated.result).toEqual({
        result_type: 'diff',
        result_data: 'patch data',
        summary: 'fixed bug',
      });
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.result_type).toBe('diff');
    });

    it('throws when task is not working', () => {
      const task = service.create({ title: 't' });

      expect(() => service.submitResult(task.id, 'text', 'data')).toThrow(
        'task is available, must be working to submit result',
      );
    });

    it('throws for non-existent task', () => {
      expect(() => service.submitResult('nope', 'text', 'data')).toThrow('task not found');
    });
  });

  describe('getFeedback / giveFeedback', () => {
    it('returns no feedback initially', () => {
      const task = service.create({ title: 't' });
      const fb = service.getFeedback(task.id);

      expect(fb.has_feedback).toBe(false);
      expect(fb.feedback).toBeNull();
    });

    it('gives feedback, moves task back to working, and emits event', () => {
      const fn = vi.fn();
      events.on('task.feedback_given', fn);

      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'result');
      // task is now in review

      const updated = service.giveFeedback(task.id, 'needs more tests');

      expect(updated.status).toBe('working');
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.feedback).toBe('needs more tests');

      const fb = service.getFeedback(task.id);
      expect(fb.has_feedback).toBe(true);
      expect(fb.feedback).toBe('needs more tests');
    });

    it('throws when giving feedback on non-review task', () => {
      const task = service.create({ title: 't' });
      expect(() => service.giveFeedback(task.id, 'nope')).toThrow(
        'task is available, must be in review to give feedback',
      );
    });

    it('throws getFeedback for non-existent task', () => {
      expect(() => service.getFeedback('nope')).toThrow('task not found');
    });
  });

  describe('approve', () => {
    it('approves a task in review and emits task.completed', () => {
      const fn = vi.fn();
      events.on('task.completed', fn);

      const task = service.create({ title: 't' });
      service.claim(task.id, 'agent1');
      service.updateStatus(task.id, 'working');
      service.submitResult(task.id, 'text', 'done');

      const approved = service.approve(task.id);

      expect(approved.status).toBe('done');
      expect(fn).toHaveBeenCalledOnce();
    });

    it('throws when task is not in review', () => {
      const task = service.create({ title: 't' });
      expect(() => service.approve(task.id)).toThrow(
        'task is available, must be in review to approve',
      );
    });

    it('throws for non-existent task', () => {
      expect(() => service.approve('nope')).toThrow('task not found');
    });
  });
});
