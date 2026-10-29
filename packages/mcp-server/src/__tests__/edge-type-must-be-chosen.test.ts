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
 * Every connection requires an explicit relation type and a truthful why.
 * Omitting type must fail rather than silently selecting the generic relates
 * relation; an intentional relates edge remains valid.
 */
const PROJECT_ID = 'edge-type-chosen';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-edge-type-'));
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

const FROM = 'Second claim';
const TO = 'First claim';

/** Two grounded concepts and one edge — the smallest batch an empty graph takes. */
function pair(edge: Record<string, unknown>) {
  return [
    {
      tool: 'graph_add_understanding',
      params: {
        title: TO,
        trigger: 'foundation',
        why: 'Anchors the pair the edge connects',
        understanding: 'Something for the later claim to build on.',
      },
    },
    {
      tool: 'graph_add_understanding',
      params: {
        title: FROM,
        trigger: 'analysis',
        why: 'Completes the pair the edge connects',
        understanding:
          'Something that stands in a relation to the claim above.',
      },
    },
    { tool: 'graph_connect', params: { from: FROM, to: TO, ...edge } },
  ];
}

async function batch(commit_message: string, operations: unknown[]) {
  return (await handleToolCall(
    'graph_batch',
    { agent_name: 'test-agent', commit_message, operations },
    contextManager,
    'research',
  )) as BatchResult;
}

describe('an edge type must be chosen, not inherited', () => {
  it('refuses an edge with no type rather than making it generic', async () => {
    const result = await batch(
      'Connect two claims without saying how they relate',
      pair({ why: 'Following this reaches the claim it builds on.' }),
    );

    expect(
      result.success,
      'An untyped edge was accepted. It becomes "relates", which records that ' +
        'two nodes are connected without recording how — so following it later ' +
        'buys nothing a search would not.',
    ).toBe(false);
    expect(String(result.message ?? result.error)).toContain(
      'EDGE_TYPE_REQUIRED',
    );
  });

  it('names the alternatives in the refusal', async () => {
    // A refusal that does not say what to write instead just moves the cost.
    const result = await batch(
      'Connect two claims without saying how they relate',
      pair({ why: 'Following this reaches the claim it builds on.' }),
    );
    const message = String(result.message ?? result.error);
    expect(message).toContain('learned_from');
    expect(message).toContain('contradicts');
  });

  it('accepts a named relation', async () => {
    const result = await batch(
      'Record what the later claim learned from the earlier one',
      pair({
        type: 'learned_from',
        why: 'Following this reaches the claim the later one was drawn from.',
      }),
    );
    expect(
      result.success,
      `A correctly typed edge was rejected: ${result.message ?? result.error}`,
    ).toBe(true);
  });

  it('still accepts relates when it is asked for on purpose', async () => {
    // The option survives; only the accident is removed. Forbidding `relates`
    // outright would push its cases onto whichever specific type looked
    // closest, which is worse than an honest generic edge — it would put a
    // false relation in the graph rather than a vague one.
    const result = await batch(
      'Record a connection that genuinely has no better name',
      pair({
        type: 'relates',
        why: 'Following this reaches a connection with genuinely no better name.',
      }),
    );
    expect(
      result.success,
      `Deliberate "relates" was rejected: ${result.message ?? result.error}`,
    ).toBe(true);
  });
});
