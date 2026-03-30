import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from './event-bus.js';
import type { ConductorEvent } from '../types.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on/emit', () => {
    it('calls listener for matching event type', () => {
      const fn = vi.fn();
      bus.on('task.created', fn);
      bus.emit('task.created', { id: '1' });

      expect(fn).toHaveBeenCalledOnce();
      const event: ConductorEvent = fn.mock.calls[0][0];
      expect(event.type).toBe('task.created');
      expect(event.data).toEqual({ id: '1' });
      expect(event.timestamp).toBeTruthy();
    });

    it('does not call listener for non-matching event type', () => {
      const fn = vi.fn();
      bus.on('task.created', fn);
      bus.emit('task.claimed', { id: '1' });

      expect(fn).not.toHaveBeenCalled();
    });

    it('supports multiple listeners on the same event', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      bus.on('task.created', fn1);
      bus.on('task.created', fn2);
      bus.emit('task.created', {});

      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it('emits with empty data by default', () => {
      const fn = vi.fn();
      bus.on('task.created', fn);
      bus.emit('task.created');

      expect(fn.mock.calls[0][0].data).toEqual({});
    });
  });

  describe('wildcard listener', () => {
    it('receives all events', () => {
      const fn = vi.fn();
      bus.on('*', fn);

      bus.emit('task.created', { a: 1 });
      bus.emit('agent.registered', { b: 2 });

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[0][0].type).toBe('task.created');
      expect(fn.mock.calls[1][0].type).toBe('agent.registered');
    });

    it('wildcard and specific listeners both fire', () => {
      const specific = vi.fn();
      const wildcard = vi.fn();
      bus.on('task.created', specific);
      bus.on('*', wildcard);

      bus.emit('task.created', {});

      expect(specific).toHaveBeenCalledOnce();
      expect(wildcard).toHaveBeenCalledOnce();
    });
  });

  describe('unsubscribe', () => {
    it('returns an unsubscribe function that removes the listener', () => {
      const fn = vi.fn();
      const unsub = bus.on('task.created', fn);

      bus.emit('task.created', {});
      expect(fn).toHaveBeenCalledOnce();

      unsub();
      bus.emit('task.created', {});
      expect(fn).toHaveBeenCalledOnce(); // still 1
    });
  });

  describe('removeAllListeners', () => {
    it('clears all listeners', () => {
      const fn1 = vi.fn();
      const fn2 = vi.fn();
      bus.on('task.created', fn1);
      bus.on('*', fn2);

      bus.removeAllListeners();

      bus.emit('task.created', {});
      expect(fn1).not.toHaveBeenCalled();
      expect(fn2).not.toHaveBeenCalled();
    });
  });
});
