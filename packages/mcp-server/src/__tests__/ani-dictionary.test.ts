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

const DICTIONARY_PATH_ENV = 'UG_ANI_DICTIONARY_PATH';
const originalDictionaryPath = process.env[DICTIONARY_PATH_ENV];

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-ani-dictionary-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, 'ani-test'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes('ani-test')) {
    sqlite.initDatabase(path.join(projectDir, 'ani-test'));
  }
  sqlite.setCurrentProject('ani-test');
  await contextManager.switchProject('ani-test');
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after a failed fixture.
  }
  resetGraphStore();
  if (originalDictionaryPath === undefined) {
    delete process.env[DICTIONARY_PATH_ENV];
  } else {
    process.env[DICTIONARY_PATH_ENV] = originalDictionaryPath;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeDictionary(name: string, words: string[]): string {
  const dictionaryPath = path.join(tmpDir, name);
  fs.writeFileSync(dictionaryPath, `${words.join('\n')}\n`);
  return dictionaryPath;
}

async function runDictionaryChaos(text = 'alpha beta gamma delta') {
  return (await handleToolCall(
    'graph_chaos',
    { text, intensity: 1, source: 'dictionary' },
    contextManager,
    'full',
  )) as {
    success: boolean;
    corrupted: string;
    seeds: string[];
    seedCount: number;
    source: string;
  };
}

describe('machine-local ANI dictionary', () => {
  it('injects only words from the configured dictionary', async () => {
    process.env[DICTIONARY_PATH_ENV] = writeDictionary('fixture.txt', [
      'mycelium',
      'quasar',
    ]);

    const result = await runDictionaryChaos();

    expect(result.success).toBe(true);
    expect(result.source).toBe('dictionary');
    expect(result.seedCount).toBe(4);
    expect(result.corrupted).not.toBe('alpha beta gamma delta');
    expect(result.seeds).toHaveLength(4);
    expect(
      result.seeds.every((seed) => ['MYCELIUM', 'QUASAR'].includes(seed)),
    ).toBe(true);
  });

  it('fails clearly when the configured dictionary is missing instead of using a fallback', async () => {
    const missingPath = path.join(tmpDir, 'missing-dictionary.txt');
    process.env[DICTIONARY_PATH_ENV] = missingPath;

    let failure: unknown;
    try {
      await runDictionaryChaos();
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain(DICTIONARY_PATH_ENV);
    expect(message).toContain(missingPath);
    expect(message).toMatch(/no bundled or reduced fallback/i);
  });

  it('reloads the dictionary when the configured machine-local path changes', async () => {
    process.env[DICTIONARY_PATH_ENV] = writeDictionary('first.txt', [
      'mycelium',
    ]);
    const first = await runDictionaryChaos('alpha beta');
    expect(first.seeds).toEqual(['MYCELIUM', 'MYCELIUM']);

    process.env[DICTIONARY_PATH_ENV] = writeDictionary('second.txt', [
      'quasar',
    ]);
    const second = await runDictionaryChaos('gamma delta');
    expect(second.seeds).toEqual(['QUASAR', 'QUASAR']);
  });

  it('returns a host-neutral blind prompt instead of a provider-specific spawn command', async () => {
    process.env[DICTIONARY_PATH_ENV] = writeDictionary('blind.txt', [
      'mycelium',
    ]);

    const result = (await handleToolCall(
      'graph_chaos',
      {
        text: 'alpha beta',
        intensity: 1,
        source: 'dictionary',
        blind: true,
      },
      contextManager,
      'general',
    )) as {
      mode: string;
      blindAgentRecommendation: { blindPrompt: string };
    };

    expect(result.mode).toBe('blind');
    expect(result.blindAgentRecommendation.blindPrompt).toContain(
      'blind sense-making agent',
    );
    expect(result.blindAgentRecommendation.blindPrompt).not.toContain('Task(');
    expect(result.blindAgentRecommendation.blindPrompt).not.toContain('haiku');
    expect(result.blindAgentRecommendation.blindPrompt).not.toContain(
      'graph_batch',
    );
    expect(result.blindAgentRecommendation.blindPrompt).not.toContain(
      'graph_serendipity',
    );
  });

  it('accepts Unicode words from localized machine dictionaries and input', async () => {
    process.env[DICTIONARY_PATH_ENV] = writeDictionary('swedish.txt', [
      'förståelse',
      'mönster',
    ]);

    const result = await runDictionaryChaos('världen tänker');

    expect(result.seeds).toHaveLength(2);
    expect(
      result.seeds.every((seed) => ['FÖRSTÅELSE', 'MÖNSTER'].includes(seed)),
    ).toBe(true);
  });

  it('perturbs letter cores while preserving ordinary punctuation', async () => {
    process.env[DICTIONARY_PATH_ENV] = writeDictionary('punctuation.txt', [
      'mycelium',
    ]);

    const result = await runDictionaryChaos('“Alpha,” beta.');

    expect(result.seeds).toEqual(['MYCELIUM', 'MYCELIUM']);
    expect(result.corrupted).toBe('“[MYCELIUM],” [MYCELIUM].');
  });

  it('does not require a dictionary when graph nodes are the explicit entropy source', async () => {
    process.env[DICTIONARY_PATH_ENV] = path.join(
      tmpDir,
      'missing-dictionary.txt',
    );
    getGraphStore().createNode({
      title: 'Graph Seed',
      trigger: 'foundation',
      understanding: 'A locally available entropy source.',
      why: 'Proves graph-sourced ANI is independent of the host dictionary.',
    });

    const result = (await handleToolCall(
      'graph_chaos',
      {
        text: 'alpha beta',
        intensity: 1,
        source: 'graph',
      },
      contextManager,
      'full',
    )) as {
      success: boolean;
      source: string;
      seeds: string[];
    };

    expect(result.success).toBe(true);
    expect(result.source).toBe('graph');
    expect(result.seeds).toEqual(['GRAPH', 'GRAPH']);
  });

  it('keeps graph_discover persistence instructions outside its blind prompt', async () => {
    process.env[DICTIONARY_PATH_ENV] = writeDictionary('discover.txt', [
      'mycelium',
    ]);
    getGraphStore().createNode({
      title: 'Source passage',
      trigger: 'reference',
      content: 'A document passage about thresholds and return.',
      why: 'Provides bounded source material for ANI.',
    });

    const result = (await handleToolCall(
      'graph_discover',
      { nodes: 1, intensity: 1, blind: true },
      contextManager,
      'general',
    )) as {
      blindAgentRecommendation: { blindPrompt: string };
      persistenceRecommendation: { operation: string };
    };

    expect(result.persistenceRecommendation.operation).toBe(
      'graph_serendipity',
    );
    expect(result.blindAgentRecommendation.blindPrompt).not.toContain(
      'graph_batch',
    );
    expect(result.blindAgentRecommendation.blindPrompt).not.toContain(
      'graph_serendipity',
    );
  });

  it('rejects fractional or negative sampling counts', async () => {
    await expect(
      handleToolCall('graph_random', { nodes: 1.5 }, contextManager, 'general'),
    ).rejects.toThrow(/nodes must be an integer/i);
    await expect(
      handleToolCall('graph_random', { edges: -1 }, contextManager, 'general'),
    ).rejects.toThrow(/edges must be an integer/i);
  });

  it('rejects malformed bisociation seed arrays instead of filtering or truncating them', async () => {
    await expect(
      handleToolCall(
        'graph_bisociate',
        { seed_nodes: ['n_valid', 17] },
        contextManager,
        'general',
      ),
    ).rejects.toThrow(/1 to 6 non-empty node references/i);
    await expect(
      handleToolCall(
        'graph_bisociate',
        {
          seed_nodes: ['n_1', 'n_2', 'n_3', 'n_4', 'n_5', 'n_6', 'n_7'],
        },
        contextManager,
        'general',
      ),
    ).rejects.toThrow(/1 to 6 non-empty node references/i);
  });

  it('rotates cold ANI source nodes after they are exposed', async () => {
    const store = getGraphStore();
    for (const title of [
      'Alpha source',
      'Beta source',
      'Gamma source',
      'Delta source',
    ]) {
      store.createNode({
        title,
        trigger: 'foundation',
        understanding: `${title} carries enough semantic material for ANI.`,
        why: 'Exercises access-aware cold sampling.',
      });
    }

    const discover = async () =>
      (await handleToolCall(
        'graph_discover',
        { nodes: 2, cold: true, intensity: 0 },
        contextManager,
        'general',
      )) as { sourceNodes: Array<{ id: string }> };

    const first = await discover();
    const second = await discover();
    const firstIds = new Set(first.sourceNodes.map((node) => node.id));

    expect(first.sourceNodes).toHaveLength(2);
    expect(second.sourceNodes).toHaveLength(2);
    expect(second.sourceNodes.every((node) => !firstIds.has(node.id))).toBe(
      true,
    );
  });

  it('returns grounded edges only when both endpoints were selected', async () => {
    const store = getGraphStore();
    const selected = ['First', 'Second', 'Third'].map((title) =>
      store.createNode({
        title,
        trigger: 'foundation',
        understanding: `${title} grounded-comparison fixture.`,
        why: 'Exercises grounded edge provenance.',
      }),
    );
    const outside = store.createNode({
      title: 'Outside',
      trigger: 'reference',
      understanding: 'This node should not be selected by the cold draw.',
      why: 'Provides an edge whose other endpoint is absent.',
    });
    store.createEdge({
      fromId: selected[0].id,
      toId: selected[1].id,
      type: 'relates',
      why: 'Provides one eligible selected-node edge.',
    });
    store.createEdge({
      fromId: selected[0].id,
      toId: outside.id,
      type: 'relates',
      why: 'Must not appear without the outside endpoint.',
    });
    store.recordAccess(outside.id);

    const result = (await handleToolCall(
      'graph_discover_grounded',
      { nodes: 3, edges: 8, cold: true, intensity: 0 },
      contextManager,
      'general',
    )) as {
      sourceNodes: Array<{ id: string }>;
      sourceEdges: Array<{ from: string; to: string }>;
    };
    const selectedIds = new Set(result.sourceNodes.map((node) => node.id));

    expect(result.sourceEdges).toHaveLength(1);
    expect(
      result.sourceEdges.every(
        (edge) => selectedIds.has(edge.from) && selectedIds.has(edge.to),
      ),
    ).toBe(true);
  });

  it('fails clearly when grounded comparison or forcing lacks two distinct nodes', async () => {
    const only = getGraphStore().createNode({
      title: 'Only node',
      trigger: 'foundation',
      understanding: 'A single node cannot form a comparison pair.',
      why: 'Exercises sparse creativity preconditions.',
    });
    const grounded = (await handleToolCall(
      'graph_discover_grounded',
      { nodes: 2 },
      contextManager,
      'general',
    )) as { success: boolean; error: string };
    expect(grounded).toMatchObject({
      success: false,
      error: 'INSUFFICIENT_GRAPH',
    });

    await expect(
      handleToolCall(
        'graph_random',
        { nodeIds: [only.id, only.title], force: true },
        contextManager,
        'general',
      ),
    ).rejects.toThrow(/two distinct visible graph nodes/i);
  });

  it('allows intensity zero without loading an unavailable dictionary', async () => {
    process.env[DICTIONARY_PATH_ENV] = path.join(
      tmpDir,
      'missing-dictionary.txt',
    );
    const result = (await handleToolCall(
      'graph_chaos',
      { text: 'alpha beta', intensity: 0, source: 'dictionary' },
      contextManager,
      'general',
    )) as { success: boolean; corrupted: string; seeds: string[] };
    expect(result).toMatchObject({
      success: true,
      corrupted: 'alpha beta',
      seeds: [],
    });
  });

  it('refuses a positive ANI request when no word can be perturbed', async () => {
    await expect(
      handleToolCall(
        'graph_chaos',
        { text: 'a 12 !', intensity: 0.5, source: 'dictionary' },
        contextManager,
        'general',
      ),
    ).rejects.toThrow(/no words of at least four Unicode letters/i);
  });
});
