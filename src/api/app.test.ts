import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { TaskService } from '../core/task-service.js';
import { AgentService } from '../core/agent-service.js';
import { createApp } from './app.js';

describe('API routes', () => {
  let store: Store;
  let events: EventBus;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    store = new Store(':memory:');
    events = new EventBus();
    const taskService = new TaskService(store, events);
    const agentService = new AgentService(store, events);
    app = createApp({ taskService, agentService, eventBus: events });
  });

  afterEach(() => {
    store.close();
  });

  function req(method: string, path: string, body?: unknown) {
    const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) init.body = JSON.stringify(body);
    return app.request(`/api/v1${path}`, init);
  }

  // --- agents ---

  describe('POST /agents', () => {
    it('registers an agent', async () => {
      const res = await req('POST', '/agents', { agent_id: 'agent-1' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.agent_id).toBe('agent-1');
    });

    it('returns 400 for empty agent_id', async () => {
      const res = await req('POST', '/agents', { agent_id: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /agents', () => {
    it('lists agents', async () => {
      await req('POST', '/agents', { agent_id: 'a' });
      await req('POST', '/agents', { agent_id: 'b' });

      const res = await req('GET', '/agents');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });
  });

  describe('DELETE /agents/:agent_id', () => {
    it('removes an agent', async () => {
      await req('POST', '/agents', { agent_id: 'agent-1' });
      const res = await req('DELETE', '/agents/agent-1');
      expect(res.status).toBe(200);
    });

    it('returns 404 for nonexistent', async () => {
      const res = await req('DELETE', '/agents/nope');
      expect(res.status).toBe(404);
    });
  });

  // --- tasks ---

  describe('POST /tasks', () => {
    it('creates a task', async () => {
      const res = await req('POST', '/tasks', { title: 'New task' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('New task');
      expect(body.status).toBe('available');
    });

    it('returns 400 for missing title', async () => {
      const res = await req('POST', '/tasks', { title: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /tasks', () => {
    it('lists tasks', async () => {
      await req('POST', '/tasks', { title: 'A' });
      await req('POST', '/tasks', { title: 'B' });

      const res = await req('GET', '/tasks');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    it('filters by status query param', async () => {
      await req('POST', '/tasks', { title: 'A' });
      const res = await req('GET', '/tasks?status=claimed');
      const body = await res.json();
      expect(body).toHaveLength(0);
    });
  });

  describe('GET /tasks/:id', () => {
    it('gets a task', async () => {
      const createRes = await req('POST', '/tasks', { title: 'Find me' });
      const { id } = await createRes.json();

      const res = await req('GET', `/tasks/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(id);
    });

    it('returns 404 for nonexistent', async () => {
      const res = await req('GET', '/tasks/task_nope');
      expect(res.status).toBe(404);
    });
  });

  describe('POST /tasks/:id/claim', () => {
    it('claims a task', async () => {
      await req('POST', '/agents', { agent_id: 'agent-1' });
      const createRes = await req('POST', '/tasks', { title: 'Grab me' });
      const { id } = await createRes.json();

      const res = await req('POST', `/tasks/${id}/claim`, { agent_id: 'agent-1' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('claimed');
    });

    it('returns 409 if already claimed', async () => {
      const createRes = await req('POST', '/tasks', { title: 'A' });
      const { id } = await createRes.json();

      await req('POST', `/tasks/${id}/claim`, { agent_id: 'agent-1' });
      const res = await req('POST', `/tasks/${id}/claim`, { agent_id: 'agent-2' });
      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /tasks/:id/status', () => {
    it('updates task status', async () => {
      const createRes = await req('POST', '/tasks', { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/tasks/${id}/claim`, { agent_id: 'agent-1' });

      const res = await req('PATCH', `/tasks/${id}/status`, { status: 'working' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('working');
    });

    it('returns 409 for invalid transition', async () => {
      const createRes = await req('POST', '/tasks', { title: 'A' });
      const { id } = await createRes.json();

      const res = await req('PATCH', `/tasks/${id}/status`, { status: 'done' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /tasks/:id/result', () => {
    it('submits a result', async () => {
      const createRes = await req('POST', '/tasks', { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/tasks/${id}/claim`, { agent_id: 'agent-1' });
      await req('PATCH', `/tasks/${id}/status`, { status: 'working' });

      const res = await req('POST', `/tasks/${id}/result`, {
        result_type: 'text',
        result_data: 'done',
        summary: 'all good',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('review');
      expect(body.result.result_type).toBe('text');
    });
  });

  describe('feedback endpoints', () => {
    it('gets and posts feedback', async () => {
      const createRes = await req('POST', '/tasks', { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/tasks/${id}/claim`, { agent_id: 'agent-1' });
      await req('PATCH', `/tasks/${id}/status`, { status: 'working' });
      await req('POST', `/tasks/${id}/result`, {
        result_type: 'text',
        result_data: 'done',
      });

      // get feedback (none yet)
      const getFb = await req('GET', `/tasks/${id}/feedback`);
      expect(getFb.status).toBe(200);
      const fbBody = await getFb.json();
      expect(fbBody.has_feedback).toBe(false);

      // give feedback
      const postFb = await req('POST', `/tasks/${id}/feedback`, { feedback: 'fix X' });
      expect(postFb.status).toBe(200);
      const postBody = await postFb.json();
      expect(postBody.status).toBe('working');
    });
  });

  describe('POST /tasks/:id/approve', () => {
    it('approves a task in review', async () => {
      const createRes = await req('POST', '/tasks', { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/tasks/${id}/claim`, { agent_id: 'agent-1' });
      await req('PATCH', `/tasks/${id}/status`, { status: 'working' });
      await req('POST', `/tasks/${id}/result`, {
        result_type: 'text',
        result_data: 'done',
      });

      const res = await req('POST', `/tasks/${id}/approve`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('done');
    });
  });

  describe('POST /hooks/ingest', () => {
    it('creates a task from webhook payload', async () => {
      const res = await req('POST', '/hooks/ingest', {
        title: 'From webhook',
        type: 'alert',
        priority: 1,
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('From webhook');
      expect(body.priority).toBe(1);
    });

    it('uses default title when none provided', async () => {
      const res = await req('POST', '/hooks/ingest', { type: 'deploy' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('Webhook: deploy');
    });
  });
});
