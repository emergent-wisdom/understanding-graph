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
 * A question node has to record what you already suspect and what answering
 * it would settle, not merely that you wondered.
 *
 * graph_question had two faults that pointed the same way. Its schema listed
 * only `question` as required, and the handler defaulted `speculation` to an
 * empty string — which node validation then rejected. So an agent following
 * the documented contract got ILLEGAL_CONCEPT_NODE with no indication that
 * speculation was the missing piece. And `why` was never accepted from the
 * caller at all: every question node ever created carried the constant
 * 'Open question to explore'. That is a field required everywhere else
 * precisely because it names what a node DOES to the understanding around it,
 * carrying exactly zero information here because it could not vary.
 *
 * Tightening it cost nothing — the suite passed unchanged at 228, so nothing
 * had been relying on the loose contract, the same result as removing the
 * `relates` default. Two defaults in a row that no caller wanted.
 */
const PROJECT_ID = 'question-stake';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-question-'));
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

const QUESTION = 'Is the cheap route the one that wins';

function batchOps(questionParams: Record<string, unknown>) {
  return [
    {
      tool: 'graph_add_concept',
      params: {
        title: 'A grounded claim',
        trigger: 'foundation',
        why: 'Anchors the question so the batch is not an island',
        understanding: 'Something for the question to hang from.',
      },
    },
    { tool: 'graph_question', params: questionParams },
    {
      tool: 'graph_connect',
      params: {
        from: 'A grounded claim',
        to: QUESTION,
        type: 'questions',
        why: 'Following this reaches the open question the claim raises.',
      },
    },
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

const COMPLETE = {
  question: QUESTION,
  speculation:
    'Probably, wherever the good path is merely unadvertised rather than dear.',
  why: 'Settles whether the fourth lever is worth testing or already answered',
};

describe('a question records its stake, not just its wondering', () => {
  it('refuses a question with no speculation and says which field is missing', async () => {
    const result = await batch(
      'Ask something without saying what is suspected',
      batchOps({ question: QUESTION, why: COMPLETE.why }),
    );

    expect(result.success).toBe(false);
    const message = String(result.message ?? result.error);
    expect(message).toContain('QUESTION_INCOMPLETE');
    // The previous failure was ILLEGAL_CONCEPT_NODE, which named an internal
    // validation rule rather than the field the caller left out.
    expect(
      message,
      'The refusal must name the missing field. An agent that followed the ' +
        'documented schema needs to be told what the schema got wrong.',
    ).toContain('speculation');
  });

  it('refuses a question whose why is missing', async () => {
    const result = await batch(
      'Ask something without saying what answering it would settle',
      batchOps({ question: QUESTION, speculation: COMPLETE.speculation }),
    );

    expect(result.success).toBe(false);
    // A missing `why` was already refused before this change, by the shared
    // concept validation — but with the old opaque message. Asserting only
    // that the text mentions "why" therefore passed with and without the fix,
    // which is an assertion that cannot fail and is worth nothing. What is
    // actually new is that graph_question refuses it in its own terms, naming
    // the field it wanted rather than an internal rule.
    const message = String(result.message ?? result.error);
    expect(message).toContain('QUESTION_INCOMPLETE');
    expect(message).toContain('why');
  });

  it('accepts a complete question and keeps the caller\'s why', async () => {
    const result = await batch(
      'Ask a question with a stake and a reason',
      batchOps(COMPLETE),
    );
    expect(
      result.success,
      `A complete question was rejected: ${result.message ?? result.error}`,
    ).toBe(true);

    const store = getGraphStore();
    const question = store
      .getAll()
      .nodes.find((n) => n.trigger === 'question' && n.title === QUESTION);

    expect(question?.why).toBe(COMPLETE.why);
    // The old constant must not survive anywhere: a why identical on every
    // question node is a field that cannot carry information.
    expect(question?.why).not.toBe('Open question to explore');
    expect(question?.understanding).toContain('unadvertised');
  });
});
