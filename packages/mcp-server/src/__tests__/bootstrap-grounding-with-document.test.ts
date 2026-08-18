import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetGraphStore, sqlite } from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

/**
 * Adding a document to a batch must not invalidate concepts the same batch
 * would otherwise have accepted.
 *
 * Orphan prevention has a bootstrap case: in an empty graph there is nothing
 * pre-existing to ground against, so new concepts connected to each other are
 * accepted. The document clause — "or a newly created canonical document
 * artifact" — was written to WIDEN what counts as grounding, and its guard
 * read `graphIsEmpty && documentAnchors.length === 0`. So the moment a
 * doc_create joined the batch, the bootstrap allowance was withdrawn and the
 * check fell through to a reachability walk seeded ONLY from the document.
 *
 * The result: two concepts and an edge were accepted in an empty graph, and
 * the identical two concepts and edge were REFUSED once an unrelated
 * doc_create was added. The batch got strictly larger and previously valid
 * work became invalid — and that combination is the first thing an author
 * does in writing mode, which is a root plus a couple of concepts about it.
 *
 * All three cases are pinned, because the fix has an obvious over-correction:
 * counting the document as an anchor could be done by dropping the connected
 * component requirement altogether, which would let a concept with no edges at
 * all through.
 */
const PROJECT_ID = 'bootstrap-grounding';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-bootstrap-'));
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

const CONNECTED_CONCEPTS = [
  {
    tool: 'graph_add_concept',
    params: {
      title: 'A grounding concept',
      trigger: 'foundation',
      why: 'Anchors the pair the edge connects',
      understanding: 'Something the other concept can point at.',
    },
  },
  {
    tool: 'graph_add_concept',
    params: {
      title: 'A second concept',
      trigger: 'analysis',
      why: 'Grounds the first so neither stands alone',
      understanding: 'Draws out what the first one implies.',
    },
  },
  {
    tool: 'graph_connect',
    params: {
      from: 'A second concept',
      to: 'A grounding concept',
      type: 'learned_from',
      why: 'Following this reaches the claim the second was drawn from.',
    },
  },
];

const DOCUMENT = {
  tool: 'doc_create',
  params: {
    title: 'story.md',
    content: '# Root',
    level: 'document',
    isDocRoot: true,
  },
};

async function batch(commit_message: string, operations: unknown[]) {
  return (await handleToolCall(
    'graph_batch',
    { agent_name: 'test-agent', commit_message, operations },
    contextManager,
    'writing',
  )) as BatchResult;
}

describe('a document in the batch widens grounding rather than replacing it', () => {
  it('accepts connected concepts in an empty graph', async () => {
    const result = await batch(
      'Two concepts and the edge between them',
      CONNECTED_CONCEPTS,
    );
    expect(
      result.success,
      `The bootstrap case itself broke: ${result.message ?? result.error}`,
    ).toBe(true);
  });

  it('still accepts them when a document root joins the same batch', async () => {
    const result = await batch(
      'The same two concepts plus a document root',
      [...CONNECTED_CONCEPTS, DOCUMENT],
    );
    expect(
      result.success,
      'The identical concepts were refused once a doc_create was added. A ' +
        'batch that grew cannot make previously valid work invalid, and this ' +
        'combination is the first thing an author does in writing mode.',
    ).toBe(true);
  });

  it('still refuses a concept connected to nothing at all', async () => {
    // The over-correction to guard against: treating the document as an anchor
    // by abandoning the component requirement would let this through.
    const result = await batch('A concept with no edges, beside a document', [
      {
        tool: 'graph_add_concept',
        params: {
          title: 'A lone concept',
          trigger: 'foundation',
          why: 'Stands alone deliberately',
          understanding: 'Connected to nothing at all.',
        },
      },
      DOCUMENT,
    ]);

    expect(
      result.success,
      'A concept with no relationships was accepted. Grounding still has to ' +
        'mean something after the document clause is honoured.',
    ).toBe(false);
    expect(String(result.message ?? result.error)).toContain('ungrounded');
  });
});
