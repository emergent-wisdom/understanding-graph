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
      roll: {
        creativity: string;
        hiddenActionSpace: boolean;
        distribution: string;
        shuffleBag: { purpose: string };
        interpretation: string;
      };
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
    expect(result.roll.creativity).toBe('enabled');
    expect(result.roll.distribution).toContain('within this roll');
    expect(result.roll.shuffleBag.purpose).toContain('recently suggested');
    expect(result.roll.shuffleBag.purpose).toContain(
      'does not observe which option the model chose',
    );
    expect(result.roll.shuffleBag.purpose).not.toContain('paid off');
    expect(result.roll.interpretation).toContain('not obligations');
    expect(result.roll.interpretation).toContain('low-weight pause');
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
        stance: reentry?.stance,
      },
      contextManager,
      'full',
    )) as { stance: string; stanceSource: string };
    expect(inferred.stance).toBe(reentry?.stance);
    expect(inferred.stanceSource).toBe('explicit');
  });

  it('can suppress creative provocations for one roll while retaining ordinary routes', async () => {
    const store = getGraphStore();
    store.createNode({
      title: 'Current design',
      trigger: 'model',
      why: 'Provides a nonempty graph for the chooser.',
      understanding: 'The current design has a familiar local optimum.',
    });
    store.createNode({
      title: 'Dormant alternative',
      trigger: 'question',
      why: 'Provides an unresolved ordinary route.',
      understanding: 'Could a different boundary make the system simpler?',
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.4);

    const result = (await handleToolCall(
      'graph_suggest_next',
      {
        task: 'Continue examining the design',
        workflow: 'general',
        creativity: false,
        count: 6,
      },
      contextManager,
      'general',
    )) as {
      roll: { creativity: string };
      options: Array<{ action: string }>;
    };

    expect(result.roll.creativity).toBe('disabled');
    expect(result.options).not.toEqual([]);
    expect(
      result.options.some((option) =>
        [
          'bisociate',
          'disrupt',
          'force-bisociation',
          'axiomatic-noise',
        ].includes(option.action),
      ),
    ).toBe(false);
  });

  it('does not present answered questions or healthy diversity as unresolved conflict', async () => {
    const store = getGraphStore();
    const question = store.createNode({
      title: 'Which clock governs retries?',
      trigger: 'question',
      why: 'Keeps the timing ambiguity explicit',
      understanding: 'The scheduler and client clocks may diverge.',
    });
    const answer = store.createNode({
      title: 'The scheduler clock governs retries',
      trigger: 'decision',
      why: 'Records the resolved timing convention',
      understanding: 'All retry deadlines are normalized by the scheduler.',
    });
    const alternative = store.createNode({
      title: 'Client-local timing remains useful for telemetry',
      trigger: 'model',
      why: 'Preserves a compatible second perspective',
      understanding: 'Local clocks still explain observed latency.',
    });
    store.createEdge({
      fromId: answer.id,
      toId: question.id,
      type: 'answers',
      why: 'This decision resolves the governing-clock question.',
    });
    store.createEdge({
      fromId: alternative.id,
      toId: answer.id,
      type: 'diverse_from',
      why: 'Both views are useful at different layers and do not conflict.',
    });
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const result = (await handleToolCall(
      'graph_suggest_next',
      {
        task: 'Continue the retry design',
        workflow: 'coding',
        count: 6,
      },
      contextManager,
      'general',
    )) as {
      options: Array<{
        action: string;
        label: string;
        subjects?: Array<{ id: string }>;
      }>;
    };

    const deepen = result.options.find((option) => option.action === 'deepen');
    expect(deepen?.label).not.toContain(question.title);
    expect(deepen?.subjects ?? []).not.toContainEqual(
      expect.objectContaining({ id: question.id }),
    );
    expect(result.options.some((option) => option.action === 'integrate')).toBe(
      false,
    );
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

  it('normalizes an offset update cursor before using or returning it', async () => {
    const result = (await handleToolCall(
      'graph_suggest_next',
      {
        task: 'Catch up before continuing',
        workflow: 'general',
        updatesSince: '2026-08-25T02:00:00+02:00',
      },
      contextManager,
      'general',
    )) as { roll: { updatesSince: string } };

    expect(result.roll.updatesSince).toBe('2026-08-25T00:00:00.000Z');
  });
});
