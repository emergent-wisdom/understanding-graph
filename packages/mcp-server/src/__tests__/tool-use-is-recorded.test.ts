import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

/**
 * External calls must leave one local tool-use record, including read-only
 * retrievals. Nested batch operations count as one outer call. Recording must
 * seed a valid conversation row for its session foreign key and must not break
 * the tool call when bookkeeping fails.
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

const A = 'Synthetic fixture: inspect a stored sensor reading';
const B = 'Synthetic fixture: compare the sensor with its reference';

/** Two grounded concepts — the smallest batch an empty graph accepts. */
const SEED = [
  {
    tool: 'graph_add_understanding',
    params: {
      title: A,
      trigger: 'analysis',
      why: 'Defines the first member of the recorded fixture pair',
      understanding:
        'A sensor reading is retained so a later comparison can inspect it.',
    },
  },
  {
    tool: 'graph_add_understanding',
    params: {
      title: B,
      trigger: 'consequence',
      why: 'Connects a comparison to the fixture reading it examines',
      understanding:
        'Comparing the stored reading with a reference can reveal calibration drift.',
    },
  },
  {
    tool: 'graph_connect',
    params: {
      from: B,
      to: A,
      type: 'learned_from',
      why: 'The comparison depends on the sensor reading stored by the first fixture node.',
    },
  },
];

async function seed() {
  const result = (await handleToolCall(
    'graph_batch',
    {
      agent_name: 'test-agent',
      commit_message:
        'Seed two grounded concepts so the recorder has work to log',
      operations: SEED,
    },
    contextManager,
    'research',
  )) as BatchResult;
  expect(
    result.success,
    `setup batch failed: ${result.message ?? result.error}`,
  ).toBe(true);
}

describe('the graph records that it was read, not only that it was written', () => {
  it('records a retrieval, which previously left no trace at all', async () => {
    await seed();
    await handleToolCall(
      'graph_understand',
      {
        query: 'What does the graph record about its own use?',
        retrieval: 'lexical',
      },
      contextManager,
      'research',
    );

    expect(
      recorded().map((r) => r.tool_name),
      'The retrieval must leave a tool-use row independently of the seed batch.',
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
    ).not.toContain('graph_add_understanding');
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
            tool: 'graph_add_understanding',
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
    await handleToolCall('graph_analyze', {}, contextManager, 'research');

    // The whole point: this arithmetic was impossible before, and answering it
    // required files that live outside the tool.
    const rows = recorded();
    const writes = rows.filter((r) => r.tool_name === 'graph_batch').length;
    const reads = rows.length - writes;

    expect(writes).toBe(1);
    expect(reads).toBe(2);
  });
});
