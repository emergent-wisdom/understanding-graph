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
 * A refusal has to carry its remedy through the batch that wrapped it.
 *
 * Tools put the treatment in `hint` — which node id to look up, which field to
 * supply, which sibling tool to reach for instead. The batch composed its
 * failure message from `error` and `message` and read `hint` nowhere, so every
 * hint was discarded the moment a tool failed inside a batch.
 *
 * That became the whole story once the mutating document tools were made
 * batch-only. A batch is now their only caller, so their hints had exactly one
 * path to a reader and it dropped them — a change made for provenance quietly
 * cost every one of those tools its remediation text. The refusal is the one
 * moment an agent is definitely paying attention, and it was arriving with the
 * diagnosis and without the treatment.
 *
 * The concrete case is real and self-inflicted: graph_connect resolves a node
 * by title and doc_weave's targetNodeIds does not, its schema says so, and the
 * two run side by side in the same batch. Passing a title there returned
 * "Target node X not found", which sends the reader looking for a missing node
 * rather than at the argument they supplied.
 */
const PROJECT_ID = 'batch-hints';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-batch-hints-'));
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

async function batch(commit_message: string, operations: unknown[]) {
  return (await handleToolCall(
    'graph_batch',
    { agent_name: 'test-agent', commit_message, operations },
    contextManager,
    'writing',
  )) as BatchResult;
}

async function seed() {
  const result = await batch('Seed two grounded concepts and a document root', [
    {
      tool: 'graph_add_concept',
      params: {
        title: 'A grounding concept',
        trigger: 'foundation',
        why: 'Anchors what a woven passage would express',
        understanding: 'Something a passage can point at.',
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
    {
      tool: 'doc_create',
      params: {
        title: 'story.md',
        content: '# Root',
        level: 'document',
        isDocRoot: true,
      },
    },
  ]);
  expect(result.success, `seed failed: ${result.message ?? result.error}`).toBe(
    true,
  );
}

describe('a batch failure carries the remedy, not just the diagnosis', () => {
  it("surfaces a failing tool's hint in the batch message", async () => {
    await seed();

    const result = await batch('Weave against a target named by title', [
      {
        tool: 'doc_weave',
        params: {
          title: 'A woven passage',
          content: 'A passage that names its target by title.',
          level: 'section',
          parentId: 'story.md',
          why: 'Records what this weave expresses',
          targetNodeIds: ['A grounding concept'],
          connections: [
            {
              nodeId: 'A grounding concept',
              why: 'Following this reaches the concept the passage renders.',
            },
          ],
        },
      },
    ]);

    expect(result.success).toBe(false);
    const message = String(result.message ?? result.error);
    // The diagnosis was always there.
    expect(message).toContain('not found');
    // The treatment was not: the batch read `error` and `message` and dropped
    // `hint`, which is where every tool puts what to do instead.
    expect(
      message,
      'The batch reported the failure without the hint the tool attached. ' +
        'Since these tools are batch-only, that was their only path to a ' +
        'reader, so the remedy reached nobody.',
    ).toContain('node IDs');
  });

  it('leaves a hintless failure reading exactly as before', async () => {
    await seed();

    // Guard against the fix appending stray text to failures that carry no
    // hint — most refusals do not, and they must not gain a trailing artefact.
    const result = await batch('Connect two nodes without naming a type', [
      {
        tool: 'graph_connect',
        params: {
          from: 'A second concept',
          to: 'A grounding concept',
          why: 'Following this reaches the claim the second was drawn from.',
        },
      },
    ]);

    expect(result.success).toBe(false);
    const message = String(result.message ?? result.error);
    expect(message).toContain('EDGE_TYPE_REQUIRED');
    expect(message).not.toMatch(/undefined|null\s*$/);
  });
});
