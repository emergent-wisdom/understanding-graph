#!/usr/bin/env npx tsx
/**
 * Autonomous Agent Worker
 *
 * Polls the task queue, claims tasks, executes them using Claude API,
 * and commits results directly to the graph.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/autonomous-worker.ts
 *
 * Or run multiple workers in parallel for faster processing.
 */

import Anthropic from '@anthropic-ai/sdk';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load shared agent foundation
const AGENT_FOUNDATION_PATH = path.join(__dirname, '..', 'AGENT_FOUNDATION.md');
const AGENT_FOUNDATION = fs.existsSync(AGENT_FOUNDATION_PATH)
  ? fs.readFileSync(AGENT_FOUNDATION_PATH, 'utf-8')
  : '';

if (AGENT_FOUNDATION) {
  console.log(`[INIT] Loaded agent foundation (${AGENT_FOUNDATION.length} chars)`);
} else {
  console.warn('[INIT] Warning: AGENT_FOUNDATION.md not found');
}

// Configuration
const POLL_INTERVAL_MS = 5000; // 5 seconds
const MAX_RETRIES = 3;
const WORKER_ID = `worker_${Math.random().toString(36).slice(2, 8)}`;

// Initialize Anthropic client
const anthropic = new Anthropic();

// Get database path from environment or default
const PROJECT_ID = process.env.PROJECT_ID || 'simulation-protocol';
const DB_PATH = process.env.DB_PATH ||
  path.join(__dirname, '..', 'projects', PROJECT_ID, 'store.db');

console.log(`[${WORKER_ID}] Starting autonomous worker`);
console.log(`[${WORKER_ID}] Database: ${DB_PATH}`);
console.log(`[${WORKER_ID}] Poll interval: ${POLL_INTERVAL_MS}ms`);

// Initialize database connection
let db: Database.Database;
try {
  db = new Database(DB_PATH);
  console.log(`[${WORKER_ID}] Connected to database`);
} catch (error) {
  console.error(`[${WORKER_ID}] Failed to connect to database:`, error);
  process.exit(1);
}

// Define the tools that agents can use to commit to the graph
const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'graph_add_concept',
    description: 'Add a concept to the understanding graph',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Concept name' },
        trigger: {
          type: 'string',
          enum: ['foundation', 'surprise', 'tension', 'consequence', 'repetition', 'question', 'serendipity', 'decision'],
          description: 'Why this concept was added'
        },
        why: { type: 'string', description: 'Why this matters' },
        understanding: { type: 'string', description: 'Your synthesis/understanding' }
      },
      required: ['name', 'trigger', 'why', 'understanding']
    }
  },
  {
    name: 'graph_connect',
    description: 'Connect two concepts in the graph',
    input_schema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Source node name or ID' },
        to: { type: 'string', description: 'Target node name or ID' },
        relation: { type: 'string', description: 'How they relate' },
        why: { type: 'string', description: 'Why this connection matters' }
      },
      required: ['from', 'to', 'relation', 'why']
    }
  },
  {
    name: 'graph_question',
    description: 'Create an open question node',
    input_schema: {
      type: 'object' as const,
      properties: {
        question: { type: 'string', description: 'The question' },
        speculation: { type: 'string', description: 'Initial hypothesis (optional)' }
      },
      required: ['question']
    }
  },
  {
    name: 'submit_result',
    description: 'Submit the final result of your task. Call this when done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: { type: 'string', description: 'Summary of what you accomplished' },
        success: { type: 'boolean', description: 'Whether the task succeeded' }
      },
      required: ['summary', 'success']
    }
  },
  {
    name: 'delegate_task',
    description: 'Delegate a sub-task to another agent. Use this when the task is too complex to handle atomically. You become an orchestrator.',
    input_schema: {
      type: 'object' as const,
      properties: {
        solver_name: { type: 'string', description: 'Name of the solver to delegate to (e.g., EntropyEngine, ResearchAgent, WriterAgent)' },
        task: { type: 'string', description: 'The sub-task description' },
        accept_spec: { type: 'string', description: 'Criteria for success' }
      },
      required: ['solver_name', 'task']
    }
  },
  {
    name: 'check_subtasks',
    description: 'Check status of sub-tasks you delegated. Returns pending/completed status.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  }
];

// Helper to generate IDs
function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${id}`;
}

// Find node by name or ID
function findNode(nameOrId: string): { id: string; name: string } | null {
  const node = db.prepare(`
    SELECT id, json_extract(data, '$.title') as name
    FROM nodes
    WHERE id = ? OR json_extract(data, '$.title') = ?
  `).get(nameOrId, nameOrId) as { id: string; name: string } | undefined;

  return node || null;
}

// Track current task for sub-task delegation
let currentTaskId: string | null = null;

// Find solver by name
function findSolver(name: string): { id: string; name: string } | null {
  const solver = db.prepare(`
    SELECT id, name FROM solvers WHERE name = ?
  `).get(name) as { id: string; name: string } | undefined;
  return solver || null;
}

// Execute graph operations
function executeGraphOperation(toolName: string, input: Record<string, unknown>): { success: boolean; result: unknown } {
  try {
    switch (toolName) {
      case 'graph_add_concept': {
        const id = generateId('n');
        const now = new Date().toISOString();
        const data = {
          text: input.name,
          trigger: input.trigger,
          why: input.why,
          understanding: input.understanding,
          createdAt: now,
          updatedAt: now
        };

        db.prepare(`
          INSERT INTO nodes (id, type, data, created_at, updated_at)
          VALUES (?, 'concept', ?, ?, ?)
        `).run(id, JSON.stringify(data), now, now);

        console.log(`[${WORKER_ID}] Created concept: ${input.name} (${id})`);
        return { success: true, result: { id, name: input.name } };
      }

      case 'graph_connect': {
        const fromNode = findNode(input.from as string);
        const toNode = findNode(input.to as string);

        if (!fromNode || !toNode) {
          return {
            success: false,
            result: `Node not found: ${!fromNode ? input.from : input.to}`
          };
        }

        const id = generateId('e');
        const now = new Date().toISOString();
        const data = {
          relation: input.relation,
          why: input.why
        };

        db.prepare(`
          INSERT INTO edges (id, from_id, to_id, data, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(id, fromNode.id, toNode.id, JSON.stringify(data), now, now);

        console.log(`[${WORKER_ID}] Created edge: ${fromNode.name} → ${toNode.name}`);
        return { success: true, result: { id, from: fromNode.name, to: toNode.name } };
      }

      case 'graph_question': {
        const id = generateId('n');
        const now = new Date().toISOString();
        const data = {
          text: input.question,
          trigger: 'question',
          speculation: input.speculation || null,
          status: 'open',
          createdAt: now,
          updatedAt: now
        };

        db.prepare(`
          INSERT INTO nodes (id, type, data, created_at, updated_at)
          VALUES (?, 'question', ?, ?, ?)
        `).run(id, JSON.stringify(data), now, now);

        console.log(`[${WORKER_ID}] Created question: ${input.question} (${id})`);
        return { success: true, result: { id, question: input.question } };
      }

      case 'submit_result': {
        return {
          success: true,
          result: {
            summary: input.summary,
            taskComplete: true,
            taskSuccess: input.success
          }
        };
      }

      case 'delegate_task': {
        const solver = findSolver(input.solver_name as string);
        if (!solver) {
          return { success: false, result: `Solver not found: ${input.solver_name}` };
        }

        const taskId = generateId('task');
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO tasks (id, solver_id, input_payload, accept_spec, status, parent_task_id, created_at)
          VALUES (?, ?, ?, ?, 'pending', ?, ?)
        `).run(taskId, solver.id, input.task, input.accept_spec || null, currentTaskId, now);

        console.log(`[${WORKER_ID}] Delegated sub-task to ${solver.name}: ${taskId}`);
        return {
          success: true,
          result: {
            task_id: taskId,
            solver: solver.name,
            message: `Sub-task delegated. Another worker will execute it.`
          }
        };
      }

      case 'check_subtasks': {
        if (!currentTaskId) {
          return { success: true, result: { subtasks: [], message: 'No current task context' } };
        }

        const subtasks = db.prepare(`
          SELECT t.id, t.status, s.name as solver_name, t.output_payload
          FROM tasks t
          JOIN solvers s ON t.solver_id = s.id
          WHERE t.parent_task_id = ?
        `).all(currentTaskId) as Array<{
          id: string;
          status: string;
          solver_name: string;
          output_payload: string | null;
        }>;

        const pending = subtasks.filter(t => t.status === 'pending' || t.status === 'processing');
        const completed = subtasks.filter(t => t.status === 'completed');
        const failed = subtasks.filter(t => t.status === 'failed');

        return {
          success: true,
          result: {
            total: subtasks.length,
            pending: pending.length,
            completed: completed.length,
            failed: failed.length,
            all_complete: pending.length === 0 && subtasks.length > 0,
            subtasks: subtasks.map(t => ({
              id: t.id,
              solver: t.solver_name,
              status: t.status,
              result: t.output_payload ? t.output_payload.slice(0, 200) : null
            }))
          }
        };
      }

      default:
        return { success: false, result: `Unknown tool: ${toolName}` };
    }
  } catch (error) {
    console.error(`[${WORKER_ID}] Error executing ${toolName}:`, error);
    return { success: false, result: String(error) };
  }
}

// Claim a pending task from the queue
function claimTask(): {
  taskId: string;
  agentName: string;
  manifest: string;
  input: string;
  acceptSpec: string;
} | null {
  const task = db.prepare(`
    SELECT t.id, t.input_payload, t.accept_spec, s.name, s.manifest
    FROM tasks t
    JOIN solvers s ON t.solver_id = s.id
    WHERE t.status = 'pending'
    ORDER BY t.created_at ASC
    LIMIT 1
  `).get() as {
    id: string;
    input_payload: string;
    accept_spec: string;
    name: string;
    manifest: string;
  } | undefined;

  if (!task) return null;

  // Lock the task
  db.prepare(`
    UPDATE tasks
    SET status = 'processing', updated_at = datetime('now')
    WHERE id = ?
  `).run(task.id);

  console.log(`[${WORKER_ID}] Claimed task ${task.id} for ${task.name}`);

  return {
    taskId: task.id,
    agentName: task.name,
    manifest: task.manifest,
    input: task.input_payload,
    acceptSpec: task.accept_spec || ''
  };
}

// Complete a task
function completeTask(taskId: string, result: string, success: boolean): void {
  const status = success ? 'completed' : 'failed';

  db.prepare(`
    UPDATE tasks
    SET status = ?, output_payload = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(status, result, taskId);

  console.log(`[${WORKER_ID}] Task ${taskId} ${status}`);
}

// Create a session for real-time UI visibility
function startSession(agentName: string, taskInput: string): string {
  const sessionId = generateId('session');
  const now = new Date().toISOString();
  const query = `[${agentName}] ${taskInput.slice(0, 200)}${taskInput.length > 200 ? '...' : ''}`;

  db.prepare(`
    INSERT INTO conversations (id, query, created_at, metadata)
    VALUES (?, ?, ?, ?)
  `).run(sessionId, query, now, JSON.stringify({
    agent: agentName,
    worker: WORKER_ID,
    type: 'agent_session',
    status: 'in_progress'
  }));

  console.log(`[${WORKER_ID}] Started session ${sessionId} for ${agentName}`);
  return sessionId;
}

// Complete a session with summary
function completeSession(sessionId: string, summary: string, success: boolean): void {
  db.prepare(`
    UPDATE conversations
    SET response = ?,
        metadata = json_set(metadata, '$.status', ?, '$.completed_at', ?)
    WHERE id = ?
  `).run(summary, success ? 'completed' : 'failed', new Date().toISOString(), sessionId);

  console.log(`[${WORKER_ID}] Completed session ${sessionId}`);
}

// Log an event during a session (for real-time updates)
function logSessionEvent(sessionId: string, action: string, entityType: string, entityId: string, summary: string): void {
  db.prepare(`
    INSERT INTO event_log (action, entity_type, entity_id, conversation_id, summary)
    VALUES (?, ?, ?, ?, ?)
  `).run(action, entityType, entityId, sessionId, summary);
}

// Execute a task using Claude
async function executeTask(task: {
  taskId: string;
  agentName: string;
  manifest: string;
  input: string;
  acceptSpec: string;
}): Promise<void> {
  console.log(`[${WORKER_ID}] Executing task as ${task.agentName}...`);

  // Set current task ID for sub-task delegation
  currentTaskId = task.taskId;

  // Start a session for real-time UI visibility
  const sessionId = startSession(task.agentName, task.input);

  const systemPrompt = `${AGENT_FOUNDATION}

---

# Your Role

${task.manifest}

---

When you are done, call submit_result with a summary of what you accomplished.

IMPORTANT: You MUST call submit_result when finished. Do not just respond with text.`;

  const userMessage = `TASK: ${task.input}

ACCEPTANCE CRITERIA: ${task.acceptSpec || 'Complete the task as specified.'}

Execute this task now. Use the graph tools to make changes, then call submit_result when done.`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage }
  ];

  let taskComplete = false;
  let taskSuccess = false;
  let resultSummary = '';
  let iterations = 0;
  const maxIterations = 10;

  while (!taskComplete && iterations < maxIterations) {
    iterations++;

    try {
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: systemPrompt,
        tools: AGENT_TOOLS,
        messages
      });

      // Process the response
      const assistantContent: Anthropic.ContentBlock[] = [];

      for (const block of response.content) {
        assistantContent.push(block);

        if (block.type === 'tool_use') {
          console.log(`[${WORKER_ID}] Tool call: ${block.name}`);

          const result = executeGraphOperation(block.name, block.input as Record<string, unknown>);

          // Log event for real-time UI updates
          if (result.success && block.name !== 'submit_result') {
            const resultData = result.result as Record<string, unknown>;
            const entityId = (resultData.id as string) || task.taskId;
            const summary = block.name === 'graph_add_concept'
              ? `Added concept: ${resultData.name}`
              : block.name === 'graph_connect'
                ? `Connected: ${resultData.from} → ${resultData.to}`
                : block.name === 'graph_question'
                  ? `Asked: ${resultData.question}`
                  : `Executed: ${block.name}`;
            logSessionEvent(sessionId, 'create', block.name.replace('graph_', ''), entityId, summary);
          }

          // Check if this is the final submit
          if (block.name === 'submit_result' && result.success) {
            const submitResult = result.result as { summary: string; taskComplete: boolean; taskSuccess: boolean };
            taskComplete = submitResult.taskComplete;
            taskSuccess = submitResult.taskSuccess;
            resultSummary = submitResult.summary;
          }

          // Add tool result to messages
          messages.push({ role: 'assistant', content: assistantContent });
          messages.push({
            role: 'user',
            content: [{
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result)
            }]
          });

          // Reset for next iteration
          break;
        }
      }

      // If response ended without tool use, we're done (agent just responded with text)
      if (response.stop_reason === 'end_turn' && !taskComplete) {
        // Extract any text response
        const textBlock = response.content.find(b => b.type === 'text');
        if (textBlock && textBlock.type === 'text') {
          resultSummary = textBlock.text;
        }
        taskComplete = true;
        taskSuccess = true;
      }

    } catch (error) {
      console.error(`[${WORKER_ID}] Error calling Claude:`, error);
      taskComplete = true;
      taskSuccess = false;
      resultSummary = `Error: ${error}`;
    }
  }

  if (iterations >= maxIterations) {
    resultSummary = `Task exceeded maximum iterations (${maxIterations})`;
    taskSuccess = false;
  }

  // Complete the session for UI visibility
  completeSession(sessionId, resultSummary, taskSuccess);

  // Complete the task in the queue
  completeTask(task.taskId, resultSummary, taskSuccess);

  // Clear current task context
  currentTaskId = null;
}

// Main loop
async function main(): Promise<void> {
  console.log(`[${WORKER_ID}] Worker started, polling for tasks...`);

  while (true) {
    const task = claimTask();

    if (task) {
      await executeTask(task);
    } else {
      // No tasks, wait before polling again
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log(`\n[${WORKER_ID}] Shutting down...`);
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n[${WORKER_ID}] Shutting down...`);
  db.close();
  process.exit(0);
});

// Run
main().catch(error => {
  console.error(`[${WORKER_ID}] Fatal error:`, error);
  process.exit(1);
});
