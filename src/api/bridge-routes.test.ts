import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { TaskService } from '../core/task-service.js';
import { AgentService } from '../core/agent-service.js';
import { ApiKeyService } from '../bridge/api-key-service.js';
import { ProjectService } from '../core/project-service.js';
import { createApp } from './app.js';
import type { RiffConfig } from '../config/config.js';

describe('Bridge routes', () => {
  let store: Store;
  let events: EventBus;
  let taskService: TaskService;
  let agentService: AgentService;
  let apiKeyService: ApiKeyService;
  let config: RiffConfig;
  let app: ReturnType<typeof createApp>;
  let defaultProjectId: string;

  beforeEach(() => {
    store = new Store(':memory:');
    events = new EventBus();
    taskService = new TaskService(store, events);
    agentService = new AgentService(store, events);
    apiKeyService = new ApiKeyService(store);
    const projectService = new ProjectService(store);
    defaultProjectId = projectService.getByName('default')!.id;
    config = {
      port: 7400,
      store: ':memory:',
      bridge: {
        enabled: true,
        tunnel: 'cloudflare',
        bind: '127.0.0.1',
        rate_limit: {
          default: 60,
          per_key: {},
        },
        ip_allowlist: [],
        max_body_size: '1mb',
        cors: {
          origins: [],
        },
      },
      log: {
        level: 'info',
        bridge_requests: true,
      },
      config_path: null,
    };

    app = createApp({
      taskService,
      agentService,
      eventBus: events,
      store,
      apiKeyService,
      config,
      projectService,
    });
  });

  afterEach(() => {
    store.close();
  });

  function rebuildApp() {
    const projectService = new ProjectService(store);
    app = createApp({
      taskService,
      agentService,
      eventBus: events,
      store,
      apiKeyService,
      config,
      projectService,
    });
  }

  async function remoteReq(
    method: string,
    path: string,
    {
      token,
      body,
      ip = '203.0.113.10',
    }: { token?: string; body?: unknown; ip?: string } = {},
  ) {
    const headers = new Headers({
      Host: 'riff.example.com',
      'X-Forwarded-For': ip,
    });

    if (body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    return app.request(
      new Request(`https://riff.example.com/api/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  function localReq(method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) init.body = JSON.stringify(body);
    return app.request(`/api/v1${path}`, init);
  }

  it('requires bearer auth for remote requests and preserves localhost access', async () => {
    const remote = await remoteReq('GET', `/projects/${defaultProjectId}/tasks`);
    expect(remote.status).toBe(401);

    const local = await localReq('GET', `/projects/${defaultProjectId}/tasks`);
    expect(local.status).toBe(200);
  });

  it('rejects valid keys without the required scope', async () => {
    const key = apiKeyService.create({
      name: 'writer',
      scopes: ['tasks:write'],
    });

    const res = await remoteReq('GET', `/projects/${defaultProjectId}/tasks`, { token: key.plaintext });
    expect(res.status).toBe(403);
  });

  it('ingests a batch of tasks, resolves batch dependencies, and records request usage', async () => {
    const key = apiKeyService.create({
      name: 'claude-ai',
      scopes: ['tasks:write'],
    });

    const res = await remoteReq('POST', `/projects/${defaultProjectId}/hooks/ingest`, {
      token: key.plaintext,
      body: {
        batch: true,
        tasks: [
          {
            title: 'Add validation',
            priority: 1,
            scope: 'my-app',
            source: 'claude-ai',
          },
          {
            title: 'Add tests',
            priority: 2,
            scope: 'my-app',
            dependencies: ['$0'],
          },
        ],
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created).toBe(true);
    expect(body.count).toBe(2);

    const tasks = store.listTasks({ scope: 'my-app' });
    expect(tasks).toHaveLength(2);
    expect(tasks[1].dependencies).toEqual([tasks[0].id]);
    expect(tasks[0].source).toBe('claude-ai');

    const logEntry = store.getLatestBridgeRequest();
    expect(logEntry?.key_name).toBe('claude-ai');
    expect(store.listApiKeys()[0].last_used).not.toBeNull();
  });

  it('returns quick status lookups by task id and filtered task lists', async () => {
    const first = taskService.create({ title: 'Scoped task', scope: 'my-app' });
    taskService.create({ title: 'Other task', scope: 'other-app' });

    const key = apiKeyService.create({
      name: 'reader',
      scopes: ['tasks:read'],
    });

    const single = await remoteReq('GET', `/projects/${defaultProjectId}/hooks/status?task_id=${first.id}`, {
      token: key.plaintext,
    });
    expect(single.status).toBe(200);
    expect((await single.json()).task.id).toBe(first.id);

    const filtered = await remoteReq('GET', `/projects/${defaultProjectId}/hooks/status?scope=my-app&status=available`, {
      token: key.plaintext,
    });
    expect(filtered.status).toBe(200);
    const filteredBody = await filtered.json();
    expect(filteredBody.tasks).toHaveLength(1);
    expect(filteredBody.tasks[0].scope).toBe('my-app');
  });

  it('supports remote feedback and worker task execution with scoped keys', async () => {
    const feedbackTask = taskService.create({ title: 'Needs review' });
    taskService.claim(feedbackTask.id, 'agent-1');
    taskService.updateStatus(feedbackTask.id, 'working');
    taskService.submitResult(feedbackTask.id, 'text', 'done');

    const feedbackKey = apiKeyService.create({
      name: 'review-bot',
      scopes: ['feedback:write'],
    });

    const feedbackRes = await remoteReq('POST', `/projects/${defaultProjectId}/hooks/feedback`, {
      token: feedbackKey.plaintext,
      body: {
        task_id: feedbackTask.id,
        feedback: 'Please add a fallback branch.',
        source: 'review-bot',
      },
    });
    expect(feedbackRes.status).toBe(200);
    expect((await feedbackRes.json()).task.status).toBe('working');

    const workerTask = taskService.create({ title: 'Remote worker task' });
    const workerKey = apiKeyService.create({
      name: 'codex-remote',
      scopes: ['tasks:claim', 'status:write', 'result:write'],
    });

    const claimRes = await remoteReq('POST', `/projects/${defaultProjectId}/tasks/${workerTask.id}/claim`, {
      token: workerKey.plaintext,
      body: { agent_id: 'codex-remote-01' },
    });
    expect(claimRes.status).toBe(200);

    const statusRes = await remoteReq('PATCH', `/projects/${defaultProjectId}/tasks/${workerTask.id}/status`, {
      token: workerKey.plaintext,
      body: { status: 'working' },
    });
    expect(statusRes.status).toBe(200);

    const resultRes = await remoteReq('POST', `/projects/${defaultProjectId}/tasks/${workerTask.id}/result`, {
      token: workerKey.plaintext,
      body: {
        result_type: 'text',
        result_data: 'Finished remotely',
        summary: 'Remote worker completed the change',
      },
    });
    expect(resultRes.status).toBe(200);
    expect((await resultRes.json()).status).toBe('review');
  });

  it('rate limits requests per key', async () => {
    config = {
      ...config,
      bridge: {
        ...config.bridge,
        rate_limit: {
          default: 1,
          per_key: {},
        },
      },
    };
    rebuildApp();

    const key = apiKeyService.create({
      name: 'reader',
      scopes: ['tasks:read'],
    });

    expect((await remoteReq('GET', `/projects/${defaultProjectId}/hooks/status?status=available`, { token: key.plaintext })).status).toBe(
      200,
    );
    expect((await remoteReq('GET', `/projects/${defaultProjectId}/hooks/status?status=available`, { token: key.plaintext })).status).toBe(
      429,
    );
  });

  it('enforces ip allowlists and supports pausing the bridge', async () => {
    config = {
      ...config,
      bridge: {
        ...config.bridge,
        ip_allowlist: ['203.0.113.10'],
      },
    };
    rebuildApp();

    const key = apiKeyService.create({
      name: 'reader',
      scopes: ['tasks:read'],
    });

    const blocked = await remoteReq('GET', `/projects/${defaultProjectId}/hooks/status?status=available`, {
      token: key.plaintext,
      ip: '198.51.100.5',
    });
    expect(blocked.status).toBe(403);

    store.setBridgeState({
      paused: true,
      public_url: null,
      tunnel: 'cloudflare',
      updated_at: new Date().toISOString(),
    });

    const paused = await remoteReq('GET', `/projects/${defaultProjectId}/hooks/status?status=available`, {
      token: key.plaintext,
    });
    expect(paused.status).toBe(503);

    const local = await localReq('GET', `/projects/${defaultProjectId}/tasks`);
    expect(local.status).toBe(200);
  });
});
