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

const PROJECT_ID = 'thermostat';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-thermostat-'));
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

describe('graph_thermostat', () => {
  it('reports a heuristic advisory pulse over live, rather than historical, uncertainty', async () => {
    const definition = getToolDefinitions('general').find(
      (tool) => tool.name === 'graph_thermostat',
    );
    expect(definition?.description).toContain('advisory, not a governor');

    const store = getGraphStore();
    const question = store.createNode({
      title: 'Which clock controls retry deadlines?',
      trigger: 'question',
      why: 'Records the design question before it is answered.',
      understanding:
        'Client and scheduler clocks could produce different deadlines.',
    });
    const answer = store.createNode({
      title: 'Scheduler time is authoritative',
      trigger: 'decision',
      why: 'Records the settled clock convention.',
      understanding: 'Retry deadlines are normalized against scheduler time.',
    });
    const tension = store.createNode({
      title: 'Accuracy versus retry throughput',
      trigger: 'tension',
      why: 'Preserves a trade-off that remains live.',
      understanding:
        'More precise scheduling may reduce maximum retry throughput.',
    });
    store.createEdge({
      fromId: answer.id,
      toId: question.id,
      type: 'answers',
      why: 'The decision closes the original clock question.',
    });
    store.createEdge({
      fromId: tension.id,
      toId: answer.id,
      type: 'relates',
      why: 'The live trade-off remains relevant to the settled convention.',
    });

    const result = (await handleToolCall(
      'graph_thermostat',
      {},
      contextManager,
      'general',
    )) as {
      metrics: {
        total_nodes: number;
        unresolved_tension: string;
      };
      physics: {
        entropyKind: string;
      };
      advisory: {
        strategy: string;
        recommended_tool: string;
      };
    };

    expect(result.metrics).toMatchObject({
      total_nodes: 3,
      cognitive_nodes: 3,
      document_nodes: 0,
      unresolved_tension: '33.3%',
    });
    expect(result.physics.entropyKind).toBe(
      'heuristic structural disorder proxy over cognitive nodes',
    );
    expect(result.advisory).toMatchObject({
      strategy: expect.any(String),
      recommended_tool: expect.any(String),
    });
  });
});
