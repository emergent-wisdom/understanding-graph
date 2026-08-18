import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EmbeddingService,
  getGraphStore,
  resetGraphStore,
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { getToolDefinitions, handleToolCall } from '../tools/index.js';

interface ScoreResult {
  score: number;
  project?: string;
  metrics: Record<string, unknown>;
  counts?: Record<string, number>;
  issues: string[] | null;
  hint: string;
}

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-score-'));
  const projectDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectDir, 'score-test'), { recursive: true });

  contextManager = new ContextManager();
  contextManager.setProjectDir(projectDir);
  sqlite.initAllDatabases(projectDir);
  if (!sqlite.getLoadedProjectIds().includes('score-test')) {
    sqlite.initDatabase(path.join(projectDir, 'score-test'));
  }
  sqlite.setCurrentProject('score-test');
  await contextManager.switchProject('score-test');
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

async function scoreGraph(): Promise<ScoreResult> {
  return (await handleToolCall(
    'graph_score',
    {},
    contextManager,
  )) as ScoreResult;
}

function setNodeEvidence(
  nodeId: string,
  createdAt: string,
  embedding: Float32Array,
): void {
  sqlite
    .getDb()
    .prepare('UPDATE nodes SET created_at = ?, embedding = ? WHERE id = ?')
    .run(createdAt, EmbeddingService.embeddingToBuffer(embedding), nodeId);
}

describe('graph_score ordinary graph boundary', () => {
  it('describes an ordinary structural proxy without thinking-specific options', () => {
    const definition = getToolDefinitions('full').find(
      (tool) => tool.name === 'graph_score',
    );
    const schema = definition?.inputSchema as {
      properties?: Record<string, unknown>;
    };

    expect(definition?.description).toContain(
      'Reserved Reader/CMP artifacts are excluded',
    );
    expect(definition?.description).toContain(
      'a proxy, not evidence of semantic quality',
    );
    expect(definition?.description).not.toMatch(
      /thinking nodes|cannot be gamed/i,
    );
    expect(schema.properties).not.toHaveProperty('detailed');
  });

  it('normalizes ordinary metrics to 100 and ignores reserved nodes and incident edges', async () => {
    const store = getGraphStore();
    const foundation = store.createNode({
      title: 'Ordinary foundation',
      trigger: 'foundation',
      why: 'Anchors the structural score fixture.',
      understanding: 'Later ordinary nodes refine this foundation.',
    });
    setNodeEvidence(
      foundation.id,
      '2020-01-01 00:00:00',
      new Float32Array([1, 0]),
    );

    for (let index = 0; index < 10; index++) {
      const node = store.createNode({
        title: `Ordinary update ${index + 1}`,
        trigger: 'analysis',
        why: 'Provides a chronological ordinary-graph update.',
        understanding: 'This update stays coherent with the foundation.',
      });
      setNodeEvidence(
        node.id,
        `2021-01-${String(index + 1).padStart(2, '0')} 00:00:00`,
        new Float32Array([1, 0]),
      );
      store.createEdge({
        fromId: node.id,
        toId: foundation.id,
        type: index < 5 ? 'supersedes' : 'refines',
        why: 'Records a specific, explained backward reference.',
      });
    }

    const ordinaryScore = await scoreGraph();
    expect(ordinaryScore.score).toBe(100);
    expect(ordinaryScore.counts).toEqual({
      totalNodes: 11,
      questionNodes: 0,
      totalEdges: 10,
    });

    const reserved = withReservedThinkingVisibility(true, () => {
      const reserved = store.createNode({
        title: 'Synthetic Reader block',
        trigger: 'thinking',
        why: 'Represents reserved synthesizer output.',
        understanding: 'This artifact must not affect the ordinary score.',
      });
      setNodeEvidence(
        reserved.id,
        '2022-01-01 00:00:00',
        new Float32Array([0, 1]),
      );
      store.createEdge({
        fromId: reserved.id,
        toId: foundation.id,
        type: 'relates',
        why: 'Makes any accidental inclusion observable in every edge metric.',
      });
      return reserved;
    });

    expect(await scoreGraph()).toEqual(ordinaryScore);

    withReservedThinkingVisibility(true, () =>
      store.archiveNode(reserved.id, 'Exercise an inactive reserved endpoint.'),
    );
    expect(await scoreGraph()).toEqual(ordinaryScore);

    withReservedThinkingVisibility(true, () => {
      const legacyReserved = store.createNode({
        title: 'Legacy synthetic Reader block',
        trigger: 'analysis',
        content: 'A legacy block identified only by its file type.',
        level: 'paragraph',
        fileType: 'thinking',
      });
      store.createEdge({
        fromId: legacyReserved.id,
        toId: foundation.id,
        type: 'relates',
        why: 'Makes legacy file-type inclusion observable in the score.',
      });
    });
    expect(await scoreGraph()).toEqual(ordinaryScore);

    expect(JSON.stringify(ordinaryScore)).not.toMatch(
      /thinkingIntegration|thinkingNodes|edgesPerThinking|thinkingChain/i,
    );
  });

  it('gives ordinary structural advice without nudging toward synthetic output', async () => {
    getGraphStore().createNode({
      title: 'Unresolved ordinary question',
      trigger: 'question',
      why: 'Exercises a low structural score without Reader artifacts.',
      understanding: 'The graph has not yet recorded an answer.',
    });

    const result = await scoreGraph();

    expect(result.score).toBe(36);
    expect(result.hint).toContain('specific, explained edges');
    expect(result.hint).not.toMatch(/thinking|Reader|CMP|synthe/i);
    expect(JSON.stringify(result.metrics)).not.toMatch(/thinking/i);
  });
});
