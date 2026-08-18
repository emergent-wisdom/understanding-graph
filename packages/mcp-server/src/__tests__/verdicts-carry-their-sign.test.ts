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
 * An edge landing on a prediction is a verdict, and a verdict has a sign.
 *
 * Typed `answers`, it records that the question was settled but not how it
 * came out. Refutation and confirmation then look identical in the structure
 * and the outcome survives only in prose, where nothing can count it — so any
 * measure of whether returning to earlier thinking actually CHANGED anything
 * is uncomputable, which is the thing the graph exists to make countable.
 *
 * This is a refusal rather than a sentence for a measured reason. The
 * graph_connect description already says it, under a PREDICTIVE heading
 * naming both validates and invalidates. It was read and ignored six times
 * consecutively by an agent who had, in the same session, argued that typed
 * edges make influence inspectable rather than assumed. Advice that specific
 * did not move behaviour. A failing batch does.
 */
const PROJECT_ID = 'verdict-signs';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-verdict-signs-'));
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

const PREDICTION = 'The essay measures the store, not the medium';
const VERDICT = 'The prediction was refuted by the closest material there is';

/** A prediction and a verdict about it — the smallest batch an empty graph takes. */
function verdictPair(edge: Record<string, unknown>) {
  return [
    {
      tool: 'graph_add_concept',
      params: {
        title: PREDICTION,
        trigger: 'prediction',
        why: 'Stakes a falsifiable claim before the evidence is read',
        understanding:
          'Predicting that the passage judges the graph by composition rather than by whether any belief changed.',
      },
    },
    {
      tool: 'graph_add_concept',
      params: {
        title: VERDICT,
        trigger: 'surprise',
        why: 'Records the verdict on the prediction as stated',
        understanding:
          'The passage says the opposite in its first sentence, so the prediction is refuted on both clauses.',
      },
    },
    {
      tool: 'graph_connect',
      params: { from: VERDICT, to: PREDICTION, ...edge },
    },
  ];
}

describe('a verdict on a prediction must carry its sign', () => {
  it('rejects an unsigned verdict typed answers', async () => {
    const result = await batch(
      'Settle the prediction without saying how it came out',
      verdictPair({
        type: 'answers',
        why: 'Following this reaches the prediction this settles.',
      }),
    );

    expect(
      result.success,
      'An edge onto a prediction was accepted as "answers". That records ' +
        'that the question closed but not how, which makes refutation and ' +
        'confirmation identical in the structure.',
    ).toBe(false);
    expect(String(result.message ?? result.error)).toContain(
      'UNSIGNED_VERDICT',
    );
  });

  it('accepts invalidates when the prediction was overturned', async () => {
    const result = await batch(
      'Record that the prediction was refuted',
      verdictPair({
        type: 'invalidates',
        why: 'Following this reaches the claim overturned and the passage that overturned it.',
      }),
    );

    expect(
      result.success,
      `A correctly signed verdict was rejected: ${result.message ?? result.error}`,
    ).toBe(true);

    const store = getGraphStore();
    const edges = store.getAll().edges.filter((e) => e.type === 'invalidates');
    expect(edges).toHaveLength(1);
  });

  it('accepts validates when the prediction held', async () => {
    const result = await batch(
      'Record that the prediction held',
      verdictPair({
        type: 'validates',
        why: 'Following this reaches the claim upheld and the evidence that upheld it.',
      }),
    );
    expect(result.success).toBe(true);
  });

  it('leaves edges onto ordinary concepts alone', async () => {
    // The guard is narrow on purpose: only a prediction target makes an edge a
    // verdict. Widening it would make `answers` unusable for actual questions.
    const result = await batch('Answer an ordinary open question', [
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Can emergence be compelled without owning the loop',
          trigger: 'question',
          why: 'Opens the question the next node addresses',
          understanding:
            'A tool installed in someone else client cannot re-inject divergence each iteration.',
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Two levers remain available',
          trigger: 'analysis',
          why: 'Answers the open question with what the tool actually holds',
          understanding:
            'What a response says at the moment of decision, and what the server refuses outright.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: 'Two levers remain available',
          to: 'Can emergence be compelled without owning the loop',
          type: 'answers',
          why: 'Following this reaches the question and what is actually available to answer it.',
        },
      },
    ]);

    expect(
      result.success,
      `"answers" onto a question was rejected: ${result.message ?? result.error}`,
    ).toBe(true);
  });
});
