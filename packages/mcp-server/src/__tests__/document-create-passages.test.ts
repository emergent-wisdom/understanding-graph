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
import { docBatch, docOp } from './support/doc-batch.js';

const PROJECT_ID = 'document-create-passages-test';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-create-passages-'));
  const projectDir = path.join(tmpDir, 'projects');

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function createStoryRoot() {
  return await docOp<{ id: string }>(contextManager, 'writing', 'doc_create', {
    title: 'story.md',
    content: '# The Borrowed Horizon',
    level: 'document',
    isDocRoot: true,
    fileType: 'md',
  });
}

async function createPassages(params: Record<string, unknown>): Promise<{
  success: boolean;
  results?: Array<{
    id: string;
    narrativeRole: string | null;
    childIds: string[];
    children: Array<{
      id: string;
      title: string;
      level: string;
      inspirations: Array<{
        nodeId: string;
        edgeId: string;
        type: string;
        why: string;
      }>;
    }>;
    finalOrder: Array<{ id: string; title: string; level: string }>;
    granularityContext: {
      criterion: string;
      boundarySource: string;
      childCount: number;
      reviews: unknown[];
    };
  }>;
  errors?: Array<{ index: number; tool: string; error: string }>;
  regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
}> {
  return handleToolCall(
    'graph_batch',
    {
      operations: [{ tool: 'doc_create_passages', params }],
      commit_message:
        'Create a scene whose passages remain independently revisable',
      agent_name: 'passage-test',
      ignoreWarnings: true,
    },
    contextManager,
    'writing',
  ) as Promise<{
    success: boolean;
    results?: Array<{
      id: string;
      narrativeRole: string | null;
      childIds: string[];
      children: Array<{
        id: string;
        title: string;
        level: string;
        inspirations: Array<{
          nodeId: string;
          edgeId: string;
          type: string;
          why: string;
        }>;
      }>;
      finalOrder: Array<{ id: string; title: string; level: string }>;
      granularityContext: {
        criterion: string;
        boundarySource: string;
        childCount: number;
        reviews: unknown[];
      };
    }>;
    errors?: Array<{ index: number; tool: string; error: string }>;
    regeneratedDocuments?: Array<{ rootId: string; outputPath: string }>;
  }>;
}

describe('batch-only doc_create_passages', () => {
  it('creates a semantic container and ordered prose leaves with optional exact inspiration provenance', async () => {
    const root = await createStoryRoot();
    const store = getGraphStore();
    const blueCup = store.createNode({
      title: 'The chipped blue cup survives every evacuation',
      trigger: 'surprise',
      why: 'An image the writer may transform or reject.',
      understanding:
        'The cup can make continuity physical without explaining the theme.',
    });
    const causalWhy =
      'The chipped rim became the tactile proof that Mara had lived this morning before.  ';

    const result = await createPassages({
      parentId: root.id,
      title: 'The Door That Remembers',
      narrativeRole:
        'Turn abstract memory ownership into a choice Mara can physically refuse.',
      containerLevel: 'section',
      passages: [
        {
          title: 'Recognition through the damaged cup',
          content:
            'Mara found the blue cup waiting beside the sealed door. Its chipped rim fitted the old scar on her thumb.',
          level: 'paragraph',
          inspirations: [{ nodeId: blueCup.id, why: causalWhy }],
        },
        {
          title: 'The door asks for consent',
          content:
            'The lock spoke in her own forgotten voice: “You may enter, but the memory stays yours.”',
          level: 'paragraph',
        },
        {
          title: 'Refusal becomes motion',
          content: 'She set the cup down and walked past the door.',
          level: 'paragraph',
          inspirations: [],
        },
      ],
    });

    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
    const created = result.results?.[0];
    expect(created?.narrativeRole).toBe(
      'Turn abstract memory ownership into a choice Mara can physically refuse.',
    );
    expect(created?.childIds).toHaveLength(3);
    expect(created?.finalOrder.map((passage) => passage.title)).toEqual([
      'Recognition through the damaged cup',
      'The door asks for consent',
      'Refusal becomes motion',
    ]);
    expect(created?.finalOrder.map((passage) => passage.level)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    expect(created?.granularityContext).toMatchObject({
      boundarySource: 'writer-supplied semantic boundaries',
      childCount: 3,
      reviewCount: 0,
    });
    expect(created?.granularityContext.criterion).toContain(
      'move, replace, compare, annotate, or revise',
    );

    const container = store.getNode(created?.id || '');
    expect(container).toMatchObject({
      title: 'The Door That Remembers',
      content: null,
      summary: null,
      level: 'section',
      metadata: {
        documentUnit: 'prose-container',
        narrativeRole:
          'Turn abstract memory ownership into a choice Mara can physically refuse.',
      },
    });
    expect(store.getChildren(created?.id || '').map((node) => node.id)).toEqual(
      created?.childIds,
    );

    const firstPassage = created?.children[0];
    expect(firstPassage?.inspirations).toEqual([
      {
        nodeId: blueCup.id,
        nodeTitle: blueCup.title,
        edgeId: expect.stringMatching(/^e_/),
        type: 'inspired_by',
        why: causalWhy,
      },
    ]);
    expect(
      store
        .getEdgesBetween(firstPassage?.id || '', blueCup.id)
        .find((edge) => edge.type === 'inspired_by'),
    ).toMatchObject({
      fromId: firstPassage?.id,
      toId: blueCup.id,
      why: causalWhy,
    });
    expect(created?.children[1]?.inspirations).toEqual([]);
    expect(created?.children[2]?.inspirations).toEqual([]);

    const generatedPath = result.regeneratedDocuments?.find(
      (document) => document.rootId === root.id,
    )?.outputPath;
    const manuscript = fs.readFileSync(generatedPath || '', 'utf8');
    expect(manuscript).toContain('## The Door That Remembers');
    expect(manuscript).toContain('Mara found the blue cup');
    expect(manuscript).toContain('The lock spoke in her own forgotten voice');
    expect(manuscript).toContain('She set the cup down');
    expect(manuscript).not.toContain('Recognition through the damaged cup');
    expect(manuscript).not.toContain('The door asks for consent');
    expect(manuscript).not.toContain('Refusal becomes motion');
    expect(manuscript).not.toContain('Turn abstract memory ownership');
  });

  it('validates every inspiration endpoint before creating any passage structure', async () => {
    const root = await createStoryRoot();
    const before = getGraphStore().getAll();
    const commitsBefore = sqlite.getRecentCommits().map((c) => c.id);

    const result = await createPassages({
      parentId: root.id,
      title: 'A Scene That Must Not Land',
      passages: [
        {
          title: 'Locally valid passage',
          content: 'The first sentence could have been written.',
          level: 'paragraph',
        },
        {
          title: 'Broken provenance',
          content: 'The second sentence cites a missing source.',
          level: 'paragraph',
          inspirations: [
            {
              nodeId: 'n_missing',
              why: 'This should fail before the container is created.',
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.error).toContain(
      'PASSAGE_INSPIRATION_NOT_FOUND',
    );
    const after = getGraphStore().getAll();
    expect(after.nodes.map((node) => node.id)).toEqual(
      before.nodes.map((node) => node.id),
    );
    expect(after.edges.map((edge) => edge.id)).toEqual(
      before.edges.map((edge) => edge.id),
    );
    expect(sqlite.getRecentCommits().map((c) => c.id)).toEqual(commitsBefore);
  });

  it('renders consecutive sentence leaves as prose without their semantic graph titles', async () => {
    const root = await createStoryRoot();

    const result = await createPassages({
      parentId: root.id,
      title: 'A Voice in Three Motions',
      containerLevel: 'section',
      passages: [
        {
          title: 'The archive inhales',
          content: 'The archive inhaled.',
          level: 'sentence',
        },
        {
          title: 'Mara recognizes the rhythm',
          content: 'Mara knew the rhythm.',
          level: 'sentence',
        },
        {
          title: 'Recognition turns to dread',
          content: 'It was her own.',
          level: 'sentence',
        },
      ],
    });

    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.results?.[0]?.finalOrder.map((child) => child.level)).toEqual(
      ['sentence', 'sentence', 'sentence'],
    );
    const generatedPath = result.regeneratedDocuments?.find(
      (document) => document.rootId === root.id,
    )?.outputPath;
    const manuscript = fs.readFileSync(generatedPath || '', 'utf8');
    expect(manuscript).toContain(
      'The archive inhaled. Mara knew the rhythm. It was her own.',
    );
    expect(manuscript).not.toContain('The archive inhales');
    expect(manuscript).not.toContain('Mara recognizes the rhythm');
    expect(manuscript).not.toContain('Recognition turns to dread');
  });

  it('accepts a semantic scene alias and appends to the current tail by default', async () => {
    const root = await createStoryRoot();
    const first = await createPassages({
      parentId: root.id,
      title: 'First Scene',
      containerLevel: 'scene',
      passages: [
        {
          title: 'First scene passage',
          content: 'Mara entered the chamber.',
          level: 'paragraph',
        },
      ],
    });
    expect(first.success, JSON.stringify(first, null, 2)).toBe(true);

    const second = await createPassages({
      parentId: root.id,
      title: 'Second Scene',
      containerLevel: 'scene',
      passages: [
        {
          title: 'Second scene passage',
          content: 'The chamber answered.',
          level: 'paragraph',
        },
      ],
    });
    expect(second.success, JSON.stringify(second, null, 2)).toBe(true);

    const containers = getGraphStore().getChildren(root.id);
    expect(containers.map((node) => node.title)).toEqual([
      'First Scene',
      'Second Scene',
    ]);
    expect(containers.map((node) => node.level)).toEqual([
      'section',
      'section',
    ]);
  });

  it('rolls the entire passage structure back when a later batch operation fails', async () => {
    const root = await createStoryRoot();
    const before = getGraphStore().getAll();
    const commitsBefore = sqlite.getRecentCommits().map((c) => c.id);

    const result = (await handleToolCall(
      'graph_batch',
      {
        operations: [
          {
            tool: 'doc_create_passages',
            params: {
              parentId: root.id,
              title: 'Provisional Scene',
              passages: [
                {
                  title: 'Provisional beat',
                  content: 'This prose must disappear with its failed batch.',
                  level: 'paragraph',
                },
              ],
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: 'n_missing',
              type: 'refines',
              why: 'Force a later operation failure to test atomic rollback.',
            },
          },
        ],
        commit_message: 'This commit must roll back completely',
        agent_name: 'passage-test',
        ignoreWarnings: true,
      },
      contextManager,
      'writing',
    )) as {
      success: boolean;
      errors: Array<{ index: number; tool: string; error: string }>;
    };

    expect(result.success).toBe(false);
    expect(result.errors[0], JSON.stringify(result, null, 2)).toMatchObject({
      index: 1,
      tool: 'graph_connect',
    });
    const after = getGraphStore().getAll();
    expect(after.nodes.map((node) => node.id)).toEqual(
      before.nodes.map((node) => node.id),
    );
    expect(after.edges.map((edge) => edge.id)).toEqual(
      before.edges.map((edge) => edge.id),
    );
    expect(sqlite.getRecentCommits().map((c) => c.id)).toEqual(commitsBefore);
  });
});
