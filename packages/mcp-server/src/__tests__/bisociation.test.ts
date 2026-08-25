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
import { getToolDefinitions, handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'bisociation';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-bisociation-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, PROJECT_ID), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectDir, PROJECT_ID));
  }
  sqlite.setCurrentProject(PROJECT_ID);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('graph_bisociate', () => {
  it('surfaces spreading-activation candidates without mutating the graph', async () => {
    expect(
      getToolDefinitions('general').some(
        (definition) => definition.name === 'graph_bisociate',
      ),
    ).toBe(true);

    const store = getGraphStore();
    const seed = store.createNode({
      title: 'Narrative constraint',
      trigger: 'foundation',
      understanding: 'A strict rule keeps the story inside one room.',
      why: 'Provides the current focus for the bisociation test.',
    });
    const threshold = store.createNode({
      title: 'Architectural threshold',
      trigger: 'analysis',
      understanding: 'A doorway can separate spaces while joining them.',
      why: 'Provides a one-hop candidate reached from the current focus.',
    });
    const tide = store.createNode({
      title: 'Tidal rhythm',
      trigger: 'reference',
      understanding: 'Tides create patterned movement without leaving a basin.',
      why: 'Provides a more distant candidate reached through the threshold.',
    });
    store.createEdge({
      fromId: seed.id,
      toId: threshold.id,
      type: 'contextualizes',
      explanation: 'The room constraint is expressed through its threshold.',
      why: 'Connects the seed to a nearby architectural concept.',
    });
    store.createEdge({
      fromId: threshold.id,
      toId: tide.id,
      type: 'relates',
      explanation: 'The threshold suggests patterned crossing and return.',
      why: 'Creates a second activation hop to a semantically distant concept.',
    });
    const before = store.getAll();

    const result = (await handleToolCall(
      'graph_bisociate',
      {
        seed_nodes: [seed.id],
        steps: 2,
        decay: 0.6,
        limit: 5,
      },
      contextManager,
      'general',
    )) as {
      success: boolean;
      mode: string;
      seeds: Array<{ id: string; name: string; understanding: string }>;
      candidates: Array<{
        source: { id: string; name?: string; understanding?: string };
        target: { id: string; name: string; understanding: string };
        activation: number;
        pathLength: number;
        informationGain: {
          structuralSurprisal: number;
          semanticSurprisal: number | null;
          clusterSurprisal: number;
          combined: number;
        };
      }>;
    };

    expect(result).toMatchObject({
      success: true,
      mode: 'seeded-spreading-activation',
      seeds: [
        {
          id: seed.id,
          name: 'Narrative constraint',
          understanding: seed.understanding,
        },
      ],
    });
    expect(result.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({ id: seed.id }),
          target: expect.objectContaining({
            id: threshold.id,
            name: 'Architectural threshold',
            understanding: threshold.understanding,
          }),
          activation: expect.any(Number),
          pathLength: 1,
          informationGain: {
            structuralSurprisal: expect.any(Number),
            semanticSurprisal: null,
            clusterSurprisal: expect.any(Number),
            combined: expect.any(Number),
          },
        }),
        expect.objectContaining({
          source: expect.objectContaining({ id: seed.id }),
          target: expect.objectContaining({
            id: tide.id,
            name: 'Tidal rhythm',
            understanding: tide.understanding,
          }),
          activation: expect.any(Number),
          pathLength: 2,
          informationGain: {
            structuralSurprisal: expect.any(Number),
            semanticSurprisal: null,
            clusterSurprisal: expect.any(Number),
            combined: expect.any(Number),
          },
        }),
      ]),
    );
    expect(
      result.candidates.every((candidate) => candidate.activation > 0),
    ).toBe(true);
    expect(store.getAll()).toEqual(before);
  });

  it('falls back to sampled cold pairs on a sparse graph and carries document content', async () => {
    const store = getGraphStore();
    const seed = store.createNode({
      title: 'Isolated seed',
      trigger: 'foundation',
      understanding: 'No edge leaves this starting point.',
      why: 'Exercises the sparse seeded fallback.',
    });
    store.createNode({
      title: 'Document passage',
      trigger: 'reference',
      content: 'The document passage describes a recursive lantern mechanism.',
      level: 'paragraph',
      fileType: 'markdown',
      why: 'Proves document content remains visible to creativity tools.',
    });
    store.createNode({
      title: 'Another island',
      trigger: 'tension',
      understanding: 'A second unconnected region.',
      why: 'Provides another sparse-graph candidate.',
    });

    const seeded = (await handleToolCall(
      'graph_bisociate',
      { seed_nodes: [seed.id], limit: 4 },
      contextManager,
      'general',
    )) as {
      mode: string;
      fallbackKind: string;
      candidates: unknown[];
    };
    expect(seeded).toMatchObject({
      mode: 'graph-wide-fallback',
      fallbackKind: 'stochastic-sparse-graph',
    });
    expect(seeded.candidates.length).toBeGreaterThan(0);
    expect(JSON.stringify(seeded.candidates)).toContain(
      'recursive lantern mechanism',
    );

    const graphWide = (await handleToolCall(
      'graph_bisociate',
      { strategy: 'mixed', limit: 4 },
      contextManager,
      'general',
    )) as { mode: string; candidates: unknown[] };
    expect(graphWide.mode).toBe('graph-wide-stochastic-fallback');
    expect(graphWide.candidates.length).toBeGreaterThan(0);
  });

  it('rejects invalid algorithm parameters instead of silently coercing them', async () => {
    await expect(
      handleToolCall(
        'graph_bisociate',
        { limit: 2.5 },
        contextManager,
        'general',
      ),
    ).rejects.toThrow(/limit must be an integer/i);
    await expect(
      handleToolCall(
        'graph_bisociate',
        { strategy: 'mystery' },
        contextManager,
        'general',
      ),
    ).rejects.toThrow(/strategy must be one of/i);
  });
});
