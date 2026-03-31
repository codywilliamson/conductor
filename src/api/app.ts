import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { TaskService } from '../core/task-service.js';
import type { AgentService } from '../core/agent-service.js';
import type { ProjectService } from '../core/project-service.js';
import type { EventBus } from '../events/event-bus.js';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Store } from '../store/store.js';
import type { ApiKeyService } from '../bridge/api-key-service.js';
import type { RiffConfig } from '../config/config.js';
import type { TaskStatus, TaskPriority, ApiKeyScope, ApiKeyRecord, Task } from '../types.js';

interface Deps {
  taskService: TaskService;
  agentService: AgentService;
  projectService: ProjectService;
  eventBus: EventBus;
  store?: Store;
  apiKeyService?: ApiKeyService;
  config?: RiffConfig;
}

interface RequestAuthContext {
  local: boolean;
  ip: string;
  key: ApiKeyRecord | null;
}

type AppBindings = {
  Variables: {
    auth: RequestAuthContext;
  };
};

// map service error messages to http status codes
function errorStatus(msg: string): ContentfulStatusCode {
  if (msg.includes('not found')) return 404;
  if (msg.includes('required')) return 400;
  if (msg.includes('already exists')) return 409;
  if (msg.includes('invalid transition') || msg.includes('must be') || msg.includes('not available') || msg.includes('unmet dependencies')) return 409;
  return 400;
}

function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function getRequestIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  const connectingIp = request.headers.get('cf-connecting-ip');
  if (connectingIp) {
    return connectingIp;
  }

  return '127.0.0.1';
}

function parseBodySize(limit: string): number {
  const match = /^(\d+)(b|kb|mb)$/i.exec(limit.trim());
  if (!match) {
    return 1_048_576;
  }

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'mb' ? 1_048_576 : unit === 'kb' ? 1_024 : 1;
  return value * multiplier;
}

function toBridgeTask(task: Task) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    scope: task.scope,
    source: task.source,
  };
}

export function createApp({
  taskService,
  agentService,
  projectService,
  eventBus,
  store,
  apiKeyService,
  config,
}: Deps) {
  const app = new Hono<AppBindings>().basePath('/api/v1');
  const bridge = store && apiKeyService && config ? { store, apiKeyService, config } : null;

  const resolveProject = (c: any): string | null => {
    const projectId = c.req.param('project_id');
    if (!projectService.get(projectId)) return null;
    return projectId;
  };

  const recordBridgeRequest = (auth: RequestAuthContext | undefined, request: Request, statusCode: number) => {
    if (!bridge || !auth || auth.local || !auth.key) {
      return;
    }

    bridge.store.logBridgeRequest({
      key_name: auth.key.name,
      method: request.method,
      path: new URL(request.url).pathname,
      ip: auth.ip,
      status_code: statusCode,
      created_at: new Date().toISOString(),
    });
  };

  const withScope = <T>(scope: ApiKeyScope, handler: (c: any) => T | Promise<T>) => {
    return async (c: any) => {
      if (!bridge) {
        return handler(c);
      }

      const auth = c.get('auth') as RequestAuthContext | undefined;
      if (auth && !auth.local && (!auth.key || !bridge.apiKeyService.hasScope(auth.key, scope))) {
        return c.json({ error: 'insufficient scopes' }, 403);
      }

      return handler(c);
    };
  };

  if (bridge) {
    app.use('*', async (c, next) => {
      const requestUrl = new URL(c.req.url);
      const auth: RequestAuthContext = {
        local: isLocalHost(requestUrl.hostname),
        ip: getRequestIp(c.req.raw),
        key: null,
      };

      if (auth.local) {
        c.set('auth', auth);
        return next();
      }

      if (!bridge.config.bridge.enabled) {
        return c.json({ error: 'bridge is disabled' }, 503);
      }

      const contentLength = Number(c.req.header('content-length'));
      if (
        Number.isFinite(contentLength) &&
        contentLength > parseBodySize(bridge.config.bridge.max_body_size)
      ) {
        return c.json({ error: 'request body too large' }, 413);
      }

      const authorization = c.req.header('authorization')?.trim();
      if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) {
        return c.json({ error: 'missing or malformed Authorization header' }, 401);
      }

      const key = bridge.apiKeyService.authenticate(authorization.replace(/^Bearer\s+/i, '').trim());
      if (!key) {
        return c.json({ error: 'invalid or expired api key' }, 401);
      }

      auth.key = key;
      bridge.apiKeyService.touch(key.id);
      c.set('auth', auth);

      const bridgeState = bridge.store.getBridgeState();
      if (bridgeState.paused) {
        recordBridgeRequest(auth, c.req.raw, 503);
        return c.json({ error: 'bridge is paused' }, 503);
      }

      if (
        bridge.config.bridge.ip_allowlist.length > 0 &&
        !bridge.config.bridge.ip_allowlist.includes(auth.ip)
      ) {
        recordBridgeRequest(auth, c.req.raw, 403);
        return c.json({ error: 'request ip is not allowed' }, 403);
      }

      const limit =
        bridge.config.bridge.rate_limit.per_key[key.name] ?? bridge.config.bridge.rate_limit.default;
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      if (bridge.store.countBridgeRequestsSince(key.name, cutoff) >= limit) {
        recordBridgeRequest(auth, c.req.raw, 429);
        return c.json({ error: 'rate limit exceeded for this key' }, 429);
      }

      await next();
      recordBridgeRequest(auth, c.req.raw, c.res.status);
    });
  }

  // --- agents ---

  app.post('/agents', withScope('admin', async (c) => {
    try {
      const body = await c.req.json();
      const agent = agentService.register(body);
      return c.json(agent, 201);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.get('/agents', withScope('admin', (c) => {
    return c.json(agentService.list());
  }));

  app.delete('/agents/:agent_id', withScope('admin', (c) => {
    const agentId = c.req.param('agent_id');
    const removed = agentService.disconnect(agentId);
    if (!removed) return c.json({ error: 'agent not found' }, 404);
    return c.json({ ok: true });
  }));

  // --- projects ---

  app.post('/projects', withScope('admin', async (c) => {
    try {
      const body = await c.req.json();
      const project = projectService.create(body);
      return c.json(project, 201);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.get('/projects', withScope('tasks:read', (c) => {
    const includeArchived = c.req.query('include_archived') === 'true';
    return c.json(projectService.list({ includeArchived }));
  }));

  app.get('/projects/:project_id', withScope('tasks:read', (c) => {
    const project = projectService.get(c.req.param('project_id'));
    if (!project) return c.json({ error: 'project not found' }, 404);
    return c.json(project);
  }));

  app.patch('/projects/:project_id', withScope('admin', async (c) => {
    try {
      const body = await c.req.json();
      const project = projectService.update(c.req.param('project_id'), body);
      return c.json(project);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  // --- project-scoped tasks ---

  app.get('/projects/:project_id/tasks', withScope('tasks:read', (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    const filter: Record<string, unknown> = { project_id: projectId };
    const status = c.req.query('status');
    if (status) filter.status = status as TaskStatus;
    const priorityMax = c.req.query('priority_max');
    if (priorityMax) filter.priority_max = Number(priorityMax) as TaskPriority;
    const scope = c.req.query('scope');
    if (scope) filter.scope = scope;
    const limit = c.req.query('limit');
    if (limit) filter.limit = Number(limit);
    return c.json(taskService.list(filter));
  }));

  app.post('/projects/:project_id/tasks', withScope('tasks:write', async (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const body = await c.req.json();
      const task = taskService.create({ ...body, project_id: projectId });
      return c.json(task, 201);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.get('/projects/:project_id/tasks/:id', withScope('tasks:read', (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    const task = taskService.get(c.req.param('id'));
    if (!task) return c.json({ error: 'task not found' }, 404);
    return c.json(task);
  }));

  app.post('/projects/:project_id/tasks/:id/claim', withScope('tasks:claim', async (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const { agent_id } = await c.req.json();
      const task = taskService.claim(c.req.param('id'), agent_id);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.patch('/projects/:project_id/tasks/:id/status', withScope('status:write', async (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const { status, message } = await c.req.json();
      const task = taskService.updateStatus(c.req.param('id'), status, message);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.post('/projects/:project_id/tasks/:id/result', withScope('result:write', async (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const { result_type, result_data, summary } = await c.req.json();
      const task = taskService.submitResult(c.req.param('id'), result_type, result_data, summary);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.get('/projects/:project_id/tasks/:id/feedback', withScope('feedback:read', (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const result = taskService.getFeedback(c.req.param('id'));
      return c.json(result);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.post('/projects/:project_id/tasks/:id/feedback', withScope('feedback:write', async (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const { feedback } = await c.req.json();
      const task = taskService.giveFeedback(c.req.param('id'), feedback);
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.post('/projects/:project_id/tasks/:id/approve', withScope('admin', (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const task = taskService.approve(c.req.param('id'));
      return c.json(task);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  // --- SSE events ---

  app.get('/events', withScope('events:read', (c) => {
    const filterProjectId = c.req.query('project_id');
    return streamSSE(c, async (stream) => {
      const unsubscribe = eventBus.on('*', (event) => {
        if (filterProjectId) {
          const taskData = event.data.task as Record<string, unknown> | undefined;
          if (taskData && taskData.project_id !== filterProjectId) return;
        }
        stream.writeSSE({
          event: event.type,
          data: JSON.stringify(event),
          id: event.timestamp,
        });
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      await new Promise<void>((resolve) => {
        stream.onAbort(() => resolve());
      });
    });
  }));

  // --- project-scoped bridge hooks ---

  app.post('/projects/:project_id/hooks/ingest', withScope('tasks:write', async (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const body = await c.req.json();
      if (body.batch === true) {
        if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
          throw new Error('tasks are required');
        }

        const tasks = taskService.createBatch(body.tasks.map((task: Record<string, unknown>) => ({
          title: task.title ?? `Webhook: ${task.type ?? 'external'}`,
          description: task.description ?? task.summary,
          scope: task.scope,
          source: task.source,
          source_session_id: task.source_session_id,
          context: task.context ?? {},
          dependencies: task.dependencies ?? [],
          priority: task.priority ?? 2,
          project_id: projectId,
        })));

        return c.json(
          {
            created: true,
            count: tasks.length,
            tasks: tasks.map((task) => toBridgeTask(task)),
          },
          201,
        );
      }

      const task = taskService.create({
        title: body.title ?? `Webhook: ${body.type ?? 'external'}`,
        description: body.description ?? body.summary,
        scope: body.scope,
        source: body.source,
        source_session_id: body.source_session_id,
        context: body.context ?? {},
        dependencies: body.dependencies ?? [],
        priority: body.priority ?? 2,
        project_id: projectId,
      });
      return c.json({ created: true, task: toBridgeTask(task) }, 201);
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.post('/projects/:project_id/hooks/feedback', withScope('feedback:write', async (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    try {
      const body = await c.req.json();
      const task = taskService.giveFeedback(body.task_id, body.feedback);
      return c.json({ updated: true, task });
    } catch (e) {
      const msg = (e as Error).message;
      return c.json({ error: msg }, errorStatus(msg));
    }
  }));

  app.get('/projects/:project_id/hooks/status', withScope('tasks:read', (c) => {
    const projectId = resolveProject(c);
    if (!projectId) return c.json({ error: 'project not found' }, 404);
    const taskId = c.req.query('task_id');
    if (taskId) {
      const task = taskService.get(taskId);
      if (!task) {
        return c.json({ error: 'task not found' }, 404);
      }
      return c.json({ task });
    }

    const filter: Record<string, unknown> = { project_id: projectId };
    const status = c.req.query('status');
    if (status) filter.status = status as TaskStatus;
    const scope = c.req.query('scope');
    if (scope) filter.scope = scope;
    const limit = c.req.query('limit');
    if (limit) filter.limit = Number(limit);

    return c.json({ tasks: taskService.list(filter) });
  }));

  return app;
}
