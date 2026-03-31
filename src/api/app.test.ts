import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Store } from '../store/store.js';
import { EventBus } from '../events/event-bus.js';
import { TaskService } from '../core/task-service.js';
import { AgentService } from '../core/agent-service.js';
import { ProjectService } from '../core/project-service.js';
import { createApp } from './app.js';

describe('API routes', () => {
  let store: Store;
  let events: EventBus;
  let projectService: ProjectService;
  let app: ReturnType<typeof createApp>;
  let defaultProjectId: string;

  beforeEach(() => {
    store = new Store(':memory:');
    events = new EventBus();
    const taskService = new TaskService(store, events);
    const agentService = new AgentService(store, events);
    projectService = new ProjectService(store);
    app = createApp({ taskService, agentService, projectService, eventBus: events });
    defaultProjectId = projectService.getByName('default')!.id;
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

  // --- projects ---

  describe('POST /projects', () => {
    it('creates a project', async () => {
      const res = await req('POST', '/projects', { name: 'my-app' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('my-app');
      expect(body.id).toMatch(/^proj_/);
    });

    it('returns 400 for missing name', async () => {
      const res = await req('POST', '/projects', {});
      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      await req('POST', '/projects', { name: 'dupe' });
      const res = await req('POST', '/projects', { name: 'dupe' });
      expect(res.status).toBe(409);
    });
  });

  describe('GET /projects', () => {
    it('lists projects including default', async () => {
      const res = await req('GET', '/projects');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.some((p: any) => p.name === 'default')).toBe(true);
    });
  });

  describe('GET /projects/:project_id', () => {
    it('returns a project', async () => {
      const createRes = await req('POST', '/projects', { name: 'get-me' });
      const created = await createRes.json();
      const res = await req('GET', `/projects/${created.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('get-me');
    });

    it('returns 404 for nonexistent', async () => {
      const res = await req('GET', '/projects/proj_nope');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /projects/:project_id', () => {
    it('updates a project', async () => {
      const createRes = await req('POST', '/projects', { name: 'old' });
      const created = await createRes.json();
      const res = await req('PATCH', `/projects/${created.id}`, { description: 'updated' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.description).toBe('updated');
    });
  });

  // --- tasks (project-scoped) ---

  describe('POST /projects/:project_id/tasks', () => {
    it('creates a task', async () => {
      const res = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'New task' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.title).toBe('New task');
      expect(body.status).toBe('available');
    });

    it('returns 400 for missing title', async () => {
      const res = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /projects/:project_id/tasks', () => {
    it('lists tasks', async () => {
      await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'B' });

      const res = await req('GET', `/projects/${defaultProjectId}/tasks`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });

    it('filters by status query param', async () => {
      await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const res = await req('GET', `/projects/${defaultProjectId}/tasks?status=claimed`);
      const body = await res.json();
      expect(body).toHaveLength(0);
    });
  });

  describe('GET /projects/:project_id/tasks/:id', () => {
    it('gets a task', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'Find me' });
      const { id } = await createRes.json();

      const res = await req('GET', `/projects/${defaultProjectId}/tasks/${id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.id).toBe(id);
    });

    it('returns 404 for nonexistent', async () => {
      const res = await req('GET', `/projects/${defaultProjectId}/tasks/task_nope`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /projects/:project_id/tasks/:id/claim', () => {
    it('claims a task', async () => {
      await req('POST', '/agents', { agent_id: 'agent-1' });
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'Grab me' });
      const { id } = await createRes.json();

      const res = await req('POST', `/projects/${defaultProjectId}/tasks/${id}/claim`, { agent_id: 'agent-1' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('claimed');
    });

    it('returns 409 if already claimed', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();

      await req('POST', `/projects/${defaultProjectId}/tasks/${id}/claim`, { agent_id: 'agent-1' });
      const res = await req('POST', `/projects/${defaultProjectId}/tasks/${id}/claim`, { agent_id: 'agent-2' });
      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /projects/:project_id/tasks/:id/status', () => {
    it('updates task status', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/projects/${defaultProjectId}/tasks/${id}/claim`, { agent_id: 'agent-1' });

      const res = await req('PATCH', `/projects/${defaultProjectId}/tasks/${id}/status`, { status: 'working' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('working');
    });

    it('returns 409 for invalid transition', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();

      const res = await req('PATCH', `/projects/${defaultProjectId}/tasks/${id}/status`, { status: 'done' });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /projects/:project_id/tasks/:id/result', () => {
    it('submits a result', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/projects/${defaultProjectId}/tasks/${id}/claim`, { agent_id: 'agent-1' });
      await req('PATCH', `/projects/${defaultProjectId}/tasks/${id}/status`, { status: 'working' });

      const res = await req('POST', `/projects/${defaultProjectId}/tasks/${id}/result`, {
        result_type: 'text',
        result_data: 'done',
        summary: 'all good',
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('review');
      expect(body.result.result_type).toBe('text');
    });

    it('returns 409 when task is not working', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();
      const res = await req('POST', `/projects/${defaultProjectId}/tasks/${id}/result`, {
        result_type: 'text',
        result_data: 'nope',
      });
      expect(res.status).toBe(409);
    });
  });

  describe('feedback endpoints', () => {
    it('gets and posts feedback', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/projects/${defaultProjectId}/tasks/${id}/claim`, { agent_id: 'agent-1' });
      await req('PATCH', `/projects/${defaultProjectId}/tasks/${id}/status`, { status: 'working' });
      await req('POST', `/projects/${defaultProjectId}/tasks/${id}/result`, {
        result_type: 'text',
        result_data: 'done',
      });

      // get feedback (none yet)
      const getFb = await req('GET', `/projects/${defaultProjectId}/tasks/${id}/feedback`);
      expect(getFb.status).toBe(200);
      const fbBody = await getFb.json();
      expect(fbBody.has_feedback).toBe(false);

      // give feedback
      const postFb = await req('POST', `/projects/${defaultProjectId}/tasks/${id}/feedback`, { feedback: 'fix X' });
      expect(postFb.status).toBe(200);
      const postBody = await postFb.json();
      expect(postBody.status).toBe('working');
    });
  });

  describe('POST /projects/:project_id/tasks/:id/approve', () => {
    it('approves a task in review', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();
      await req('POST', `/projects/${defaultProjectId}/tasks/${id}/claim`, { agent_id: 'agent-1' });
      await req('PATCH', `/projects/${defaultProjectId}/tasks/${id}/status`, { status: 'working' });
      await req('POST', `/projects/${defaultProjectId}/tasks/${id}/result`, {
        result_type: 'text',
        result_data: 'done',
      });

      const res = await req('POST', `/projects/${defaultProjectId}/tasks/${id}/approve`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('done');
    });

    it('returns 409 when task is not in review', async () => {
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'A' });
      const { id } = await createRes.json();
      const res = await req('POST', `/projects/${defaultProjectId}/tasks/${id}/approve`);
      expect(res.status).toBe(409);
    });
  });

  describe('POST /projects/:project_id/hooks/ingest', () => {
    it('creates a task from webhook payload', async () => {
      const res = await req('POST', `/projects/${defaultProjectId}/hooks/ingest`, {
        title: 'From webhook',
        type: 'alert',
        priority: 1,
      });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.created).toBe(true);
      expect(body.task.title).toBe('From webhook');
      expect(body.task.priority).toBe(1);
    });

    it('uses default title when none provided', async () => {
      const res = await req('POST', `/projects/${defaultProjectId}/hooks/ingest`, { type: 'deploy' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.task.title).toBe('Webhook: deploy');
    });
  });

  // --- full lifecycle ---

  describe('full lifecycle', () => {
    it('create -> claim -> working -> submit result -> approve', async () => {
      await req('POST', '/agents', { agent_id: 'bot-1', runtime: 'claude' });

      // create
      const createRes = await req('POST', `/projects/${defaultProjectId}/tasks`, {
        title: 'Implement feature X',
        description: 'Build the thing',
        priority: 1,
      });
      expect(createRes.status).toBe(201);
      const task = await createRes.json();
      expect(task.status).toBe('available');

      // claim
      const claimRes = await req('POST', `/projects/${defaultProjectId}/tasks/${task.id}/claim`, { agent_id: 'bot-1' });
      expect(claimRes.status).toBe(200);
      const claimed = await claimRes.json();
      expect(claimed.status).toBe('claimed');
      expect(claimed.claimed_by).toBe('bot-1');

      // working
      const workingRes = await req('PATCH', `/projects/${defaultProjectId}/tasks/${task.id}/status`, { status: 'working' });
      expect(workingRes.status).toBe(200);
      expect((await workingRes.json()).status).toBe('working');

      // submit result
      const resultRes = await req('POST', `/projects/${defaultProjectId}/tasks/${task.id}/result`, {
        result_type: 'diff',
        result_data: '--- a/foo\n+++ b/foo',
        summary: 'implemented feature X',
      });
      expect(resultRes.status).toBe(200);
      const reviewed = await resultRes.json();
      expect(reviewed.status).toBe('review');
      expect(reviewed.result.result_type).toBe('diff');

      // approve
      const approveRes = await req('POST', `/projects/${defaultProjectId}/tasks/${task.id}/approve`);
      expect(approveRes.status).toBe(200);
      const done = await approveRes.json();
      expect(done.status).toBe('done');

      // verify final state
      const getRes = await req('GET', `/projects/${defaultProjectId}/tasks/${task.id}`);
      const final = await getRes.json();
      expect(final.status).toBe('done');
      expect(final.result.summary).toBe('implemented feature X');
    });
  });

  // --- project-scoped task routes ---

  describe('project-scoped task routes', () => {
    let projectId: string;

    beforeEach(async () => {
      const res = await req('POST', '/projects', { name: 'test-proj' });
      const body = await res.json();
      projectId = body.id;
    });

    it('POST /projects/:id/tasks creates a task in that project', async () => {
      const res = await req('POST', `/projects/${projectId}/tasks`, { title: 'Scoped task' });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.project_id).toBe(projectId);
    });

    it('GET /projects/:id/tasks lists only tasks for that project', async () => {
      await req('POST', `/projects/${projectId}/tasks`, { title: 'In project' });
      await req('POST', `/projects/${defaultProjectId}/tasks`, { title: 'In default' });

      const res = await req('GET', `/projects/${projectId}/tasks`);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe('In project');
    });

    it('returns 404 for nonexistent project', async () => {
      const res = await req('GET', '/projects/proj_nope/tasks');
      expect(res.status).toBe(404);
    });
  });
});
