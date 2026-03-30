import { serve } from '@hono/node-server';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { TaskService } from '../core/task-service.js';
import { AgentService } from '../core/agent-service.js';
import { createApp } from './app.js';

export async function startServer(
  port: number,
  dbPath: string,
): Promise<{ close: () => void }> {
  const store = new Store(dbPath);
  const eventBus = new EventBus();
  const taskService = new TaskService(store, eventBus);
  const agentService = new AgentService(store, eventBus);

  const app = createApp({ taskService, agentService, eventBus });

  const server = serve({ fetch: app.fetch, port });

  return {
    close: () => {
      server.close();
      eventBus.removeAllListeners();
      store.close();
    },
  };
}
