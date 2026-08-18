import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetGraphStore, sqlite } from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

/**
 * The graph recorded what was written and nothing about what was read.
 *
 * Measured on a real project: 122 batches against 6 re-entries and 2 rolled
 * suggestions — a ratio that had to be reconstructed from scratchpad files
 * outside the tool, because tool_calls held zero rows across the entire
 * project. An ordinary agent keeps no such files, so it could not answer "what
 * have I been doing" from its own graph, and the single axis that question
 * turns on — whether the graph is being re-entered or only written to — was
 * the one the graph could not see.
 *
 * The recording machinery already existed in core, complete with indexes on
 * session and tool name, and was called only from test files. This pins it to
 * the dispatch path.
 *
 * It also pins the failure that hid this once already. tool_calls.session_id is
 * a foreign key onto conversations, so a synthesised session id makes every
 * insert fail. Because the recorder must never break the call it is recording,
 * that failure is swallowed — and the first wiring attempt therefore compiled
 * clean, ran clean, and wrote nothing at all. A green build is not evidence
 * here; a row is.
 */
const PROJECT_ID = 'tool-use-recorded';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-tool-use-'));
  const projectsDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectsDir, PROJECT_ID), { recursive: true });
  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDir);
  sqlite.initAllDatabases(projectsDir);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectsDir, PROJECT_ID));
  }
  sqlite.setCurrentProject(PROJECT_ID);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after failed assertions.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface BatchResult {
  success: boolean;
  message?: string;
  error?: string;
}

/** Every row currently in tool_calls, oldest first. */
function recorded(): Array<{ tool_name: string; error: string | null }> {
  return sqlite
    .getDb()
    .prepare('SELECT tool_name, error FROM tool_calls ORDER BY id')
    .all() as Array<{ tool_name: string; error: string | null }>;
}

const A = 'The graph recorded writes and not reads';
const B = 'An agent cannot ask its own graph what it has been doing';

/** Two grounded concepts — the smallest batch an empty graph accepts. */
const SEED = [
  {
    tool: 'graph_add_concept',
    params: {
      title: A,
      trigger: 'analysis',
      why: 'Names the asymmetry the recorder closes',
      understanding:
        'tool_calls held zero rows, so the read/write ratio had to be reconstructed from files outside the tool.',
    },
  },
  {
    tool: 'graph_add_concept',
    params: {
      title: B,
      trigger: 'consequence',
      why: 'States what the missing read log costs an agent with no scratchpad',
      understanding:
        'Reconstruction depended on session files an ordinary agent does not keep.',
    },
  },
  {
    tool: 'graph_connect',
    params: {
      from: B,
      to: A,
      type: 'learned_from',
      why: 'Following this reaches the recording gap that makes the question unanswerable from inside the tool.',
    },
  },
];

async function seed() {
  const result = (await handleToolCall(
    'graph_batch',
    {
      agent_name: 'test-agent',
      commit_message: 'Seed two grounded concepts so the recorder has work to log',
      operations: SEED,
    },
    contextManager,
    'research',
  )) as BatchResult;
  expect(result.success, `setup batch failed: ${result.message ?? result.error}`).toBe(
    true,
  );
}

describe('the graph records that it was read, not only that it was written', () => {
  it('records a retrieval, which previously left no trace at all', async () => {
    await seed();
    await handleToolCall(
      'graph_understand',
      { query: 'What does the graph record about its own use?', retrieval: 'lexical' },
      contextManager,
      'research',
    );

    expect(
      recorded().map((r) => r.tool_name),
      'A re-entry left no row. Reads were the invisible half: the graph could ' +
        'show 122 batches and no evidence that any of them was ever revisited.',
    ).toContain('graph_understand');
  });

  it('counts a batch once, not once per operation inside it', async () => {
    await seed();

    // The seed batch carries three operations. Nested operations dispatch with
    // internal = true, so a batch must read as one write rather than as its
    // parts — otherwise the write side is inflated by however granular the
    // batching happened to be, and the read/write ratio measures style.
    const batches = recorded().filter((r) => r.tool_name === 'graph_batch');
    expect(batches).toHaveLength(1);

    expect(
      recorded().map((r) => r.tool_name),
      'A nested operation was recorded as a top-level call.',
    ).not.toContain('graph_add_concept');
  });

  it('records a rejected call rather than losing it', async () => {
    await seed();

    // A batch that fails validation is the most informative thing an agent
    // does — it is the tool refusing — and a log that keeps only successes
    // reports a process that never hit friction.
    await handleToolCall(
      'graph_batch',
      {
        agent_name: 'test-agent',
        commit_message: 'Attempt an operation the tool should refuse',
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'A concept with no understanding',
              trigger: 'analysis',
              why: 'Exercises the refusal path',
            },
          },
        ],
      },
      contextManager,
      'research',
    ).catch(() => undefined);

    expect(
      recorded().filter((r) => r.tool_name === 'graph_batch').length,
      'The refused batch was not recorded.',
    ).toBe(2);
  });

  it('makes the read/write ratio answerable from inside the graph', async () => {
    await seed();
    await handleToolCall(
      'graph_understand',
      { query: 'what is unresolved here?', retrieval: 'lexical' },
      contextManager,
      'research',
    );
    await handleToolCall(
      'graph_analyze',
      {},
      contextManager,
      'research',
    );

    // The whole point: this arithmetic was impossible before, and answering it
    // required files that live outside the tool.
    const rows = recorded();
    const writes = rows.filter((r) => r.tool_name === 'graph_batch').length;
    const reads = rows.length - writes;

    expect(writes).toBe(1);
    expect(reads).toBe(2);
  });
});
