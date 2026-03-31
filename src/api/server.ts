import { serve } from '@hono/node-server';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { TaskService } from '../core/task-service.js';
import { AgentService } from '../core/agent-service.js';
import { ApiKeyService } from '../bridge/api-key-service.js';
import { ProjectService } from '../core/project-service.js';
import { createApp } from './app.js';
import type { RiffConfig } from '../config/config.js';

export async function startServer(
  options: {
    port: number;
    store?: Store;
    dbPath?: string;
    config: RiffConfig;
  },
): Promise<{ close: () => void }> {
  const store = options.store ?? new Store(options.dbPath ?? options.config.store);
  const eventBus = new EventBus();
  const taskService = new TaskService(store, eventBus);
  const agentService = new AgentService(store, eventBus);
  const apiKeyService = new ApiKeyService(store);
  const projectService = new ProjectService(store);

  const app = createApp({
    taskService,
    agentService,
    projectService,
    eventBus,
    store,
    apiKeyService,
    config: options.config,
  });

  const server = serve({ fetch: app.fetch, port: options.port });

  return {
    close: () => {
      server.close();
      eventBus.removeAllListeners();
      store.close();
    },
  };
}
