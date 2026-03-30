// entry point for MCP stdio mode
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Store } from '../store/store.js';
import { TaskService } from '../core/task-service.js';
import { AgentService } from '../core/agent-service.js';
import { EventBus } from '../events/event-bus.js';
import { createMcpServer } from './server.js';

async function main() {
  const dbPath = process.env.RIFF_DB ?? 'riff.db';
  const store = new Store(dbPath);
  const eventBus = new EventBus();
  const taskService = new TaskService(store, eventBus);
  const agentService = new AgentService(store, eventBus);

  const server = createMcpServer({ taskService, agentService, eventBus });
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // clean shutdown
  process.on('SIGINT', async () => {
    await server.close();
    store.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('riff mcp server failed:', err);
  process.exit(1);
});
