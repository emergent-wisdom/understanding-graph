import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EmbeddingService,
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { getToolDefinitions, handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'creativity-lifecycle';

interface VariationEvaluation {
  success: boolean;
  winner: {
    index: number;
    full_text: string;
    divergence: number;
    coherence: number;
    novelty_score: number;
  };
  ranking: Array<{
    index: number;
    variation: string;
    divergence: number;
    coherence: number;
    novelty_score: number;
  }>;
}

interface BatchResult {
  success: boolean;
  results: Array<Record<string, unknown>>;
  message?: string;
}

let temporaryDirectory: string;
let contextManager: ContextManager;

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ug-creativity-lifecycle-'),
  );
  const projectDirectory = path.join(temporaryDirectory, 'projects');
  fs.mkdirSync(path.join(projectDirectory, PROJECT_ID), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDirectory);
  sqlite.initAllDatabases(projectDirectory);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectDirectory, PROJECT_ID));
  }
  sqlite.setCurrentProject(PROJECT_ID);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  vi.restoreAllMocks();
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function setEmbedding(nodeId: string, embedding: Float32Array): void {
  sqlite
    .getDb()
    .prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
    .run(EmbeddingService.embeddingToBuffer(embedding), nodeId);
}

describe('creativity scoring and scrutiny lifecycle', () => {
  it('rejects malformed variation arrays without shifting indexes or scores', async () => {
    const malformed = (await handleToolCall(
      'graph_evaluate_variations',
      {
        context: 'Original frame',
        variations: ['first', '', 'third'],
        coherence_scores: [5, 6, 7],
      },
      contextManager,
      'general',
    )) as { success: boolean; error: string };
    expect(malformed.success).toBe(false);
    expect(malformed.error).toMatch(/not silently removed/i);

    const misaligned = (await handleToolCall(
      'graph_evaluate_variations',
      {
        context: 'Original frame',
        variations: ['first', 'second'],
        coherence_scores: [5],
      },
      contextManager,
      'general',
    )) as { success: boolean; error: string };
    expect(misaligned.success).toBe(false);
    expect(misaligned.error).toMatch(/exactly one score per variation/i);
  });

  it('refuses to validate an ordinary node as if it were serendipity', async () => {
    const ordinary = getGraphStore().createNode({
      title: 'Ordinary analysis',
      trigger: 'analysis',
      understanding: 'A normal graph claim is not in the creativity lifecycle.',
      why: 'Exercises the validation type boundary.',
    });
    const result = (await handleToolCall(
      'graph_batch',
      {
        agent_name: 'creativity-lifecycle-test',
        commit_message: 'Attempt an invalid lifecycle transition',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_validate',
            params: {
              node: ordinary.id,
              insight: 'This must not reclassify an ordinary node.',
            },
          },
        ],
      },
      contextManager,
      'general',
    )) as BatchResult;
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/rolled back/i);
    expect(getGraphStore().getNode(ordinary.id)?.validated).not.toBe(true);
  });

  it('ranks variations by harmonic novelty from cosine divergence and caller coherence in an ordinary mode', async () => {
    const embeddings = new Map<string, Float32Array>([
      ['Original frame', new Float32Array([1, 0])],
      ['Orthogonal but grounded', new Float32Array([0, 1])],
      ['Close continuation', new Float32Array([0.8, 0.6])],
    ]);
    const generateEmbedding = vi
      .spyOn(EmbeddingService, 'generateEmbedding')
      .mockImplementation(async (text) => {
        const embedding = embeddings.get(text);
        if (!embedding) throw new Error(`Unexpected embedding input: ${text}`);
        return embedding;
      });

    expect(
      getToolDefinitions('general').some(
        (definition) => definition.name === 'graph_evaluate_variations',
      ),
    ).toBe(true);

    const result = (await handleToolCall(
      'graph_evaluate_variations',
      {
        context: 'Original frame',
        variations: ['Orthogonal but grounded', 'Close continuation'],
        coherence_scores: [5, 10],
      },
      contextManager,
      'general',
    )) as VariationEvaluation;

    // Variation 0: D = 1 - cos([1,0], [0,1]) = 1 and C = 5/10.
    // S_N = 2DC/(D+C) = 2*1*.5/1.5 = .666..., rounded to .667.
    expect(result.success).toBe(true);
    expect(result.ranking).toEqual([
      {
        index: 0,
        variation: 'Orthogonal but grounded',
        divergence: 1,
        coherence: 0.5,
        novelty_score: 0.667,
      },
      {
        index: 1,
        variation: 'Close continuation',
        divergence: 0.2,
        coherence: 1,
        novelty_score: 0.333,
      },
    ]);
    expect(result.winner).toEqual({
      index: 0,
      full_text: 'Orthogonal but grounded',
      divergence: 1,
      coherence: 0.5,
      novelty_score: 0.667,
    });
    expect(generateEmbedding.mock.calls.map(([text]) => text)).toEqual([
      'Original frame',
      'Orthogonal but grounded',
      'Close continuation',
    ]);
  });

  it('keeps a highly scored synthesis unvalidated until a later explicit validation batch', async () => {
    const store = getGraphStore();
    const sourceA = store.createNode({
      title: 'Source A',
      trigger: 'foundation',
      why: 'Supplies the first exact source for the synthesis.',
      understanding: 'One source frame.',
    });
    const sourceB = store.createNode({
      title: 'Source B',
      trigger: 'tension',
      why: 'Supplies the contrasting exact source for the synthesis.',
      understanding: 'A contrasting source frame.',
    });
    const ambient = store.createNode({
      title: 'Ambient bridge',
      trigger: 'model',
      why: 'Supplies a non-source coherence match.',
      understanding: 'A nearby concept makes the synthesis relevant.',
    });
    setEmbedding(sourceA.id, new Float32Array([0, 1]));
    setEmbedding(sourceB.id, new Float32Array([0.6, 0.8]));
    setEmbedding(ambient.id, new Float32Array([0.9, 0.4358899]));
    store.invalidateCache();

    vi.spyOn(EmbeddingService, 'isModelLoaded').mockReturnValue(true);
    vi.spyOn(EmbeddingService, 'generateEmbedding').mockResolvedValue(
      new Float32Array([1, 0]),
    );
    vi.spyOn(EmbeddingService, 'generateNodeEmbedding').mockImplementation(
      async (source) => {
        if (source.title === 'Source A') return new Float32Array([0, 1]);
        if (source.title === 'Source B') return new Float32Array([0.6, 0.8]);
        throw new Error(`Unexpected source: ${source.title}`);
      },
    );
    vi.spyOn(store, 'generateAndStoreEmbedding').mockImplementation(
      async (nodeId) => {
        setEmbedding(nodeId, new Float32Array([1, 0]));
        store.invalidateCache();
        return true;
      },
    );
    const boundedSearch = vi.spyOn(store, 'semanticSearch');

    const discovery = (await handleToolCall(
      'graph_batch',
      {
        agent_name: 'creativity-lifecycle-test',
        commit_message:
          'Record a promising synthesis while preserving its provisional status',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_serendipity',
            params: {
              name: 'Provisional bridge',
              synthesis:
                'The two source frames may meet through a third mechanism.',
              source_elements: [sourceA.id, sourceB.id],
              why: 'The bridge is worth preserving for later scrutiny.',
            },
          },
        ],
      },
      contextManager,
      'general',
    )) as BatchResult;

    expect(discovery.success, discovery.message).toBe(true);
    const discoveryResult = discovery.results[0] as {
      id: string;
      validated: boolean;
      scoring: {
        verdict: string;
        novelty_score: number;
        divergence: number;
        coherence: number;
      };
    };
    expect(discoveryResult.scoring.verdict).toBe('ACCEPT');
    expect(boundedSearch).not.toHaveBeenCalled();
    // D uses only the explicitly supplied sources: average cosine is
    // (0 + .6) / 2 = .3, hence D=.7. C is the best non-source match (.9),
    // and their harmonic mean is .7875, rounded by the tool to .79.
    expect(discoveryResult.scoring).toMatchObject({
      divergence: 0.7,
      coherence: 0.9,
      novelty_score: 0.79,
    });
    expect(discoveryResult.validated).toBe(false);

    const provisional = store.getNode(discoveryResult.id);
    expect(provisional).toMatchObject({
      trigger: 'serendipity',
      validated: false,
      sourceElements: [sourceA.id, sourceB.id],
    });
    expect(
      store
        .getAll()
        .edges.filter((edge) => edge.fromId === discoveryResult.id)
        .map((edge) => ({ to: edge.toId, type: edge.type })),
    ).toEqual(
      expect.arrayContaining([
        { to: sourceA.id, type: 'learned_from' },
        { to: sourceB.id, type: 'learned_from' },
      ]),
    );

    const centrality = (await handleToolCall(
      'graph_centrality',
      {},
      contextManager,
      'general',
    )) as {
      pageRank: Array<{
        id: string;
        validated?: boolean;
        epistemicStatus?: string;
      }>;
    };
    expect(
      centrality.pageRank.find((node) => node.id === discoveryResult.id),
    ).toMatchObject({
      validated: false,
      epistemicStatus: 'speculative',
    });

    const validation = (await handleToolCall(
      'graph_batch',
      {
        agent_name: 'creativity-lifecycle-test',
        commit_message:
          'Validate the provisional bridge only after an independent check',
        ignoreWarnings: true,
        operations: [
          {
            tool: 'graph_validate',
            params: {
              node: discoveryResult.id,
              insight:
                'A separate test confirmed the bridge mechanism survives scrutiny.',
            },
          },
        ],
      },
      contextManager,
      'general',
    )) as BatchResult;

    expect(validation.success, validation.message).toBe(true);
    expect(validation.results[0]).toMatchObject({
      id: discoveryResult.id,
      validated: true,
    });
    expect(store.getNode(discoveryResult.id)?.validated).toBe(true);
  });
});
