import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventBus } from './event-bus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('emits events to specific listeners', () => {
    const listener = vi.fn();
    bus.on('task.created', listener);

    bus.emit('task.created', { task: { id: '1' } });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toMatchObject({
      type: 'task.created',
      data: { task: { id: '1' } },
    });
    expect(listener.mock.calls[0][0].timestamp).toBeDefined();
  });

  it('does not emit to listeners of different event types', () => {
    const listener = vi.fn();
    bus.on('task.claimed', listener);

    bus.emit('task.created', { task: { id: '1' } });

    expect(listener).not.toHaveBeenCalled();
  });

  it('wildcard listener receives all events', () => {
    const listener = vi.fn();
    bus.on('*', listener);

    bus.emit('task.created', { task: { id: '1' } });
    bus.emit('agent.registered', { agent: { id: 'a' } });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[0][0].type).toBe('task.created');
    expect(listener.mock.calls[1][0].type).toBe('agent.registered');
  });

  it('unsubscribe function removes listener', () => {
    const listener = vi.fn();
    const unsubscribe = bus.on('task.created', listener);

    bus.emit('task.created');
    expect(listener).toHaveBeenCalledOnce();

    unsubscribe();
    bus.emit('task.created');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('removeAllListeners clears everything', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.on('task.created', l1);
    bus.on('*', l2);

    bus.removeAllListeners();

    bus.emit('task.created');
    expect(l1).not.toHaveBeenCalled();
    expect(l2).not.toHaveBeenCalled();
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

  it('emit with no data defaults to empty object', () => {
    const listener = vi.fn();
    bus.on('task.created', listener);

    bus.emit('task.created');

    expect(listener.mock.calls[0][0].data).toEqual({});
  });
});
