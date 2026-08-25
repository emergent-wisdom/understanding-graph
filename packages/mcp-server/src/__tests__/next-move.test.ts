import { describe, expect, it } from 'vitest';
import { rollNextMoves } from '../next-move.js';

describe('weighted next-move suggestions', () => {
  it('samples a weighted subset without replacement and keeps routes advisory', () => {
    const moves = rollNextMoves(
      {
        task: 'Understand why the prototype stalls under burst load',
        workflow: 'coding',
        focusNodeIds: ['n_focus'],
        nodeCount: 12,
        edgeCount: 17,
        unresolvedCount: 2,
        documentCount: 4,
        count: 6,
      },
      () => 0.47,
    );

    expect(moves).toHaveLength(6);
    expect(new Set(moves.map((move) => move.action)).size).toBe(6);
    expect(moves.every((move) => move.weight >= 1 && move.weight <= 100)).toBe(
      true,
    );
    expect(moves.every((move) => move.steps.length > 0)).toBe(true);
    expect(moves.every((move) => move.whyNow.includes('State pressure'))).toBe(
      true,
    );
    expect(Math.max(...moves.map((move) => move.weight))).toBe(100);
  });

  it('normalizes a lone returned weight against the sampled set', () => {
    const moves = rollNextMoves(
      {
        task: 'Consider one next move',
        workflow: 'general',
        focusNodeIds: [],
        nodeCount: 8,
        edgeCount: 9,
        unresolvedCount: 2,
        documentCount: 1,
        count: 1,
      },
      () => 0.999,
    );

    expect(moves).toHaveLength(1);
    expect(moves[0].weight).toBe(100);
  });

  it('omits inapplicable graph routes while preserving continue, preserve, and pause', () => {
    const moves = rollNextMoves(
      {
        task: 'Begin a new inquiry',
        workflow: 'general',
        focusNodeIds: [],
        nodeCount: 0,
        edgeCount: 0,
        unresolvedCount: 0,
        documentCount: 0,
        count: 12,
      },
      () => 0.5,
    );

    expect(moves.map((move) => move.action).sort()).toEqual([
      'continue',
      'pause',
      'preserve',
    ]);
  });

  it('offers source reading only for reading and research workflows', () => {
    const common = {
      task: 'Compare the accounts',
      focusNodeIds: [],
      nodeCount: 5,
      edgeCount: 4,
      unresolvedCount: 1,
      documentCount: 0,
      creativityEnabled: false,
      count: 12,
    };

    const research = rollNextMoves(
      { ...common, workflow: 'research' },
      () => 0.5,
    );
    const writing = rollNextMoves(
      { ...common, workflow: 'writing' },
      () => 0.5,
    );

    expect(research.some((move) => move.action === 'read-source')).toBe(true);
    expect(writing.some((move) => move.action === 'read-source')).toBe(false);
  });

  it('can roll an exact forced bisociation while keeping scrutiny as a second step', () => {
    const nodes = [
      { id: 'n_orchard', title: 'Orchard monoculture' },
      { id: 'n_retries', title: 'Synchronized retries' },
      { id: 'n_clock', title: 'Clock drift' },
    ];
    const seen = new Map<string, ReturnType<typeof rollNextMoves>[number]>();

    for (let seed = 1; seed <= 20; seed += 1) {
      let state = seed;
      const random = () => {
        state = (state * 48271) % 2147483647;
        return state / 2147483647;
      };
      for (const move of rollNextMoves(
        {
          task: 'Find a non-obvious resilience mechanism',
          workflow: 'research',
          focusNodeIds: [],
          nodeCount: 3,
          edgeCount: 2,
          unresolvedCount: 0,
          documentCount: 0,
          randomNodes: nodes,
          count: 6,
        },
        random,
      )) {
        seen.set(move.action, move);
      }
    }

    const forced = seen.get('force-bisociation');
    expect(forced?.steps[0].call).toEqual(
      expect.objectContaining({
        tool: 'graph_random',
        arguments: expect.objectContaining({
          force: true,
          nodeIds: expect.any(Array),
        }),
      }),
    );
    const nodeIds = forced?.steps[0].call?.arguments.nodeIds as string[];
    expect(nodeIds).toHaveLength(2);
    expect(nodeIds.every((id) => nodes.some((node) => node.id === id))).toBe(
      true,
    );
    expect(forced?.steps[1].description).toContain('no connection is valid');
  });

  it('can include creativity tools in the roll or omit them without disabling ordinary guidance', () => {
    const creativeActions = new Set([
      'bisociate',
      'disrupt',
      'force-bisociation',
      'axiomatic-noise',
    ]);
    const base = {
      task: 'Find a less familiar way to frame the design',
      workflow: 'writing',
      focusNodeIds: ['n_focus'],
      nodeCount: 8,
      edgeCount: 14,
      unresolvedCount: 0,
      documentCount: 3,
      randomNodes: [
        { id: 'n_focus', title: 'Current frame' },
        { id: 'n_cold', title: 'Dormant analogy' },
        { id: 'n_edge', title: 'Boundary condition' },
      ],
      focusNodes: [{ id: 'n_focus', title: 'Current frame' }],
      count: 6,
    };
    const enabledSeen = new Set<string>();

    for (let seed = 1; seed <= 40; seed += 1) {
      let state = seed;
      const random = () => {
        state = (state * 48271) % 2147483647;
        return state / 2147483647;
      };
      for (const move of rollNextMoves(
        { ...base, creativityEnabled: true },
        random,
      )) {
        if (creativeActions.has(move.action)) enabledSeen.add(move.action);
      }
    }

    expect(enabledSeen).toEqual(creativeActions);

    const disabledSeen = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      let state = seed;
      const random = () => {
        state = (state * 48271) % 2147483647;
        return state / 2147483647;
      };
      const disabled = rollNextMoves(
        { ...base, creativityEnabled: false },
        random,
      );
      expect(disabled.some((move) => creativeActions.has(move.action))).toBe(
        false,
      );
      disabled.forEach((move) => {
        disabledSeen.add(move.action);
      });
    }
    expect(disabledSeen.has('re-enter')).toBe(true);

    const disabledCalls = rollNextMoves(
      { ...base, taskRelevantNodes: [], creativityEnabled: false },
      () => 0,
    ).flatMap((move) =>
      move.steps.flatMap((step) => (step.call ? [step.call.tool] : [])),
    );
    expect(disabledCalls).not.toContain('graph_discover_grounded');
  });

  it('can roll topology orientation and timestamped delta re-entry', () => {
    const seen = new Map<string, ReturnType<typeof rollNextMoves>[number]>();
    const updatesSince = '2026-08-25T00:00:00.000Z';

    for (let seed = 1; seed <= 40; seed += 1) {
      let state = seed;
      const random = () => {
        state = (state * 48271) % 2147483647;
        return state / 2147483647;
      };
      for (const move of rollNextMoves(
        {
          task: 'Resume work without mistaking one packet for the whole graph',
          workflow: 'general',
          focusNodeIds: [],
          nodeCount: 24,
          edgeCount: 30,
          unresolvedCount: 2,
          documentCount: 3,
          creativityEnabled: false,
          updatesSince,
          count: 6,
        },
        random,
      )) {
        seen.set(move.action, move);
      }
    }

    expect(seen.get('survey-topology')?.steps[0].call).toEqual({
      tool: 'graph_skeleton',
      arguments: {},
    });
    expect(seen.get('survey-topology')?.steps[1].description).toContain(
      'graph_context_region',
    );
    expect(seen.get('catch-up')?.steps[0].call).toEqual({
      tool: 'graph_updates',
      arguments: { since: updatesSince },
    });
  });

  it('offers practice as an optional mirror without manufacturing a missing node type', () => {
    let practice: ReturnType<typeof rollNextMoves>[number] | undefined;

    for (let seed = 1; seed <= 30 && !practice; seed += 1) {
      let state = seed;
      const random = () => {
        state = (state * 48271) % 2147483647;
        return state / 2147483647;
      };
      practice = rollNextMoves(
        {
          task: 'Continue understanding the text naturally',
          workflow: 'reading',
          focusNodeIds: [],
          nodeCount: 20,
          edgeCount: 25,
          unresolvedCount: 1,
          documentCount: 6,
          count: 6,
        },
        random,
      ).find((move) => move.action === 'check-practice');
    }

    expect(practice).toBeDefined();
    expect(practice?.whyNow).not.toMatch(/predict|scor/i);
    expect(practice?.whyNow).toContain('not a missing-work checklist');
    expect(practice?.steps[0].call).toEqual({
      tool: 'graph_practice',
      arguments: {},
    });
    expect(practice?.steps[0].description).toContain(
      'an absent node type is not work to manufacture',
    );
    expect(practice?.steps[1].description).toContain('otherwise ignore');
  });
});

/**
 * A fault that belongs to the SEQUENCE is invisible to every node-level check.
 *
 * Measured while drafting a five-passage story with the tool driving: two
 * rolled `reread-artifact` suggestions and a last-sentence sweep all passed,
 * and reading the piece end to end found that nobody in it wanted anything.
 * Every passage was individually fine; the absence was a property of the order.
 *
 * The natural trigger — time since the agent last read it whole — is
 * unobservable, because the graph records writes and never reads. So the
 * option keys on a writing-streak proxy instead: prose has accumulated, and
 * has outpaced live thinking.
 */
describe('reading the artifact in order is reachable', () => {
  const base = {
    task: 'Write the next passage of the story',
    workflow: 'writing',
    focusNodeIds: [],
    nodeCount: 11,
    edgeCount: 12,
    creativityEnabled: false,
    count: 12,
    documentNodes: [
      {
        id: 'n_story_root',
        title: 'The story',
        trigger: 'foundation',
        isDocRoot: true,
      },
    ],
  };

  function actions(input: Parameters<typeof rollNextMoves>[0]) {
    return rollNextMoves(input, () => 0.5).map((m) => m.action);
  }

  it('offers a whole-artifact read once prose has accumulated', () => {
    expect(
      actions({ ...base, unresolvedCount: 1, documentCount: 6 }),
      'An artifact of six document nodes offered no way to read it in order. ' +
        'Node-level rereads cannot see a fault that belongs to the sequence.',
    ).toContain('read-artifact-whole');
  });

  it('stays out of the way before there is a sequence to read', () => {
    // Two passages are not a sequence, and proposing a whole read there would
    // be the ceremony this tool is supposed to avoid.
    expect(
      actions({ ...base, unresolvedCount: 1, documentCount: 2 }),
      'Offered a whole-artifact read before enough of the artifact existed.',
    ).not.toContain('read-artifact-whole');
  });

  it('weights it above a single-node reread when prose outpaces thinking', () => {
    const moves = rollNextMoves(
      { ...base, unresolvedCount: 1, documentCount: 8, count: 12 },
      () => 0.5,
    );
    const whole = moves.find((m) => m.action === 'read-artifact-whole');
    const single = moves.find((m) => m.action === 'reread-artifact');
    expect(whole, 'whole-artifact read absent').toBeDefined();
    expect(single, 'single reread absent').toBeDefined();

    // Eight document nodes against one unresolved thread is the writing-streak
    // case: adding without stepping back. Rereading one passage is the weaker
    // move there, and the weights should say so.
    expect(
      (whole?.weight ?? 0) > (single?.weight ?? 0),
      `whole=${whole?.weight} single=${single?.weight}: the sequence-level ` +
        'read should outweigh a single-node reread when prose has outpaced ' +
        'live thinking.',
    ).toBe(true);
    expect(whole?.subjects).toEqual([
      expect.objectContaining({ id: 'n_story_root', isDocRoot: true }),
    ]);
    expect(whole?.steps[0].call).toEqual({
      tool: 'doc_read',
      arguments: { nodeId: 'n_story_root', offset: 0, limit: 8 },
    });
    expect(whole?.steps[1].description).toContain('pagination.nextOffset');
  });

  it('never rolls a concrete call that the active capability surface lacks', () => {
    const availableTools = new Set(['graph_understand']);
    for (let index = 0; index < 100; index += 1) {
      const moves = rollNextMoves(
        {
          ...base,
          workflow: 'research',
          nodeCount: 30,
          edgeCount: 50,
          unresolvedCount: 4,
          documentCount: 8,
          updatesSince: '2026-08-25T00:00:00.000Z',
          creativityEnabled: true,
          availableTools,
          count: 6,
        },
        () => ((index * 37) % 101) / 101,
      );
      for (const call of moves.flatMap((move) =>
        move.steps.flatMap((step) => (step.call ? [step.call] : [])),
      )) {
        expect(availableTools.has(call.tool), call.tool).toBe(true);
      }
    }
  });
});
