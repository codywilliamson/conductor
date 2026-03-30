import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  describe('register', () => {
    it('registers an agent and emits agent.registered', () => {
      const fn = vi.fn();
      events.on('agent.registered', fn);

      const agent = service.register({ agent_id: 'a1' });

      expect(agent.agent_id).toBe('a1');
      expect(agent.status).toBe('idle');
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.agent.agent_id).toBe('a1');
    });

    it('throws on empty agent_id', () => {
      expect(() => service.register({ agent_id: '' })).toThrow('agent_id is required');
    });

    it('throws on whitespace-only agent_id', () => {
      expect(() => service.register({ agent_id: '   ' })).toThrow('agent_id is required');
    });
  });

  describe('get', () => {
    it('returns existing agent', () => {
      service.register({ agent_id: 'a1' });
      expect(service.get('a1')).not.toBeNull();
      expect(service.get('a1')!.agent_id).toBe('a1');
    });

    it('returns null for non-existent agent', () => {
      expect(service.get('nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns all registered agents', () => {
      service.register({ agent_id: 'a1' });
      service.register({ agent_id: 'a2' });

      const agents = service.list();
      expect(agents).toHaveLength(2);
    });

    it('returns empty array when no agents', () => {
      expect(service.list()).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('removes agent and emits agent.disconnected', () => {
      const fn = vi.fn();
      events.on('agent.disconnected', fn);

      service.register({ agent_id: 'a1' });
      const result = service.disconnect('a1');

      expect(result).toBe(true);
      expect(service.get('a1')).toBeNull();
      expect(fn).toHaveBeenCalledOnce();
      expect(fn.mock.calls[0][0].data.agent_id).toBe('a1');
    });

    it('releases claimed tasks when agent disconnects', () => {
      service.register({ agent_id: 'a1' });

      const task = store.createTask({ title: 'will be released' });
      store.claimTask(task.id, 'a1');

      service.disconnect('a1');

      const updated = store.getTask(task.id)!;
      expect(updated.status).toBe('available');
      expect(updated.claimed_by).toBeNull();
    });

    it('returns false for non-existent agent', () => {
      expect(service.disconnect('nope')).toBe(false);
    });

    it('does not emit event for non-existent agent', () => {
      const fn = vi.fn();
      events.on('agent.disconnected', fn);

      service.disconnect('nope');
      expect(fn).not.toHaveBeenCalled();
    });
  });
});
