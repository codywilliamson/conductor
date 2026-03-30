import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { TaskService } from '../core/task-service.js';
import type { AgentService } from '../core/agent-service.js';
import type { EventBus } from '../events/event-bus.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { TaskStatus, TaskPriority } from '../types.js';

interface Deps {
  taskService: TaskService;
  agentService: AgentService;
  eventBus: EventBus;
}

// map service error messages to http status codes
function errorStatus(msg: string): ContentfulStatusCode {
  if (msg.includes('not found')) return 404;
  if (msg.includes('required')) return 400;
  if (msg.includes('invalid transition') || msg.includes('must be') || msg.includes('not available') || msg.includes('unmet dependencies')) return 409;
  return 400;
}

export function createApp({ taskService, agentService, eventBus }: Deps) {
  const app = new Hono().basePath('/api/v1');

  // --- agents ---

  app.post('/agents', async (c) => {
    try {
      const body = await c.req.json();
      const agent = agentService.register(body);
      return c.json(agent, 201);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  app.get('/agents', (c) => {
    return c.json(agentService.list());
  });

  app.delete('/agents/:agent_id', (c) => {
    const agentId = c.req.param('agent_id');
    const removed = agentService.disconnect(agentId);
    if (!removed) return c.json({ error: 'agent not found' }, 404);
    return c.json({ ok: true });
  });

  // --- tasks ---

  app.get('/tasks', (c) => {
    const filter: Record<string, unknown> = {};
    const status = c.req.query('status');
    if (status) filter.status = status as TaskStatus;
    const priorityMax = c.req.query('priority_max');
    if (priorityMax) filter.priority_max = Number(priorityMax) as TaskPriority;
    const scope = c.req.query('scope');
    if (scope) filter.scope = scope;
    const limit = c.req.query('limit');
    if (limit) filter.limit = Number(limit);
    return c.json(taskService.list(filter));
  });

  app.post('/tasks', async (c) => {
    try {
      const body = await c.req.json();
      const task = taskService.create(body);
      return c.json(task, 201);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  app.get('/tasks/:id', (c) => {
    const task = taskService.get(c.req.param('id'));
    if (!task) return c.json({ error: 'task not found' }, 404);
    return c.json(task);
  });

  app.post('/tasks/:id/claim', async (c) => {
    try {
      const { agent_id } = await c.req.json();
      const task = taskService.claim(c.req.param('id'), agent_id);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  app.patch('/tasks/:id/status', async (c) => {
    try {
      const { status, message } = await c.req.json();
      const task = taskService.updateStatus(c.req.param('id'), status, message);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  app.post('/tasks/:id/result', async (c) => {
    try {
      const { result_type, result_data, summary } = await c.req.json();
      const task = taskService.submitResult(c.req.param('id'), result_type, result_data, summary);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  app.get('/tasks/:id/feedback', (c) => {
    try {
      const result = taskService.getFeedback(c.req.param('id'));
      return c.json(result);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  app.post('/tasks/:id/feedback', async (c) => {
    try {
      const { feedback } = await c.req.json();
      const task = taskService.giveFeedback(c.req.param('id'), feedback);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  app.post('/tasks/:id/approve', (c) => {
    try {
      const task = taskService.approve(c.req.param('id'));
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  // --- SSE events ---

  app.get('/events', (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = eventBus.on('*', (event) => {
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: event.timestamp,
        });
      });

      // keep alive until client disconnects
      stream.onAbort(() => {
        unsubscribe();
      });

      // block until aborted
      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  });

  // --- webhook ingest ---

  app.post('/hooks/ingest', async (c) => {
    try {
      const body = await c.req.json();
      const input = {
        title: body.title ?? `Webhook: ${body.type ?? 'external'}`,
        description: body.description ?? body.summary ?? null,
        context: body,
        priority: body.priority ?? 2,
      };
      const task = taskService.create(input);
      return c.json(task, 201);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  });

  return app;
}
