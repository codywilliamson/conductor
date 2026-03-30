import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { AgentService } from './agent-service.js';

describe('AgentService', () => {
  let store: Store;
  let events: EventBus;
  let service: AgentService;

  beforeEach(() => {
    store = new Store(':memory:');
    events = new EventBus();
    service = new AgentService(store, events);
  });

  afterEach(() => {
    store.close();
  });

  describe('register', () => {
    it('registers an agent and emits agent.registered', () => {
      const listener = vi.fn();
      events.on('agent.registered', listener);

      const agent = service.register({ agent_id: 'agent-1' });

      expect(agent.agent_id).toBe('agent-1');
      expect(agent.status).toBe('idle');
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.agent.agent_id).toBe('agent-1');
    });

    it('throws on empty agent_id', () => {
      expect(() => service.register({ agent_id: '' })).toThrow('agent_id is required');
    });

    it('throws on whitespace-only agent_id', () => {
      expect(() => service.register({ agent_id: '   ' })).toThrow('agent_id is required');
    });
  });

  describe('get', () => {
    it('returns agent by id', () => {
      service.register({ agent_id: 'agent-1' });
      expect(service.get('agent-1')).not.toBeNull();
      expect(service.get('agent-1')!.agent_id).toBe('agent-1');
    });

    it('returns null for non-existent agent', () => {
      expect(service.get('nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all registered agents', () => {
      service.register({ agent_id: 'a1' });
      service.register({ agent_id: 'a2' });

      expect(service.list()).toHaveLength(2);
    });

    it('returns empty array when no agents', () => {
      expect(service.list()).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('removes agent and emits agent.disconnected', () => {
      const listener = vi.fn();
      events.on('agent.disconnected', listener);

      service.register({ agent_id: 'agent-1' });
      const result = service.disconnect('agent-1');

      expect(result).toBe(true);
      expect(service.get('agent-1')).toBeNull();
      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].data.agent_id).toBe('agent-1');
    });

    it('releases claimed tasks when agent disconnects', () => {
      service.register({ agent_id: 'agent-1' });

      const task = store.createTask({ title: 'will be released' });
      store.claimTask(task.id, 'agent-1');

      service.disconnect('agent-1');

      const updated = store.getTask(task.id)!;
      expect(updated.status).toBe('available');
      expect(updated.claimed_by).toBeNull();
    });

    it('returns false for non-existent agent', () => {
      expect(service.disconnect('nope')).toBe(false);
    });

    it('does not emit event for non-existent agent', () => {
      const listener = vi.fn();
      events.on('agent.disconnected', listener);

      service.disconnect('nope');
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
