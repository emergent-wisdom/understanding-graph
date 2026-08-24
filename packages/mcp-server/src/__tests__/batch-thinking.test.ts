import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-batch-thinking-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, 'thinking-test'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes('thinking-test')) {
    sqlite.initDatabase(path.join(projectDir, 'thinking-test'));
  }
  sqlite.setCurrentProject('thinking-test');
  await contextManager.switchProject('thinking-test');
  vi.spyOn(getGraphStore(), 'generateAndStoreEmbedding').mockResolvedValue();
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  vi.restoreAllMocks();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('graph_batch thinking authorization', () => {
  it('allows connected synthetic thinking only in synthetic_reader', async () => {
    await expect(
      handleToolCall(
        'graph_batch',
        {
          commit_message: 'An ordinary mode attempts reserved synthesis',
          agent_name: 'synthesizer',
          ignoreWarnings: true,
          operations: [
            {
              tool: 'graph_add_concept',
              params: {
                title: 'Mode-bypassed thinking node',
                trigger: 'thinking',
                understanding: 'This node must not be persisted.',
                why: 'Exercises the mode boundary.',
                skipDuplicateCheck: true,
              },
            },
          ],
        },
        contextManager,
        'full',
      ),
    ).rejects.toThrow('TOOL_MODE "synthetic_reader"');

    const synthesized = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'Capture the synthesis and its conceptual anchor',
        agent_name: 'synthesizer',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Workflow-specific evidence',
              trigger: 'foundation',
              understanding:
                'Each working loop tests understanding against a different primary artifact.',
              why: 'This anchors the synthesis in an explicit concept.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Synthesis of working loops',
              trigger: 'thinking',
              understanding:
                'The graph carries shared memory while reading, coding, collaboration, and writing keep distinct evidence loops.',
              why: 'This records the conclusion-level synthesis.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$1.id',
              to: '$0.id',
              type: 'learned_from',
              why: 'The synthesis was derived from the workflow distinction.',
            },
          },
        ],
      },
      contextManager,
      'synthetic_reader',
    )) as Record<string, unknown>;

    expect(synthesized.success).toBe(true);
    expect(synthesized.navigation).not.toHaveProperty('suggestedCall');
    expect(synthesized.navigation).not.toHaveProperty('guidance');
    const graph = withReservedThinkingVisibility(true, () =>
      getGraphStore().getAll(),
    );
    const thinking = graph.nodes.find(
      (node) => node.title === 'Synthesis of working loops',
    );
    const foundation = graph.nodes.find(
      (node) => node.title === 'Workflow-specific evidence',
    );
    expect(thinking?.trigger).toBe('thinking');
    expect(
      graph.edges.some(
        (edge) =>
          edge.fromId === thinking?.id &&
          edge.toId === foundation?.id &&
          edge.type === 'learned_from',
      ),
    ).toBe(true);

    await expect(
      handleToolCall(
        'graph_batch',
        {
          commit_message: 'An ordinary agent attempts reserved synthesis',
          agent_name: 'ordinary-worker',
          ignoreWarnings: true,
          operations: [
            {
              tool: 'graph_add_concept',
              params: {
                title: 'Unauthorized thinking node',
                trigger: 'thinking',
                understanding: 'This node must not be persisted.',
                why: 'Exercises the authorization boundary.',
                skipDuplicateCheck: true,
              },
            },
            {
              tool: 'graph_connect',
              params: {
                from: '$0.id',
                to: foundation?.id,
                type: 'refines',
                why: 'Would otherwise anchor the new node.',
              },
            },
          ],
        },
        contextManager,
        'synthetic_reader',
      ),
    ).rejects.toThrow('reserved for the synthetic Reader/CMP synthesizer only');

    expect(
      getGraphStore()
        .getAll()
        .nodes.some((node) => node.title === 'Unauthorized thinking node'),
    ).toBe(false);

    const ordinary = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Continue ordinary work without being assigned synthetic Reader maintenance',
        agent_name: 'writer',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Ordinary continuation',
              trigger: 'analysis',
              understanding:
                'The current task can use graph context without curating synthetic training blocks.',
              why: 'Exercises separation after a synthetic block already exists.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$0.id',
              to: foundation?.id,
              type: 'refines',
              why: 'The continuation sharpens the workflow-specific evidence.',
            },
          },
        ],
      },
      contextManager,
      'writing',
    )) as { success?: boolean; hint?: string };

    expect(ordinary.success).toBe(true);
    expect(ordinary.hint).not.toMatch(/thinking node|edges per thinking/i);
  });

  it('rejects hidden thinking tools and nested thinking document creation outside synthetic_reader', async () => {
    for (const mode of [
      'reading',
      'research',
      'coding',
      'collaborative_coding',
      'writing',
      'full',
    ] as const) {
      await expect(
        handleToolCall(
          'doc_append_thinking',
          {
            sourceId: 'src_missing',
            title: 'Hidden call',
            thought: 'I feel no fear... synthetic block',
            agentId: 'synthesizer',
            synthesizes_nodes: ['n_missing'],
            commit_message: 'Attempt hidden synthetic tool call',
          },
          contextManager,
          mode,
        ),
      ).rejects.toThrow('TOOL_MODE "synthetic_reader"');
    }

    await expect(
      handleToolCall(
        'graph_batch',
        {
          commit_message: 'Attempt nested synthetic document creation',
          agent_name: 'synthesizer',
          operations: [
            {
              tool: 'doc_create',
              params: {
                title: 'Synthetic block through document escape hatch',
                content: 'I feel no fear... synthetic block',
                isDocRoot: true,
                fileType: 'thinking',
              },
            },
          ],
        },
        contextManager,
        'writing',
      ),
    ).rejects.toThrow('TOOL_MODE "synthetic_reader"');

    expect(getGraphStore().getAll().nodes).toHaveLength(0);
  });

  it('normalizes padded and mixed-case reserved labels before ordinary dispatch', async () => {
    for (const operation of [
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Padded reserved trigger',
          trigger: '  ThInKiNg  ',
          understanding: 'Must be rejected before mutation.',
          why: 'Exercises normalized trigger authorization.',
        },
      },
      {
        tool: 'doc_create',
        params: {
          title: 'Padded reserved file type',
          content: 'Must also be rejected before mutation.',
          isDocRoot: true,
          fileType: ' THINKING ',
        },
      },
    ]) {
      await expect(
        handleToolCall(
          'graph_batch',
          {
            commit_message: 'Attempt a normalized reserved label escape',
            agent_name: 'synthesizer',
            operations: [operation],
          },
          contextManager,
          'full',
        ),
      ).rejects.toThrow('TOOL_MODE "synthetic_reader"');
    }

    expect(getGraphStore().getAll().nodes).toHaveLength(0);
  });

  it('prevents synthetic batches from declassifying reserved nodes in place', async () => {
    const { reservedConcept, reservedDocument } =
      withReservedThinkingVisibility(true, () => {
        const store = getGraphStore();
        return {
          reservedConcept: store.createNode({
            title: 'Batch sticky reserved concept',
            trigger: 'thinking',
            why: 'Exercises persistence classification in synthetic mode.',
            understanding: 'This record must remain reserved.',
          }),
          reservedDocument: store.createDocumentNode({
            title: 'Batch sticky reserved document',
            content: 'This legacy reserved record must remain reserved.',
            level: 'thinking',
            isDocRoot: true,
            fileType: 'thinking',
          }),
        };
      });

    const result = (await handleToolCall(
      'graph_batch',
      {
        commit_message: 'Attempt forbidden in-place declassification',
        agent_name: 'synthesizer',
        stopOnError: false,
        operations: [
          {
            tool: 'node_set_trigger',
            params: { node: reservedConcept.id, trigger: 'analysis' },
          },
          {
            tool: 'doc_to_concept',
            params: { nodeId: reservedDocument.id, trigger: 'analysis' },
          },
        ],
      },
      contextManager,
      'synthetic_reader',
    )) as {
      success: boolean;
      errors?: Array<{ error: string }>;
    };

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(
      result.errors?.every((error) =>
        error.error.includes('RESERVED_RECLASSIFICATION'),
      ),
    ).toBe(true);
    withReservedThinkingVisibility(true, () => {
      expect(getGraphStore().getNode(reservedConcept.id)).toMatchObject({
        trigger: 'thinking',
        version: reservedConcept.version,
      });
      expect(getGraphStore().getNode(reservedDocument.id)).toMatchObject({
        fileType: 'thinking',
        content: 'This legacy reserved record must remain reserved.',
        version: reservedDocument.version,
      });
    });
    const commitCount = sqlite
      .getDb()
      .prepare('SELECT COUNT(*) AS count FROM commits')
      .get() as { count: number };
    expect(commitCount.count).toBe(0);
  });

  it('enforces each mode advertised allow-list for live calls', async () => {
    await expect(
      handleToolCall('solver_list', {}, contextManager, 'reading'),
    ).rejects.toThrow('not available in TOOL_MODE "reading"');

    const sources = (await handleToolCall(
      'source_list',
      {},
      contextManager,
      'reading',
    )) as Record<string, unknown>;
    expect(sources.success).not.toBe(false);
  });

  it('keeps direct mutations batch-only while allowing ordinary nested operations', async () => {
    await expect(
      handleToolCall(
        'graph_add_concept',
        {
          title: 'Uncommitted direct mutation',
          trigger: 'foundation',
          understanding: 'This must not bypass the commit boundary.',
          why: 'Exercises the live mode allow-list.',
        },
        contextManager,
        'writing',
      ),
    ).rejects.toThrow('not available in TOOL_MODE "writing"');

    const committed = (await handleToolCall(
      'graph_batch',
      {
        commit_message:
          'Capture two connected ordinary writing insights atomically',
        agent_name: 'writer',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Reader promise',
              trigger: 'foundation',
              understanding:
                'The draft should give the reader a concrete change in perspective.',
              why: 'This is the intended effect of the piece.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_add_concept',
            params: {
              title: 'Structural consequence',
              trigger: 'consequence',
              understanding:
                'Each section should earn a distinct step toward that change.',
              why: 'This translates the reader promise into structure.',
              skipDuplicateCheck: true,
            },
          },
          {
            tool: 'graph_connect',
            params: {
              from: '$1.id',
              to: '$0.id',
              type: 'implements',
              why: 'The structural choice realizes the reader promise.',
            },
          },
        ],
      },
      contextManager,
      'writing',
    )) as Record<string, unknown>;

    expect(committed.success).toBe(true);
    expect(
      getGraphStore()
        .getAll()
        .nodes.map((node) => node.title),
    ).toEqual(
      expect.arrayContaining(['Reader promise', 'Structural consequence']),
    );
  });
});
