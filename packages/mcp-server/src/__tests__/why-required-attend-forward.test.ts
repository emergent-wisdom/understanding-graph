import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

/**
 * Runtime validation requires why on nodes and edges, including nested batch
 * calls that do not pass through MCP schema validation. Why names a node's role
 * in the surrounding understanding. Attend is an optional forward-looking
 * companion and cannot replace that explanation.
 */
const PROJECT_ID = 'why-required';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-why-required-'));
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
  results?: Array<{ id: string }>;
}

async function batch(
  commit_message: string,
  operations: Array<{ tool: string; params: Record<string, unknown> }>,
) {
  return (await handleToolCall(
    'graph_batch',
    { agent_name: 'test-agent', commit_message, operations },
    contextManager,
    'research',
  )) as BatchResult;
}

const EARLIER = 'Divergence has to be cheaper';
const LATER = 'A cheaper button would not have helped';
const EDGE_WHY =
  'Following this reaches the reason the earlier recommendation was wrong: it priced the barrier as friction when the barrier was how the packet was being read.';

/**
 * Two concepts and the edge that grounds them — the smallest batch an empty
 * graph accepts. `extras` customises the second concept, the one under test;
 * `edge` customises the connection.
 */
function pair(
  extras: Record<string, unknown> = {},
  edge: Record<string, unknown> = { why: EDGE_WHY },
) {
  return [
    {
      tool: 'graph_add_understanding',
      params: {
        title: EARLIER,
        trigger: 'evaluation',
        why: 'Records a recommendation so a later instance can argue with it rather than inherit it',
        understanding:
          'An earlier recommendation: that the divergence tools needed to be cheaper to reach.',
      },
    },
    {
      tool: 'graph_add_understanding',
      params: {
        title: LATER,
        trigger: 'evaluation',
        why: 'Corrects my own earlier recommendation with a sharper mechanism',
        understanding:
          'The cost was never the barrier. Every packet was being read as a lookup, so a cheaper one would have been read the same way.',
        ...extras,
      },
    },
    {
      tool: 'graph_connect',
      params: { from: LATER, to: EARLIER, type: 'contradicts', ...edge },
    },
  ];
}

describe('why is required on nodes', () => {
  it('rejects a concept that omits why', async () => {
    const ops = pair();
    delete (ops[1].params as Record<string, unknown>).why;

    const result = await batch(
      'Record a correction without naming its role',
      ops,
    );

    expect(
      result.success,
      'A concept with no why was accepted. Required is what makes this field ' +
        'get written: in the window where it was optional, every node authored ' +
        'skipped it.',
    ).toBe(false);
    expect(String(result.message ?? result.error)).toMatch(/why/i);
  });

  it('accepts concepts whose why names what they do to the understanding', async () => {
    const result = await batch(
      'Record a correction against its own earlier claim',
      pair(),
    );

    expect(
      result.success,
      `A well-formed batch was rejected: ${result.message ?? result.error}`,
    ).toBe(true);

    const store = getGraphStore();
    const node = store.getNode(result.results?.[1].id as string);
    expect(node?.why).toContain('Corrects my own earlier recommendation');
  });
});

describe('why stays required on edges', () => {
  it('rejects an edge that does not say what following it buys', async () => {
    const result = await batch(
      'Connect a correction to its target without justifying the link',
      pair({}, {}),
    );

    expect(
      result.success,
      'An edge with no why was accepted. The schema calls why required, but ' +
        'schema requirements do not run inside graph_batch — only a runtime ' +
        'check does, and this pins the runtime check.',
    ).toBe(false);
    // Specifically the edge guard, not the node requirement failing first.
    expect(String(result.message ?? result.error)).toContain(
      'graph_connect requires "why"',
    );
  });

  it('accepts the same edge once why is supplied', async () => {
    const result = await batch(
      'Record that the later finding overturns the earlier one',
      pair(),
    );
    expect(result.success).toBe(true);

    const store = getGraphStore();
    const edges = store.getAll().edges.filter((e) => e.type === 'contradicts');
    expect(edges).toHaveLength(1);
    expect(edges[0].why).toContain('priced the barrier as friction');
  });
});

describe('attend points forward without replacing why', () => {
  it('persists attend and opens live attention', async () => {
    const result = await batch(
      'Record a correction that changes what to look at next',
      pair({
        attend:
          'Check whether a re-entry packet ever contained something that was not asked for. If it never did, the retrieval is a lookup and the phase name is decoration.',
      }),
    );
    expect(result.success).toBe(true);

    const store = getGraphStore();
    const node = store.getNode(result.results?.[1].id as string);

    expect(node?.metadata?.attend).toContain('not asked for');
    // Without these two the pointer is write-only: stored, never resurfaced.
    expect(node?.metadata?.liveAttention).toBe(true);
    expect(node?.metadata?.attentionStatus).toBe('open');
    // attend is a companion, not a substitute.
    expect(node?.why).toBeTruthy();
  });

  it('does not mark an ordinary concept as live attention', async () => {
    // Opt-in. If every concept claimed live attention, the signal that
    // something is genuinely unfinished would be worth nothing.
    const result = await batch(
      'Record a correction with no forward pointer',
      pair(),
    );
    expect(result.success).toBe(true);

    const store = getGraphStore();
    const node = store.getNode(result.results?.[1].id as string);
    expect(node?.metadata?.liveAttention).toBeUndefined();
  });
});

/**
 * Every batch requires an author so its nodes and edges retain attributable
 * provenance. Supplying the author must preserve an otherwise valid batch.
 */
describe('every commit carries its author', () => {
  it('rejects a batch with no agent_name', async () => {
    // Throws rather than returning success:false, matching how the sibling
    // commit_message requirement is enforced in the same function.
    await expect(
      handleToolCall(
        'graph_batch',
        {
          commit_message: 'Write something with nobody attached to it',
          operations: pair(),
        },
        contextManager,
        'research',
      ),
      'An anonymous batch was accepted. Every node and edge in it would ' +
        'inherit a commit that cannot say whose understanding it holds.',
    ).rejects.toThrow(/agent_name/i);
  });

  it('accepts the same batch once an author is named', async () => {
    const result = (await handleToolCall(
      'graph_batch',
      {
        agent_name: 'test-agent',
        commit_message: 'Write the same thing with an author attached',
        operations: pair(),
      },
      contextManager,
      'research',
    )) as BatchResult;

    expect(
      result.success,
      `An attributed batch was rejected: ${result.message ?? result.error}`,
    ).toBe(true);
  });
});
