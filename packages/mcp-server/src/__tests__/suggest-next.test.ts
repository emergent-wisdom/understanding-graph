import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

const PROJECT_ID = 'suggest-next';

let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-suggest-next-'));
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
  vi.restoreAllMocks();
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('graph_suggest_next', () => {
  it('returns task-grounded concrete routes while leaving the decision to the model', async () => {
    const store = getGraphStore();
    const retry = store.createNode({
      title: 'Synchronized retry collapse',
      trigger: 'tension',
      why: 'Keeps the burst-load failure open.',
      understanding:
        'Fixed-delay retries synchronize clients and amplify burst load.',
    });
    store.createNode({
      title: 'Unrelated color study',
      trigger: 'reference',
      why: 'Provides distant graph material.',
      understanding: 'Violet recedes against warm paper.',
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = (await handleToolCall(
      'graph_suggest_next',
      {
        task: 'Investigate why fixed retries collapse under burst load',
        workflow: 'coding',
        count: 4,
      },
      contextManager,
      'full',
    )) as {
      protocol: string;
      mediumIntegrity: { canonicalState: string; invariant: string };
      roll: { hiddenActionSpace: boolean };
      options: Array<{
        action: string;
        stance: string;
        weight: number;
        subjects?: Array<{ id: string }>;
        steps: Array<{
          call?: { tool: string; arguments: Record<string, unknown> };
        }>;
      }>;
      choice: string;
    };

    expect(result.protocol).toBe('fluid-understanding-v1');
    expect(result.mediumIntegrity.canonicalState).toBe('graph');
    expect(result.mediumIntegrity.invariant).toContain('only in chat');
    expect(result.roll.hiddenActionSpace).toBe(true);
    expect(result.options[0]).toEqual(
      expect.objectContaining({
        action: 're-enter',
        stance: 'balanced',
        subjects: expect.arrayContaining([
          expect.objectContaining({ id: retry.id }),
        ]),
      }),
    );
    expect(result.options.every((option) => option.weight > 0)).toBe(true);
    expect(
      result.options
        .flatMap((option) => option.steps)
        .find((step) => step.call?.tool === 'graph_understand')?.call
        ?.arguments,
    ).toMatchObject({ workflow: 'coding', stance: 'balanced' });
    expect(result.choice).toContain('reject all');
    expect(result.choice).toContain('commit new artifact work');

    const reentry = result.options.find(
      (option) => option.action === 're-enter',
    );
    const inferred = (await handleToolCall(
      'graph_understand',
      {
        query: 'Investigate why fixed retries collapse under burst load',
        workflow: 'coding',
        focusNodeIds: reentry?.subjects?.map((subject) => subject.id),
      },
      contextManager,
      'full',
    )) as { stance: string; stanceSource: string };
    expect(inferred.stance).toBe(reentry?.stance);
    expect(inferred.stanceSource).toBe('suggested-route');
  });

  it('uses exact suggestion subjects for a forced generative pass without mutating the graph', async () => {
    const store = getGraphStore();
    const first = store.createNode({
      title: 'Crop monoculture',
      trigger: 'model',
      why: 'Names a common-mode failure pattern.',
      understanding: 'Uniform units can share one failure mode.',
    });
    const second = store.createNode({
      title: 'Retry jitter',
      trigger: 'hypothesis',
      why: 'Names a distributed-systems response.',
      understanding: 'Diverse retry timing may damp synchronization.',
    });
    const before = store.getAll();

    const result = (await handleToolCall(
      'graph_random',
      { nodeIds: [first.id, second.id], force: true },
      contextManager,
      'full',
    )) as {
      mode: string;
      nodes: Array<{ id: string }>;
      prompt: string;
    };

    expect(result.mode).toBe('forcing');
    expect(result.nodes.map((node) => node.id)).toEqual([first.id, second.id]);
    expect(result.prompt).toContain('temporary axiom');
    expect(result.prompt).toContain('no\nconnection');
    expect(store.getAll()).toEqual(before);
  });
});
