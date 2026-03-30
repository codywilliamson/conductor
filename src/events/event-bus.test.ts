import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on/emit', () => {
    it('calls listener for matching event type', () => {
      const listener = vi.fn();
      bus.on('task.created', listener);

      bus.emit('task.created', { id: '1' });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toMatchObject({
        type: 'task.created',
        data: { id: '1' },
      });
      expect(listener.mock.calls[0][0].timestamp).toBeDefined();
    });

    it('does not call listener for non-matching event type', () => {
      const listener = vi.fn();
      bus.on('task.claimed', listener);

      bus.emit('task.created', { id: '1' });

      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners on the same event', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      bus.on('task.created', l1);
      bus.on('task.created', l2);

      bus.emit('task.created');

      expect(l1).toHaveBeenCalledOnce();
      expect(l2).toHaveBeenCalledOnce();
    });

    it('emits with empty data by default', () => {
      const listener = vi.fn();
      bus.on('task.created', listener);

      bus.emit('task.created');

      expect(listener.mock.calls[0][0].data).toEqual({});
    });
  });

  describe('wildcard listener', () => {
    it('receives all events', () => {
      const listener = vi.fn();
      bus.on('*', listener);

      bus.emit('task.created', { a: 1 });
      bus.emit('agent.registered', { b: 2 });

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[0][0].type).toBe('task.created');
      expect(listener.mock.calls[1][0].type).toBe('agent.registered');
    });

    it('wildcard and specific listeners both fire', () => {
      const specific = vi.fn();
      const wildcard = vi.fn();
      bus.on('task.created', specific);
      bus.on('*', wildcard);

      bus.emit('task.created');

      expect(specific).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledOnce();
    });
  });

  describe('unsubscribe', () => {
    it('returns an unsubscribe function that removes the listener', () => {
      const listener = vi.fn();
      const unsub = bus.on('task.created', listener);

      bus.emit('task.created');
      expect(listener).toHaveBeenCalledOnce();

      unsub();
      bus.emit('task.created');
      expect(listener).toHaveBeenCalledOnce(); // still 1
    });
  });

  describe('removeAllListeners', () => {
    it('clears all listeners', () => {
      const l1 = vi.fn();
      const l2 = vi.fn();
      bus.on('task.created', l1);
      bus.on('*', l2);

      bus.removeAllListeners();

      bus.emit('task.created');
      expect(l1).not.toHaveBeenCalled();
      expect(l2).not.toHaveBeenCalled();
    });
  });
});
