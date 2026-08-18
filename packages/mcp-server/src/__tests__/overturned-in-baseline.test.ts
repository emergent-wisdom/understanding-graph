import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

/**
 * An overturned node has to arrive dated wherever it arrives.
 *
 * `overturnedBy` was applied only while framing the RESISTANCE list. Baseline
 * nodes were framed by the same helper with the option omitted, so a retired
 * claim landing in baseline said nothing about its standing — and baseline is
 * the list presented as settled ground, which makes it the worse of the two
 * places to lose the marking.
 *
 * The two lists are not alternatives you can reason about statically: the
 * resistance list is capped, so once more claims are overturned than there are
 * slots, the surplus lands in baseline. Observed on this project's own meta
 * graph — a verdict carrying an inbound `invalidates` was delivered in
 * baseline with no marking at all, while the correction that retired it was
 * delivered in resistance.
 */
const PROJECT_ID = 'overturned-baseline';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-ovb-'));
  const projectsDir = path.join(tmpDir, 'projects');
  fs.mkdirSync(path.join(projectsDir, PROJECT_ID), { recursive: true });
  contextManager = new ContextManager();
  contextManager.setProjectDir(projectsDir);
  sqlite.initAllDatabases(projectsDir);
  if (!sqlite.getLoadedProjectIds().includes(PROJECT_ID)) {
    sqlite.initDatabase(path.join(projectsDir, PROJECT_ID));
  }
  sqlite.setCurrentProject(PROJECT_ID);
  await contextManager.switchProject(PROJECT_ID);
});

afterEach(() => {
  try {
    sqlite.closeAllDatabases();
  } catch {
    // Ignore cleanup after failed assertions.
  }
  resetGraphStore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

interface Framed {
  id: string;
  title: string;
  overturnedBy?: string;
}
interface Packet {
  frame?: { baseline?: Framed[]; resistance?: Framed[] };
}

/**
 * The retired node must carry a BASELINE-ELIGIBLE trigger, or the routing
 * makes the case unreachable and the test proves nothing. `surprise`,
 * `tension` and `question` are resistance triggers and are excluded from
 * baseline outright, so a retired claim carrying one can never land there.
 *
 * `evaluation` retired by `surprise` is the live shape this came from: a
 * verdict node invalidated by a later correction.
 */
const PAIRS = [1, 2, 3, 4, 5].map((n) => ({
  retired: `Verdict: tolerance ${n} governs the outcome on its own`,
  corrector: `Correction: tolerance ${n} was not doing the work`,
}));

async function seed() {
  const operations = [
    {
      tool: 'graph_add_concept',
      params: {
        title: 'Access cost is measured against a tolerance',
        trigger: 'foundation',
        why: 'Anchors every claim below so none of them stands alone',
        understanding:
          'Journeys inside the tolerance cost nothing, and journeys beyond it are counted.',
      },
    },
  ];
  for (const { retired, corrector } of PAIRS) {
    operations.push(
      {
        tool: 'graph_add_concept',
        params: {
          title: retired,
          // Baseline-eligible on purpose. With a resistance trigger this node
          // could never reach baseline and the test would prove nothing.
          trigger: 'evaluation',
          why: 'Records what one run appeared to settle about a tolerance',
          understanding:
            'A sweep moved this tolerance and the allocation changed, so it looked decisive on its own.',
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: corrector,
          trigger: 'surprise',
          why: 'Reports the wider test that retired the earlier verdict',
          understanding:
            'Holding the other tolerance fixed reproduced the same movement, so the effect was not this one.',
        },
      },
    );
  }
  for (const { retired, corrector } of PAIRS) {
    operations.push(
      {
        tool: 'graph_connect',
        params: {
          from: retired,
          to: 'Access cost is measured against a tolerance',
          type: 'learned_from',
          why: 'Following this reaches the definition the claim is about.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: corrector,
          to: retired,
          type: 'invalidates',
          why: 'Following this reaches the verdict the wider test retired.',
        },
      },
    );
  }

  const result = (await handleToolCall(
    'graph_batch',
    {
      agent_name: 'test-agent',
      commit_message: 'Five retired claims',
      operations,
    },
    contextManager,
    'research',
  )) as { success: boolean; message?: string };
  expect(result.success, `seed failed: ${result.message}`).toBe(true);
}

async function frame() {
  const packet = (await handleToolCall(
    'graph_understand',
    { query: 'verdict tolerance governs the outcome', retrieval: 'lexical' },
    contextManager,
    'research',
  )) as Packet;
  return {
    baseline: packet.frame?.baseline ?? [],
    resistance: packet.frame?.resistance ?? [],
  };
}

const retiredTitles = new Set(PAIRS.map((p) => p.retired));

describe('a retired claim arrives dated in baseline too', () => {
  it('puts more retired claims on the frame than resistance can hold', async () => {
    await seed();
    const { baseline, resistance } = await frame();

    // Printed rather than assumed: the earlier version of this fix was written
    // against a guess about which list a node lands in, and a test that cannot
    // see the routing cannot tell a fix from a coincidence.
    const inBaseline = baseline.filter((n) => retiredTitles.has(n.title));
    const inResistance = resistance.filter((n) => retiredTitles.has(n.title));
    console.log(
      `retired claims — baseline: ${inBaseline.length}, resistance: ${inResistance.length}`,
    );
    console.log(
      `BASELINE:\n${baseline.map((n) => `    ${n.title}`).join('\n') || '    (none)'}`,
    );
    console.log(
      `RESISTANCE:\n${resistance.map((n) => `    ${n.title}`).join('\n') || '    (none)'}`,
    );

    expect(
      inBaseline.length,
      'No retired claim reached baseline, so this test cannot show anything ' +
        'about baseline marking. Raise the number of pairs.',
    ).toBeGreaterThan(0);
  });

  it('marks a retired claim that lands in baseline', async () => {
    await seed();
    const { baseline } = await frame();
    const retired = baseline.filter((n) => retiredTitles.has(n.title));
    expect(retired.length).toBeGreaterThan(0);

    for (const node of retired) {
      expect(
        node.overturnedBy,
        `"${node.title}" was delivered in baseline — the list a reader takes ` +
          'as settled ground — with nothing to say it had been retired.',
      ).toBeTruthy();
      expect(node.overturnedBy).toContain('was not doing the work');
    }
  });

  it('still marks the ones that land in resistance', async () => {
    // Guard against the fix moving the marking rather than widening it.
    await seed();
    const { resistance } = await frame();
    for (const node of resistance.filter((n) => retiredTitles.has(n.title))) {
      expect(node.overturnedBy).toBeTruthy();
    }
  });
});
