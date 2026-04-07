#!/usr/bin/env npx tsx
/**
 * Project Daemon
 *
 * A background process that keeps a project alive with continuous agent activity.
 * Checks the thermostat periodically and delegates tasks based on temperature.
 *
 * Usage:
 *   PROJECT_ID=my-project ANTHROPIC_API_KEY=sk-... npx tsx scripts/project-daemon.ts
 *
 * The daemon will:
 *   - Check thermostat every HEARTBEAT_INTERVAL
 *   - If too cold (SOLID) → spawn creative tasks (WorldBuilder, EntropyEngine)
 *   - If too hot (GAS) → spawn validation tasks (StructureGuard, CriticAgent)
 *   - If balanced (LIQUID) → maintain with light exploration
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const HEARTBEAT_INTERVAL_MS = 60000; // Check every 1 minute
const PROJECT_ID = process.env.PROJECT_ID || 'default';
const DB_PATH = process.env.DB_PATH ||
  path.join(__dirname, '..', 'projects', PROJECT_ID, 'store.db');

const DAEMON_ID = `daemon_${PROJECT_ID}_${Math.random().toString(36).slice(2, 6)}`;

console.log(`[${DAEMON_ID}] Starting project daemon for: ${PROJECT_ID}`);
console.log(`[${DAEMON_ID}] Database: ${DB_PATH}`);
console.log(`[${DAEMON_ID}] Heartbeat: ${HEARTBEAT_INTERVAL_MS}ms`);

// Initialize database
let db: Database.Database;
try {
  db = new Database(DB_PATH);
  console.log(`[${DAEMON_ID}] Connected to database`);
} catch (error) {
  console.error(`[${DAEMON_ID}] Failed to connect:`, error);
  process.exit(1);
}

// Helper to generate IDs
function generateId(prefix: string): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${id}`;
}

// Calculate temperature (simplified version of graph_thermostat)
function getTemperature(): { temperature: number; state: 'GAS' | 'LIQUID' | 'SOLID'; metrics: Record<string, number> } {
  const nodes = db.prepare(`SELECT COUNT(*) as count FROM nodes`).get() as { count: number };
  const edges = db.prepare(`SELECT COUNT(*) as count FROM edges`).get() as { count: number };

  const questions = db.prepare(`
    SELECT COUNT(*) as count FROM nodes
    WHERE json_extract(data, '$.trigger') = 'question'
    AND json_extract(data, '$.status') = 'open'
  `).get() as { count: number };

  const tensions = db.prepare(`
    SELECT COUNT(*) as count FROM nodes
    WHERE json_extract(data, '$.trigger') = 'tension'
  `).get() as { count: number };

  const serendipities = db.prepare(`
    SELECT COUNT(*) as count FROM nodes
    WHERE json_extract(data, '$.trigger') = 'serendipity'
    AND json_extract(data, '$.validated') IS NULL
  `).get() as { count: number };

  // Calculate entropy
  const totalNodes = nodes.count || 1;
  const tensionRatio = tensions.count / totalNodes;
  const questionRatio = questions.count / totalNodes;
  const entropy = 0.4 * tensionRatio + 0.3 * questionRatio + 0.3 * (serendipities.count / totalNodes);

  // Temperature = 1 - entropy (more disorder = higher temp)
  const temperature = Math.max(0, Math.min(1, 1 - entropy * 5));

  const state = temperature > 0.7 ? 'GAS' : temperature < 0.3 ? 'SOLID' : 'LIQUID';

  return {
    temperature,
    state,
    metrics: {
      nodes: nodes.count,
      edges: edges.count,
      openQuestions: questions.count,
      tensions: tensions.count,
      unvalidatedSerendipities: serendipities.count
    }
  };
}

// Find solver by name
function findSolver(name: string): { id: string; name: string } | null {
  const solver = db.prepare(`SELECT id, name FROM solvers WHERE name = ?`).get(name) as { id: string; name: string } | undefined;
  return solver || null;
}

// Get pending task count
function getPendingTaskCount(): number {
  const result = db.prepare(`SELECT COUNT(*) as count FROM tasks WHERE status = 'pending'`).get() as { count: number };
  return result.count;
}

// Delegate a task
function delegateTask(solverName: string, input: string, acceptSpec?: string): boolean {
  const solver = findSolver(solverName);
  if (!solver) {
    console.log(`[${DAEMON_ID}] Solver not found: ${solverName}`);
    return false;
  }

  const taskId = generateId('task');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO tasks (id, solver_id, input_payload, accept_spec, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(taskId, solver.id, input, acceptSpec || null, now);

  console.log(`[${DAEMON_ID}] Delegated to ${solverName}: ${taskId}`);
  return true;
}

// Get random concepts for creative prompts
function getRandomConcepts(count: number): string[] {
  const nodes = db.prepare(`
    SELECT json_extract(data, '$.title') as name
    FROM nodes
    WHERE type = 'concept'
    ORDER BY RANDOM()
    LIMIT ?
  `).all(count) as Array<{ name: string }>;

  return nodes.map(n => n.name).filter(Boolean);
}

// Creative prompts for different agents
function generateCreativePrompt(): { solver: string; input: string; acceptSpec: string } {
  const concepts = getRandomConcepts(3);

  const prompts = [
    {
      solver: 'WorldBuilder',
      input: `CREATIVE EXPLORATION: The concepts [${concepts.join(', ')}] exist in the graph.
Imagine they are fundamental laws of a strange universe. What emerges from their interaction?
Create at least one new concept that bridges these ideas in an unexpected way.`,
      acceptSpec: 'Must add at least one new concept with trigger "serendipity" and connect it to existing concepts'
    },
    {
      solver: 'EntropyEngine',
      input: `CHAOS INJECTION: The graph has become too predictable.
Look at these concepts: [${concepts.join(', ')}].
Find the strangest possible connection between them. Be deliberately silly or counterintuitive.
Add a serendipity node that captures your wild synthesis.`,
      acceptSpec: 'Must add a serendipity node. Bonus points for surprising connections.'
    },
    {
      solver: 'WorldBuilder',
      input: `QUESTION GENERATION: Based on existing concepts [${concepts.join(', ')}],
what questions SHOULD we be asking but aren't?
Create open question nodes for genuinely puzzling aspects of how these ideas interact.`,
      acceptSpec: 'Must create at least one question node using graph_question'
    }
  ];

  return prompts[Math.floor(Math.random() * prompts.length)];
}

// Validation prompts
function generateValidationPrompt(): { solver: string; input: string; acceptSpec: string } {
  const prompts = [
    {
      solver: 'StructureGuard',
      input: `QUALITY AUDIT: Review the most recent additions to the graph.
Check for:
- Shallow concepts (name but no real understanding)
- Weak connections (no "why" explanation)
- Orphan nodes (not connected to anything)
Report issues and suggest fixes.`,
      acceptSpec: 'Must identify at least one issue or confirm graph quality is acceptable'
    },
    {
      solver: 'CriticAgent',
      input: `ADVERSARIAL REVIEW: Find the weakest claims in the graph.
Look for:
- Unsupported assertions
- Circular reasoning
- Contradictions
Create tension nodes or question nodes for each problem found.`,
      acceptSpec: 'Must create at least one tension or question node, or confirm no issues found'
    },
    {
      solver: 'ArchiveKeep',
      input: `CONSOLIDATION: Look for clusters of related serendipity nodes.
Are there patterns that should be crystallized into decisions?
Use graph_connect to strengthen validated paths.
Look for opportunities to answer open questions.`,
      acceptSpec: 'Must create at least one new connection or answer one question'
    }
  ];

  return prompts[Math.floor(Math.random() * prompts.length)];
}

// Main heartbeat
async function heartbeat(): Promise<void> {
  const temp = getTemperature();
  const pendingTasks = getPendingTaskCount();

  console.log(`[${DAEMON_ID}] Heartbeat: T=${temp.temperature.toFixed(2)} (${temp.state}), pending=${pendingTasks}`);
  console.log(`[${DAEMON_ID}] Metrics:`, temp.metrics);

  // Don't add tasks if queue is already full
  if (pendingTasks >= 5) {
    console.log(`[${DAEMON_ID}] Queue has ${pendingTasks} pending tasks, waiting...`);
    return;
  }

  // Decide what to do based on temperature
  if (temp.state === 'SOLID') {
    // Too cold - inject creativity
    console.log(`[${DAEMON_ID}] Graph is SOLID (cold) - injecting creativity`);
    const prompt = generateCreativePrompt();
    delegateTask(prompt.solver, prompt.input, prompt.acceptSpec);
  } else if (temp.state === 'GAS') {
    // Too hot - validate and consolidate
    console.log(`[${DAEMON_ID}] Graph is GAS (hot) - validating and consolidating`);
    const prompt = generateValidationPrompt();
    delegateTask(prompt.solver, prompt.input, prompt.acceptSpec);
  } else {
    // Balanced - light exploration with 30% chance
    if (Math.random() < 0.3) {
      console.log(`[${DAEMON_ID}] Graph is LIQUID (balanced) - light exploration`);
      const prompt = Math.random() < 0.5 ? generateCreativePrompt() : generateValidationPrompt();
      delegateTask(prompt.solver, prompt.input, prompt.acceptSpec);
    } else {
      console.log(`[${DAEMON_ID}] Graph is LIQUID (balanced) - maintaining`);
    }
  }
}

// Ensure required solvers exist
function ensureSolvers(): void {
  const requiredSolvers = [
    { name: 'WorldBuilder', role: 'creative', manifest: 'You are the Simulator. Create novel ideas by treating concepts as physics laws. Be imaginative and strange.' },
    { name: 'EntropyEngine', role: 'creative', manifest: 'You are the Saboteur. Inject chaos and find unexpected connections. Be deliberately counterintuitive.' },
    { name: 'StructureGuard', role: 'validation', manifest: 'You are the Judge. Check graph quality. Find shallow concepts and weak connections.' },
    { name: 'CriticAgent', role: 'validation', manifest: 'You are the Adversary. Find weaknesses and contradictions. Be ruthlessly critical.' },
    { name: 'ArchiveKeep', role: 'executive', manifest: 'You are the Librarian. Consolidate patterns and strengthen validated paths.' }
  ];

  for (const solver of requiredSolvers) {
    const existing = findSolver(solver.name);
    if (!existing) {
      const id = generateId('solver');
      db.prepare(`
        INSERT INTO solvers (id, name, role, manifest, created_at)
        VALUES (?, ?, ?, ?, datetime('now'))
      `).run(id, solver.name, solver.role, solver.manifest);
      console.log(`[${DAEMON_ID}] Created solver: ${solver.name}`);
    }
  }
}

// Main loop
async function main(): Promise<void> {
  // Ensure we have the required solvers
  ensureSolvers();

  console.log(`[${DAEMON_ID}] Daemon started, running heartbeat every ${HEARTBEAT_INTERVAL_MS / 1000}s`);

  // Initial heartbeat
  await heartbeat();

  // Periodic heartbeats
  setInterval(async () => {
    try {
      await heartbeat();
    } catch (error) {
      console.error(`[${DAEMON_ID}] Heartbeat error:`, error);
    }
  }, HEARTBEAT_INTERVAL_MS);
}

// Handle shutdown
process.on('SIGINT', () => {
  console.log(`\n[${DAEMON_ID}] Shutting down...`);
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n[${DAEMON_ID}] Shutting down...`);
  db.close();
  process.exit(0);
});

// Run
main().catch(error => {
  console.error(`[${DAEMON_ID}] Fatal error:`, error);
  process.exit(1);
});
