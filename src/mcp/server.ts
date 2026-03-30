import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { TaskService } from '../core/task-service.js';
import type { AgentService } from '../core/agent-service.js';
import type { EventBus } from '../events/event-bus.js';
import type { TaskStatus, TaskPriority, ResultType } from '../types.js';

export interface McpServerDeps {
  taskService: TaskService;
  agentService: AgentService;
  eventBus: EventBus;
}

export function createMcpServer(deps: McpServerDeps): McpServer {
  const { taskService, agentService } = deps;

  const server = new McpServer({
    name: 'conductor',
    version: '0.1.0',
  });

  // conductor_register - register an agent session
  server.tool(
    'conductor_register',
    'Register an agent session with the conductor',
    {
      agent_id: z.string(),
      runtime: z.string().optional(),
      capabilities: z.array(z.string()).optional(),
      scope: z.string().optional(),
    },
    async (params) => {
      try {
        const agent = agentService.register({
          agent_id: params.agent_id,
          runtime: params.runtime,
          capabilities: params.capabilities,
          scope: params.scope,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ registered: true, agent_id: agent.agent_id }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  // conductor_list_tasks - list available tasks
  server.tool(
    'conductor_list_tasks',
    'List available tasks',
    {
      status: z.string().optional().default('available'),
      priority_max: z.number().optional(),
      scope: z.string().optional(),
      limit: z.number().optional().default(10),
    },
    async (params) => {
      try {
        const tasks = taskService.list({
          status: params.status as TaskStatus,
          priority_max: params.priority_max as TaskPriority | undefined,
          scope: params.scope,
          limit: params.limit,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ tasks }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  // conductor_claim_task - atomically claim a task
  server.tool(
    'conductor_claim_task',
    'Atomically claim a task for an agent',
    {
      task_id: z.string(),
      agent_id: z.string(),
    },
    async (params) => {
      try {
        const task = taskService.claim(params.task_id, params.agent_id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ claimed: true, task }) }],
        };
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ claimed: false, error: String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  // conductor_update_status - push a status transition
  server.tool(
    'conductor_update_status',
    'Push a status transition on a task',
    {
      task_id: z.string(),
      status: z.string(),
      message: z.string().optional(),
    },
    async (params) => {
      try {
        const task = taskService.updateStatus(
          params.task_id,
          params.status as TaskStatus,
          params.message,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ updated: true, task }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  // conductor_submit_result - submit work product
  server.tool(
    'conductor_submit_result',
    'Submit work product for a task',
    {
      task_id: z.string(),
      result_type: z.string(),
      result_data: z.string(),
      summary: z.string().optional(),
    },
    async (params) => {
      try {
        const task = taskService.submitResult(
          params.task_id,
          params.result_type as ResultType,
          params.result_data,
          params.summary,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ submitted: true, task }) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  // conductor_get_feedback - check for human review feedback
  server.tool(
    'conductor_get_feedback',
    'Check for human review feedback on a task',
    {
      task_id: z.string(),
    },
    async (params) => {
      try {
        const result = taskService.getFeedback(params.task_id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ error: String(err) }) }],
          isError: true,
        };
      }
    },
  );

  return server;
}
