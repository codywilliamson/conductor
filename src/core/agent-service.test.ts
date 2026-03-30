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
    it('registers an agent and emits event', () => {
      const listener = vi.fn();
      events.on('agent.registered', listener);

      const agent = service.register({ agent_id: 'agent-1' });

      expect(agent.agent_id).toBe('agent-1');
      expect(agent.status).toBe('idle');
      expect(listener).toHaveBeenCalledOnce();
    });

    it('throws on empty agent_id', () => {
      expect(() => service.register({ agent_id: '' })).toThrow('agent_id is required');
      expect(() => service.register({ agent_id: '   ' })).toThrow('agent_id is required');
    });
  });

  describe('get', () => {
    it('returns agent by id', () => {
      service.register({ agent_id: 'agent-1' });
      expect(service.get('agent-1')?.agent_id).toBe('agent-1');
    });

    it('returns null for nonexistent', () => {
      expect(service.get('nope')).toBeNull();
    });
  });

  describe('list', () => {
    it('lists all agents', () => {
      service.register({ agent_id: 'a' });
      service.register({ agent_id: 'b' });
      expect(service.list()).toHaveLength(2);
    });
  });

  describe('disconnect', () => {
    it('disconnects an agent and emits event', () => {
      const listener = vi.fn();
      events.on('agent.disconnected', listener);

      service.register({ agent_id: 'agent-1' });
      const result = service.disconnect('agent-1');

      expect(result).toBe(true);
      expect(service.get('agent-1')).toBeNull();
      expect(listener).toHaveBeenCalledOnce();
    });

    it('returns false for nonexistent agent', () => {
      expect(service.disconnect('nope')).toBe(false);
    });
  });
});
