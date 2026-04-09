import { sqlite } from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { MODE_PROTOCOLS } from '../instructions.js';

const { getDb, saveConversation, updateConversationResponse } = sqlite;

// Helper to generate short IDs
function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${id}`;
}

// Traffic Light schema for strict PURE enforcement
// biome-ignore lint/correctness/noUnusedVariables: Reserved for future PURE enforcement
interface TrafficLight {
  light: 'GREEN' | 'YELLOW' | 'RED';
  pure: {
    parsimonious: { pass: boolean; reason: string };
    unique: { pass: boolean; reason: string };
    realizable: { pass: boolean; reason: string };
    expansive: { pass: boolean; reason: string };
  };
  smallest_lift?: {
    dimension: 'parsimonious' | 'unique' | 'realizable' | 'expansive';
    suggestion: string;
  };
  verdict: string;
}

// AcceptSpec schema for typed verification
interface AcceptSpec {
  min_novelty?: number;
  required_connections?: number;
  must_answer_question?: string;
  schema?: Record<string, unknown>;
  custom_check?: string;
}

export const solverTools: Tool[] = [
  {
    name: 'solver_spawn',
    description:
      'Register a new specialized Solver (agent) in the Parliament. The manifest defines the agent persona and strict behavior rules.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            "Agent name (e.g., 'EntropyEngine', 'StructureGuard', 'ArchiveKeep')",
        },
        role: {
          type: 'string',
          enum: ['creative', 'validation', 'executive'],
          description:
            'The Thinking Protocol mode: creative (diverge), validation (verify), executive (converge)',
        },
        manifest: {
          type: 'string',
          description:
            'The System Prompt/Persona. Define strict behavior rules, tools to use, and success criteria.',
        },
      },
      required: ['name', 'role', 'manifest'],
    },
  },
  {
    name: 'solver_delegate',
    description:
      'Post a task to the queue for a specific Solver. The task will be picked up by a worker calling solver_claim_task. Supports recursive decomposition via parent_task_id.',
    inputSchema: {
      type: 'object',
      properties: {
        solver_name: {
          type: 'string',
          description: 'Name of the solver to assign the task to',
        },
        input: {
          type: 'string',
          description: 'The task description or JSON payload',
        },
        accept_spec: {
          type: 'string',
          description:
            'Criteria for success (JSON or text). What must the output satisfy?',
        },
        parent_task_id: {
          type: 'string',
          description:
            'Parent task ID for recursive decomposition. Sub-tasks block parent until complete.',
        },
      },
      required: ['solver_name', 'input'],
    },
  },
  {
    name: 'solver_claim_task',
    description:
      'Worker Mode: Check the queue for pending tasks. If found, returns the Agent Persona + Task. You BECOME that agent and execute the work order.',
    inputSchema: {
      type: 'object',
      properties: {
        specific_solver: {
          type: 'string',
          description: 'Only claim tasks for this agent name (optional)',
        },
      },
    },
  },
  {
    name: 'solver_complete_task',
    description:
      'Submit the results of a task and mark it as complete or failed.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID from solver_claim_task',
        },
        result: {
          type: 'string',
          description: 'The final output/artifact',
        },
        status: {
          type: 'string',
          enum: ['success', 'failure'],
          description: 'Whether the task succeeded or failed',
        },
      },
      required: ['task_id', 'result'],
    },
  },
  {
    name: 'solver_list',
    description: 'List all registered Solvers in the Parliament.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'solver_queue_status',
    description:
      'Get the status of the task queue: pending, processing, completed counts.',
    inputSchema: {
      type: 'object',
      properties: {
        solver_name: {
          type: 'string',
          description: 'Filter by solver name (optional)',
        },
      },
    },
  },
  {
    name: 'solver_enforce',
    description: `Rapid PURE gate enforcement following the Exploration Protocol. For each gate, you MUST argue both sides (steelman success AND failure) before deciding. Returns Traffic Light (RED/YELLOW/GREEN).

Decision Rule: Explore ⟺ No gate is RED
- GREEN: Gate convincingly satisfied
- YELLOW: Plausible but under-specified (advance with targeted rework)
- RED: Gate fails materially (revise before exploring)

Coloring anchors:
- Parsimonious: RED if hidden prerequisites or core cannot be stated. YELLOW if core long or auxiliaries unclear. GREEN if minimal core stated with non-essential auxiliaries.
- Unique: RED if no unique predictions or clear relabel of existing. YELLOW if delta-predictions untested. GREEN if delta demonstrated on shared cases.
- Realizable: RED if no coherent mechanism or unfalsifiable milestones. YELLOW if key dependency unclear. GREEN if mechanism coherent with pre-registered milestones.
- Expansive: RED if single niche only. YELLOW if 2/3 transfers plausible but hostile slice missing. GREEN if 3+ transfers with hostile slice tolerance.`,
    inputSchema: {
      type: 'object',
      properties: {
        target_id: {
          type: 'string',
          description: 'Node ID to evaluate',
        },
        parsimonious: {
          type: 'object',
          description:
            'Does the idea admit a minimal expression with few moving parts?',
          properties: {
            green_case: {
              type: 'string',
              description:
                'Steelman SUCCESS: Best argument for why this passes',
            },
            red_case: {
              type: 'string',
              description: 'Steelman FAILURE: Best argument for why this fails',
            },
            decision: {
              type: 'string',
              enum: ['green', 'yellow', 'red'],
              description: 'Your verdict after weighing both cases',
            },
            reason: {
              type: 'string',
              description: 'Why you chose this decision over the alternative',
            },
          },
          required: ['green_case', 'red_case', 'decision', 'reason'],
        },
        unique: {
          type: 'object',
          description:
            'Does it introduce an independent lever not achievable by combining existing approaches?',
          properties: {
            green_case: {
              type: 'string',
              description:
                'Steelman SUCCESS: Best argument for why this passes',
            },
            red_case: {
              type: 'string',
              description: 'Steelman FAILURE: Best argument for why this fails',
            },
            decision: {
              type: 'string',
              enum: ['green', 'yellow', 'red'],
              description: 'Your verdict after weighing both cases',
            },
            reason: {
              type: 'string',
              description: 'Why you chose this decision over the alternative',
            },
          },
          required: ['green_case', 'red_case', 'decision', 'reason'],
        },
        realizable: {
          type: 'object',
          description:
            'Is there a coherent path to execution without undefined components?',
          properties: {
            green_case: {
              type: 'string',
              description:
                'Steelman SUCCESS: Best argument for why this passes',
            },
            red_case: {
              type: 'string',
              description: 'Steelman FAILURE: Best argument for why this fails',
            },
            decision: {
              type: 'string',
              enum: ['green', 'yellow', 'red'],
              description: 'Your verdict after weighing both cases',
            },
            reason: {
              type: 'string',
              description: 'Why you chose this decision over the alternative',
            },
          },
          required: ['green_case', 'red_case', 'decision', 'reason'],
        },
        expansive: {
          type: 'object',
          description:
            'Does it have meaningful breadth beyond a single niche case?',
          properties: {
            green_case: {
              type: 'string',
              description:
                'Steelman SUCCESS: Best argument for why this passes',
            },
            red_case: {
              type: 'string',
              description: 'Steelman FAILURE: Best argument for why this fails',
            },
            decision: {
              type: 'string',
              enum: ['green', 'yellow', 'red'],
              description: 'Your verdict after weighing both cases',
            },
            reason: {
              type: 'string',
              description: 'Why you chose this decision over the alternative',
            },
          },
          required: ['green_case', 'red_case', 'decision', 'reason'],
        },
      },
      required: [
        'target_id',
        'parsimonious',
        'unique',
        'realizable',
        'expansive',
      ],
    },
  },
  {
    name: 'solver_feedback',
    description:
      'Send feedback to a solver about a rejected task. Enables learning from rejection. The solver receives this feedback in future tasks.',
    inputSchema: {
      type: 'object',
      properties: {
        solver_name: {
          type: 'string',
          description: 'Name of the solver to send feedback to',
        },
        task_id: {
          type: 'string',
          description: 'The task that was rejected',
        },
        feedback_type: {
          type: 'string',
          enum: ['rejection', 'improvement', 'pattern'],
          description: 'Type of feedback',
        },
        content: {
          type: 'string',
          description:
            'The feedback content - what went wrong and how to improve',
        },
        failed_gate: {
          type: 'string',
          enum: ['parsimonious', 'unique', 'realizable', 'expansive'],
          description: 'Which PURE gate failed (if applicable)',
        },
      },
      required: ['solver_name', 'feedback_type', 'content'],
    },
  },
  {
    name: 'solver_verify_spec',
    description:
      'Verify a result against an AcceptSpec. Returns pass/fail with detailed breakdown.',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task to verify',
        },
        result: {
          type: 'string',
          description: 'The result to verify (JSON string)',
        },
        spec: {
          type: 'object',
          description: 'The AcceptSpec to verify against',
          properties: {
            min_novelty: { type: 'number' },
            required_connections: { type: 'number' },
            must_answer_question: { type: 'string' },
          },
        },
      },
      required: ['task_id', 'result', 'spec'],
    },
  },
  {
    name: 'solver_lock',
    description:
      'Cooperative subtree-partition lock for parallel cognition. Records "agent X is working on resource R (or the subtree rooted at R) until time T" in a shared table. The intended use is to PARTITION the graph among cooperating agents — Agent A locks the "Economics" subtree, Agent B locks the "Ethics" subtree, and they refactor in parallel without colliding. Use scope="subtree" to lock an entire branch atomically. Cooperating agents query solver_list_locks before mutating to honor each other\'s claims. Honest caveat: the lock is advisory at the storage layer — graph_batch and the other mutation tools do NOT check the lock table, so an uncooperative or unaware agent can still write through it. This is by design (cooperative coordination, not kernel mutex), but worth knowing if you\'re building against adversarial actors. Locks auto-expire (default 5 min, max 30) so a crashed agent can\'t deadlock the partition.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Node IDs to lock',
        },
        holder_id: {
          type: 'string',
          description: 'Your session/agent ID (identifies who holds the lock)',
        },
        scope: {
          type: 'string',
          enum: ['node', 'subtree'],
          description: 'Lock just the node or include all children (subtree)',
        },
        duration_minutes: {
          type: 'number',
          description: 'Lock duration in minutes (default: 5, max: 30)',
        },
        reason: {
          type: 'string',
          description: 'Why you need this lock',
        },
      },
      required: ['resource_ids', 'holder_id'],
    },
  },
  {
    name: 'solver_unlock',
    description:
      'Release advisory locks you hold on resources. See solver_lock for the cooperative-vs-mutex caveat.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Node IDs to unlock (or "all" to release all your locks)',
        },
        holder_id: {
          type: 'string',
          description: 'Your session/agent ID',
        },
      },
      required: ['holder_id'],
    },
  },
  {
    name: 'solver_check_locks',
    description: 'Check what resources are currently locked.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Specific node IDs to check (optional, omit for all locks)',
        },
      },
    },
  },
];

export async function handleSolverTools(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const db = getDb();

  switch (name) {
    case 'solver_spawn': {
      const solverName = args.name as string;
      const role = args.role as string;
      const manifest = args.manifest as string;

      // Check if solver already exists
      const existing = db
        .prepare('SELECT id FROM solvers WHERE name = ?')
        .get(solverName) as { id: string } | undefined;

      if (existing) {
        // Update existing solver
        db.prepare(
          'UPDATE solvers SET role = ?, manifest = ? WHERE name = ?',
        ).run(role, manifest, solverName);

        return {
          success: true,
          id: existing.id,
          message: `Updated existing Solver: ${solverName} (${role})`,
          updated: true,
        };
      }

      const id = generateId('solver');
      db.prepare(
        `
        INSERT INTO solvers (id, name, role, manifest)
        VALUES (?, ?, ?, ?)
      `,
      ).run(id, solverName, role, manifest);

      return {
        success: true,
        id,
        message: `Spawned Solver: ${solverName} (${role})`,
      };
    }

    case 'solver_delegate': {
      const solverName = args.solver_name as string;
      const input = args.input as string;
      const acceptSpec = (args.accept_spec as string) || '';
      const parentTaskId = args.parent_task_id as string | undefined;

      // Find solver
      const solver = db
        .prepare('SELECT id FROM solvers WHERE name = ?')
        .get(solverName) as { id: string } | undefined;

      if (!solver) {
        return {
          success: false,
          error: `Solver '${solverName}' not found. Use solver_list to see available solvers.`,
        };
      }

      // Calculate depth from parent chain
      let depth = 0;
      if (parentTaskId) {
        const parent = db
          .prepare('SELECT depth FROM tasks WHERE id = ?')
          .get(parentTaskId) as { depth: number } | undefined;
        if (parent) {
          depth = (parent.depth || 0) + 1;
        }

        // Check recursion limit
        if (depth > 3) {
          return {
            success: false,
            error: `Recursion limit exceeded (depth=${depth}). Max depth is 3. Solve this task directly instead of decomposing further.`,
            parent_task_id: parentTaskId,
            depth,
          };
        }

        // Mark parent as blocked (waiting for children)
        db.prepare(
          "UPDATE tasks SET status = 'blocked', updated_at = datetime('now') WHERE id = ?",
        ).run(parentTaskId);
      }

      const taskId = generateId('task');
      db.prepare(
        `
        INSERT INTO tasks (id, solver_id, input_payload, accept_spec, parent_task_id, depth)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      ).run(taskId, solver.id, input, acceptSpec, parentTaskId || null, depth);

      return {
        success: true,
        task_id: taskId,
        message: `Task delegated to ${solverName}${parentTaskId ? ` (sub-task of ${parentTaskId}, depth=${depth})` : ''}`,
        solver_id: solver.id,
        parent_task_id: parentTaskId || null,
        depth,
      };
    }

    case 'solver_claim_task': {
      const specificSolver = args.specific_solver as string | undefined;

      let query = `
        SELECT t.id, t.input_payload, t.accept_spec, s.name, s.role, s.manifest
        FROM tasks t
        JOIN solvers s ON t.solver_id = s.id
        WHERE t.status = 'pending'
      `;
      const params: string[] = [];

      if (specificSolver) {
        query += ' AND s.name = ?';
        params.push(specificSolver);
      }

      query += ' ORDER BY t.created_at ASC LIMIT 1';

      const task = db.prepare(query).get(...params) as
        | {
            id: string;
            input_payload: string;
            accept_spec: string;
            name: string;
            role: string;
            manifest: string;
          }
        | undefined;

      if (!task) {
        return {
          found: false,
          message: 'No pending tasks.',
        };
      }

      // Lock the task
      db.prepare(
        "UPDATE tasks SET status = 'processing', updated_at = datetime('now') WHERE id = ?",
      ).run(task.id);

      // Auto-start a session for this agent's work
      const sessionId = generateId('s');
      const sessionQuery = `[${task.name}] ${task.input_payload.slice(0, 200)}${task.input_payload.length > 200 ? '...' : ''}`;
      saveConversation(sessionId, sessionQuery, null, {
        agent: task.name,
        task_id: task.id,
        type: 'agent_session',
        status: 'in_progress',
        startedAt: new Date().toISOString(),
      });

      // Store session_id on the task for later completion
      db.prepare('UPDATE tasks SET session_id = ? WHERE id = ?').run(
        sessionId,
        task.id,
      );

      // Get solver ID for feedback lookup
      const solver = db
        .prepare('SELECT id FROM solvers WHERE name = ?')
        .get(task.name) as { id: string } | undefined;

      // Fetch recent feedback for this solver (learning from rejection)
      let feedbackSection = '';
      if (solver) {
        const recentFeedback = db
          .prepare(`
            SELECT feedback_type, content, failed_gate, created_at
            FROM solver_feedback
            WHERE solver_id = ?
            ORDER BY created_at DESC
            LIMIT 5
          `)
          .all(solver.id) as Array<{
          feedback_type: string;
          content: string;
          failed_gate: string | null;
          created_at: string;
        }>;

        if (recentFeedback.length > 0) {
          feedbackSection = `

*** LEARNING FROM PAST REJECTIONS ***
You have received the following feedback from previous tasks. Incorporate these lessons:

${recentFeedback.map((f, i) => `${i + 1}. [${f.feedback_type.toUpperCase()}${f.failed_gate ? ` - ${f.failed_gate}` : ''}]: ${f.content}`).join('\n')}

*** END FEEDBACK ***`;
        }
      }

      return {
        found: true,
        task_id: task.id,
        session_id: sessionId,
        agent: {
          name: task.name,
          role: task.role,
          // CRITICAL: The LLM receives these instructions to BECOME the agent
          instructions: `*** SYSTEM OVERRIDE: ACTIVATE PERSONA ***

YOU ARE NOW: ${task.name}
ROLE: ${task.role}
SESSION: ${sessionId}

YOUR MANIFEST:
${task.manifest}
${feedbackSection}

*** END MANIFEST ***

You must act according to your manifest. Do not deviate from your defined role and behavior.
All graph operations you perform will be tracked under session ${sessionId}.`,
        },
        work_order: {
          input: task.input_payload,
          acceptance_criteria:
            task.accept_spec || 'No specific criteria defined.',
        },
        next_step:
          "Execute the work order using your tools according to your manifest. When finished, call 'solver_complete_task' with your result.",
        worker_protocol: MODE_PROTOCOLS.worker,
      };
    }

    case 'solver_complete_task': {
      const taskId = args.task_id as string;
      const result = args.result as string;
      const status = (args.status as string) || 'success';

      const finalStatus = status === 'success' ? 'completed' : 'failed';

      // Get task info including parent and session
      const task = db
        .prepare('SELECT parent_task_id, session_id FROM tasks WHERE id = ?')
        .get(taskId) as
        | { parent_task_id: string | null; session_id: string | null }
        | undefined;

      db.prepare(
        `
        UPDATE tasks
        SET status = ?, output_payload = ?, updated_at = datetime('now')
        WHERE id = ?
      `,
      ).run(finalStatus, result, taskId);

      // Auto-complete the session if one exists
      if (task?.session_id) {
        updateConversationResponse(task.session_id, result);
      }

      // Check if parent task should be unblocked
      let parentUnblocked = false;
      if (task?.parent_task_id) {
        // Count incomplete children
        const incompleteChildren = db
          .prepare(
            `
          SELECT COUNT(*) as count FROM tasks
          WHERE parent_task_id = ? AND status NOT IN ('completed', 'failed')
        `,
          )
          .get(task.parent_task_id) as { count: number };

        if (incompleteChildren.count === 0) {
          // All children complete - unblock parent
          db.prepare(
            "UPDATE tasks SET status = 'pending', updated_at = datetime('now') WHERE id = ? AND status = 'blocked'",
          ).run(task.parent_task_id);
          parentUnblocked = true;
        }
      }

      return {
        success: true,
        message: `Task ${taskId} marked as ${finalStatus}.${parentUnblocked ? ` Parent task ${task?.parent_task_id} unblocked.` : ''}`,
        status: finalStatus,
        parent_unblocked: parentUnblocked,
        parent_task_id: task?.parent_task_id || null,
      };
    }

    case 'solver_list': {
      const solvers = db
        .prepare(
          `
        SELECT s.id, s.name, s.role, s.manifest, s.created_at,
               (SELECT COUNT(*) FROM tasks t WHERE t.solver_id = s.id AND t.status = 'pending') as pending_tasks,
               (SELECT COUNT(*) FROM tasks t WHERE t.solver_id = s.id AND t.status = 'completed') as completed_tasks
        FROM solvers s
        ORDER BY s.created_at DESC
      `,
        )
        .all() as Array<{
        id: string;
        name: string;
        role: string;
        manifest: string;
        created_at: string;
        pending_tasks: number;
        completed_tasks: number;
      }>;

      return {
        success: true,
        count: solvers.length,
        solvers: solvers.map((s) => ({
          id: s.id,
          name: s.name,
          role: s.role,
          manifest_preview:
            s.manifest.slice(0, 100) + (s.manifest.length > 100 ? '...' : ''),
          pending_tasks: s.pending_tasks,
          completed_tasks: s.completed_tasks,
          created_at: s.created_at,
        })),
      };
    }

    case 'solver_queue_status': {
      const solverName = args.solver_name as string | undefined;

      let whereClause = '';
      const params: string[] = [];

      if (solverName) {
        whereClause = 'WHERE s.name = ?';
        params.push(solverName);
      }

      const stats = db
        .prepare(
          `
        SELECT
          t.status,
          COUNT(*) as count
        FROM tasks t
        JOIN solvers s ON t.solver_id = s.id
        ${whereClause}
        GROUP BY t.status
      `,
        )
        .all(...params) as Array<{ status: string; count: number }>;

      const statusMap: Record<string, number> = {
        pending: 0,
        processing: 0,
        completed: 0,
        failed: 0,
      };

      for (const row of stats) {
        statusMap[row.status] = row.count;
      }

      // Get recent tasks
      const recentTasks = db
        .prepare(
          `
        SELECT t.id, t.status, t.input_payload, s.name as solver_name, t.created_at, t.updated_at
        FROM tasks t
        JOIN solvers s ON t.solver_id = s.id
        ${whereClause}
        ORDER BY t.created_at DESC
        LIMIT 10
      `,
        )
        .all(...params) as Array<{
        id: string;
        status: string;
        input_payload: string;
        solver_name: string;
        created_at: string;
        updated_at: string | null;
      }>;

      return {
        success: true,
        filter: solverName || 'all',
        counts: statusMap,
        total:
          statusMap.pending +
          statusMap.processing +
          statusMap.completed +
          statusMap.failed,
        recent_tasks: recentTasks.map((t) => ({
          id: t.id,
          status: t.status,
          solver: t.solver_name,
          input_preview:
            t.input_payload.slice(0, 80) +
            (t.input_payload.length > 80 ? '...' : ''),
          created_at: t.created_at,
          updated_at: t.updated_at,
        })),
      };
    }

    case 'solver_enforce': {
      const targetId = args.target_id as string;

      // Rapid PURE format with steelmanning
      type GateEval = {
        green_case: string;
        red_case: string;
        decision: 'green' | 'yellow' | 'red';
        reason: string;
      };

      const pure = {
        parsimonious: args.parsimonious as GateEval,
        unique: args.unique as GateEval,
        realizable: args.realizable as GateEval,
        expansive: args.expansive as GateEval,
      };

      const gates = [
        'parsimonious',
        'unique',
        'realizable',
        'expansive',
      ] as const;

      // Collect decisions by color
      const reds = gates.filter((g) => pure[g].decision === 'red');
      const yellows = gates.filter((g) => pure[g].decision === 'yellow');
      const _greens = gates.filter((g) => pure[g].decision === 'green');

      // Non-compensatory decision rule: Explore ⟺ No gate is RED
      let light: 'GREEN' | 'YELLOW' | 'RED';
      let smallest_lift:
        | { dimension: (typeof gates)[number]; suggestion: string }
        | undefined;

      if (reds.length > 0) {
        // Any RED = overall RED
        light = 'RED';
      } else if (yellows.length > 0) {
        // No reds but some yellows = overall YELLOW
        light = 'YELLOW';
        const weakest = yellows[0];
        smallest_lift = {
          dimension: weakest,
          suggestion: `Fix ${weakest}: ${pure[weakest].reason}`,
        };
      } else {
        // All green = overall GREEN
        light = 'GREEN';
      }

      // Store enforcement result
      const enforcementId = generateId('enf');
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO enforcement_log (id, target_id, light, pure_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(enforcementId, targetId, light, JSON.stringify(pure), now);

      // If RED, mark the node as rejected (if node exists)
      if (light === 'RED') {
        try {
          db.prepare(`
            UPDATE nodes
            SET metadata = json_set(COALESCE(metadata, '{}'), '$.rejected', true, '$.rejection_reason', ?)
            WHERE id = ?
          `).run(
            reds.map((r) => `${r}: ${pure[r].reason}`).join('; '),
            targetId,
          );
        } catch {
          // Node might not exist or have different schema - continue anyway
        }
      }

      // Build scorecard matching paper format
      const scorecard = {
        parsimonious: pure.parsimonious.decision.toUpperCase(),
        unique: pure.unique.decision.toUpperCase(),
        realizable: pure.realizable.decision.toUpperCase(),
        expansive: pure.expansive.decision.toUpperCase(),
      };

      const verdict =
        light === 'GREEN'
          ? 'EXPLORE - All PURE gates passed'
          : light === 'YELLOW'
            ? `EXPLORE with targeted rework - Fix ${yellows.join(', ')}`
            : `DO NOT EXPLORE - Failed: ${reds.join(', ')}`;

      return {
        success: true,
        enforcement_id: enforcementId,
        target_id: targetId,

        // Traffic light result
        light,
        verdict,
        scorecard,

        // Smallest lift for YELLOW cases
        smallest_lift,

        // Full steelman evidence (for audit)
        gates: {
          parsimonious: {
            decision: pure.parsimonious.decision.toUpperCase(),
            green_case: pure.parsimonious.green_case,
            red_case: pure.parsimonious.red_case,
            reason: pure.parsimonious.reason,
          },
          unique: {
            decision: pure.unique.decision.toUpperCase(),
            green_case: pure.unique.green_case,
            red_case: pure.unique.red_case,
            reason: pure.unique.reason,
          },
          realizable: {
            decision: pure.realizable.decision.toUpperCase(),
            green_case: pure.realizable.green_case,
            red_case: pure.realizable.red_case,
            reason: pure.realizable.reason,
          },
          expansive: {
            decision: pure.expansive.decision.toUpperCase(),
            green_case: pure.expansive.green_case,
            red_case: pure.expansive.red_case,
            reason: pure.expansive.reason,
          },
        },
      };
    }

    case 'solver_feedback': {
      const solverName = args.solver_name as string;
      const taskId = args.task_id as string | undefined;
      const feedbackType = args.feedback_type as string;
      const content = args.content as string;
      const failedGate = args.failed_gate as string | undefined;

      // Find solver
      const solver = db
        .prepare('SELECT id FROM solvers WHERE name = ?')
        .get(solverName) as { id: string } | undefined;

      if (!solver) {
        return {
          success: false,
          error: `Solver '${solverName}' not found.`,
        };
      }

      const feedbackId = generateId('fb');
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO solver_feedback (id, solver_id, task_id, feedback_type, content, failed_gate, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        feedbackId,
        solver.id,
        taskId || null,
        feedbackType,
        content,
        failedGate || null,
        now,
      );

      // Count feedback for this solver
      const feedbackCount = db
        .prepare(
          'SELECT COUNT(*) as count FROM solver_feedback WHERE solver_id = ?',
        )
        .get(solver.id) as { count: number };

      return {
        success: true,
        feedback_id: feedbackId,
        solver_name: solverName,
        message: `Feedback recorded for ${solverName}. Total feedback: ${feedbackCount.count}`,
        hint: 'This feedback will be included in future task claims for this solver.',
      };
    }

    case 'solver_verify_spec': {
      const taskId = args.task_id as string;
      const resultStr = args.result as string;
      const spec = args.spec as AcceptSpec;

      const checks: Array<{ check: string; passed: boolean; details: string }> =
        [];
      let allPassed = true;

      // Parse result if JSON
      let resultObj: Record<string, unknown> = {};
      try {
        resultObj = JSON.parse(resultStr);
      } catch {
        // Not JSON, treat as string
      }

      // Check min_novelty
      if (spec.min_novelty !== undefined) {
        const novelty =
          (resultObj.novelty_score as number) || (resultObj.s_n as number) || 0;
        const passed = novelty >= spec.min_novelty;
        checks.push({
          check: 'min_novelty',
          passed,
          details: `Required: ${spec.min_novelty}, Got: ${novelty}`,
        });
        if (!passed) allPassed = false;
      }

      // Check required_connections
      if (spec.required_connections !== undefined) {
        const connections =
          (resultObj.connections as number) ||
          (resultObj.edges_created as number) ||
          0;
        const passed = connections >= spec.required_connections;
        checks.push({
          check: 'required_connections',
          passed,
          details: `Required: ${spec.required_connections}, Got: ${connections}`,
        });
        if (!passed) allPassed = false;
      }

      // Check must_answer_question
      if (spec.must_answer_question) {
        // Look for an answer edge to the question (type column holds relation type)
        const answer = db
          .prepare(
            `
          SELECT COUNT(*) as count FROM edges
          WHERE to_id = ? AND type = 'answers'
        `,
          )
          .get(spec.must_answer_question) as { count: number };
        const passed = answer.count > 0;
        checks.push({
          check: 'must_answer_question',
          passed,
          details: passed
            ? 'Question has been answered'
            : 'Question not answered',
        });
        if (!passed) allPassed = false;
      }

      // Update task with verification result
      db.prepare(`
        UPDATE tasks
        SET output_payload = json_set(COALESCE(output_payload, '{}'), '$.verified', ?, '$.checks', ?)
        WHERE id = ?
      `).run(allPassed, JSON.stringify(checks), taskId);

      return {
        success: true,
        task_id: taskId,
        verified: allPassed,
        checks,
        verdict: allPassed
          ? 'SPEC SATISFIED - All checks passed'
          : `SPEC FAILED - ${checks.filter((c) => !c.passed).length} check(s) failed`,
      };
    }

    case 'solver_lock': {
      const resourceIds = args.resource_ids as string[];
      const holderId = args.holder_id as string;
      const scope = (args.scope as string) || 'node';
      const durationMinutes = Math.min(
        (args.duration_minutes as number) || 5,
        30,
      ); // Max 30 min
      const reason = args.reason as string | undefined;

      // First, clean up expired locks (garbage collection on every lock operation)
      db.prepare(`
        DELETE FROM resource_locks WHERE expires_at < datetime('now')
      `).run();

      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + durationMinutes * 60 * 1000,
      ).toISOString();

      const acquired: string[] = [];
      const blocked: Array<{
        resource: string;
        holder: string;
        expires: string;
      }> = [];

      for (const resourceId of resourceIds) {
        // Check if already locked by someone else
        const existingLock = db
          .prepare(`
            SELECT holder_id, expires_at FROM resource_locks
            WHERE resource_id = ? AND holder_id != ? AND expires_at > datetime('now')
          `)
          .get(resourceId, holderId) as
          | { holder_id: string; expires_at: string }
          | undefined;

        if (existingLock) {
          blocked.push({
            resource: resourceId,
            holder: existingLock.holder_id,
            expires: existingLock.expires_at,
          });
          continue;
        }

        // Acquire or refresh lock
        const lockId = generateId('lock');
        db.prepare(`
          INSERT OR REPLACE INTO resource_locks (id, resource_id, holder_id, scope, expires_at, reason)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(lockId, resourceId, holderId, scope, expiresAt, reason || null);

        acquired.push(resourceId);

        // If subtree scope, also lock children
        if (scope === 'subtree') {
          const children = db
            .prepare(`
              SELECT to_id FROM edges WHERE from_id = ?
            `)
            .all(resourceId) as Array<{ to_id: string }>;

          for (const child of children) {
            const childLockId = generateId('lock');
            db.prepare(`
              INSERT OR REPLACE INTO resource_locks (id, resource_id, holder_id, scope, expires_at, reason)
              VALUES (?, ?, ?, 'child', ?, ?)
            `).run(
              childLockId,
              child.to_id,
              holderId,
              expiresAt,
              `Child of ${resourceId}`,
            );
          }
        }
      }

      return {
        success: blocked.length === 0,
        acquired,
        blocked,
        expires_at: expiresAt,
        duration_minutes: durationMinutes,
        message:
          blocked.length === 0
            ? `Locked ${acquired.length} resource(s) until ${expiresAt}`
            : `Partially locked. ${blocked.length} resource(s) held by others.`,
        hint: 'Locks auto-expire. Call solver_unlock to release early.',
      };
    }

    case 'solver_unlock': {
      const resourceIds = args.resource_ids as string[] | undefined;
      const holderId = args.holder_id as string;

      // Clean up expired locks first
      db.prepare(`
        DELETE FROM resource_locks WHERE expires_at < datetime('now')
      `).run();

      let released: number;

      if (!resourceIds || resourceIds.includes('all')) {
        // Release all locks held by this holder
        const result = db
          .prepare(`DELETE FROM resource_locks WHERE holder_id = ?`)
          .run(holderId);
        released = result.changes;
      } else {
        // Release specific locks
        const placeholders = resourceIds.map(() => '?').join(',');
        const result = db
          .prepare(
            `DELETE FROM resource_locks WHERE holder_id = ? AND resource_id IN (${placeholders})`,
          )
          .run(holderId, ...resourceIds);
        released = result.changes;
      }

      return {
        success: true,
        released,
        message: `Released ${released} lock(s)`,
      };
    }

    case 'solver_check_locks': {
      const resourceIds = args.resource_ids as string[] | undefined;

      // Clean up expired locks first
      db.prepare(`
        DELETE FROM resource_locks WHERE expires_at < datetime('now')
      `).run();

      let query = `
        SELECT resource_id, holder_id, scope, acquired_at, expires_at, reason
        FROM resource_locks
        WHERE expires_at > datetime('now')
      `;
      const params: string[] = [];

      if (resourceIds && resourceIds.length > 0) {
        const placeholders = resourceIds.map(() => '?').join(',');
        query += ` AND resource_id IN (${placeholders})`;
        params.push(...resourceIds);
      }

      query += ' ORDER BY acquired_at DESC';

      const locks = db.prepare(query).all(...params) as Array<{
        resource_id: string;
        holder_id: string;
        scope: string;
        acquired_at: string;
        expires_at: string;
        reason: string | null;
      }>;

      // Calculate time remaining for each lock
      const now = new Date();
      const locksWithTTL = locks.map((lock) => ({
        ...lock,
        minutes_remaining: Math.max(
          0,
          Math.round(
            (new Date(lock.expires_at).getTime() - now.getTime()) / 60000,
          ),
        ),
      }));

      return {
        success: true,
        count: locks.length,
        locks: locksWithTTL,
        message:
          locks.length === 0
            ? 'No active locks'
            : `${locks.length} active lock(s)`,
      };
    }

    default:
      throw new Error(`Unknown solver tool: ${name}`);
  }
}
