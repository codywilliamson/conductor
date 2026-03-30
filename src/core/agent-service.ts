import type { Store } from '../store/store.js';
import type { EventBus } from '../events/event-bus.js';
import type { Agent, RegisterAgentInput } from '../types.js';

export class AgentService {
  constructor(
    private store: Store,
    private events: EventBus,
  ) {}

  register(input: RegisterAgentInput): Agent {
    if (!input.agent_id?.trim()) {
      throw new Error('agent_id is required');
    }
    const agent = this.store.registerAgent(input);
    this.events.emit('agent.registered', { agent });
    return agent;
  }

  get(agentId: string): Agent | null {
    return this.store.getAgent(agentId);
  }

  list(): Agent[] {
    return this.store.listAgents();
  }

  disconnect(agentId: string): boolean {
    const agent = this.store.getAgent(agentId);
    if (!agent) return false;

    this.store.removeAgent(agentId);
    this.events.emit('agent.disconnected', { agent_id: agentId });
    return true;
  }
}
