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
 * Retired claims must carry their standing in baseline as well as resistance.
 * Resistance has a bounded capacity, so baseline-eligible retired claims must
 * retain that marking when they fall outside the resistance list.
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
 * These synthetic evaluation nodes are retired by surprise nodes to exercise
 * baseline eligibility independently of the bounded resistance list.
 */
const PAIRS = [1, 2, 3, 4, 5].map((n) => ({
  retired: `Verdict: reference ${n} determines calibration on its own`,
  corrector: `Correction: reference ${n} does not explain the calibration`,
}));

async function seed() {
  const operations = [
    {
      tool: 'graph_add_understanding',
      params: {
        title: 'Synthetic fixture: sensor readings need a reference',
        trigger: 'foundation',
        why: 'Anchors every claim below so none of them stands alone',
        understanding:
          'A fixture sensor reading is interpreted relative to its configured reference.',
      },
    },
  ];
  for (const { retired, corrector } of PAIRS) {
    operations.push(
      {
        tool: 'graph_add_understanding',
        params: {
          title: retired,
          // Baseline-eligible on purpose. With a resistance trigger this node
          // could never reach baseline and the test would prove nothing.
          trigger: 'evaluation',
          why: 'Records the fixture claim about one reference setting',
          understanding:
            'Changing one fixture reference changed the reported calibration, suggesting a direct effect.',
        },
      },
      {
        tool: 'graph_add_understanding',
        params: {
          title: corrector,
          trigger: 'surprise',
          why: 'Reports the wider test that retired the earlier verdict',
          understanding:
            'A control comparison reproduced the calibration change without changing this reference.',
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
          to: 'Synthetic fixture: sensor readings need a reference',
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
    { query: 'verdict reference determines calibration', retrieval: 'lexical' },
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
      expect(node.overturnedBy).toBe(
        PAIRS.find((pair) => pair.retired === node.title)?.corrector,
      );
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
