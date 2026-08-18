import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resetGraphStore, sqlite } from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

/**
 * A node that was later overturned has to say so where it is surfaced.
 *
 * Resistance carries overturned nodes deliberately, and carries their `attend`
 * deliberately too: on a node something later contradicted, the attend is the
 * instruction that correction exists to give. But the packet said nothing
 * about the node's standing, so a discharged instruction arrived looking
 * exactly like a pending one.
 *
 * Measured on a real project. A node carried "test this on a larger city with
 * a wider income spread". The test was run, it invalidated the node, a verdict
 * was recorded — and the next re-entry delivered the same attend as live work,
 * with no indication that the finding it belonged to had been retired. An
 * agent following it would redo finished work and arrive at a conclusion the
 * graph already held. That is the tool's core function producing waste.
 *
 * There is no way to resolve an attend after the fact: graph_note takes
 * status 'resolved' only for the note it is creating, and graph_add_concept
 * always writes attentionStatus 'open'. Marking the node's standing is
 * therefore the available fix, and it is also the more faithful one — the
 * attend should still arrive, it just should not arrive undated.
 */
const PROJECT_ID = 'overturned-says-so';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-overturned-'));
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
  title: string;
  attend?: string;
  overturnedBy?: string;
}
interface Packet {
  frame?: { baseline?: Framed[]; resistance?: Framed[] };
}

const CLAIM = 'Mixing costs nothing at all';
const VERDICT = 'The free result was an artifact of a small city';

async function batch(commit_message: string, operations: unknown[]) {
  const result = (await handleToolCall(
    'graph_batch',
    { agent_name: 'test-agent', commit_message, operations },
    contextManager,
    'research',
  )) as { success: boolean; message?: string };
  expect(result.success, `setup failed: ${result.message}`).toBe(true);
  return result;
}

/** A claim carrying an instruction, and something that later retires it. */
async function seed(retiringType: string) {
  await batch('Record a claim, then retire it', [
    {
      tool: 'graph_add_concept',
      params: {
        title: CLAIM,
        trigger: 'surprise',
        why: 'Records what a first run appeared to show',
        understanding:
          'Two allocations had identical access cost while segregation halved, so mixing looked free. ' +
          'The city was small enough that almost every journey fell inside the tolerance, which is the part that was never checked.',
        attend:
          'Test this on a larger city with a wider income spread before relying on it.',
      },
    },
    {
      tool: 'graph_add_concept',
      params: {
        title: VERDICT,
        trigger: 'evaluation',
        why: 'Reports the test the claim asked for and what it settled',
        understanding:
          'On a six-block city the trade-off reappears, so the free result belonged to the demo rather than to cities.',
      },
    },
    {
      tool: 'graph_connect',
      params: {
        from: VERDICT,
        to: CLAIM,
        type: retiringType,
        why: 'Following this reaches the claim the wider test settled, and how it came out.',
      },
    },
  ]);
}

async function resistance(): Promise<Framed[]> {
  const packet = (await handleToolCall(
    'graph_understand',
    { query: 'what did the earlier run get wrong', retrieval: 'lexical' },
    contextManager,
    'research',
  )) as Packet;
  return packet.frame?.resistance ?? [];
}

describe('a retired claim arrives dated', () => {
  it('names what overturned it, beside the instruction it still carries', async () => {
    await seed('invalidates');
    const claim = (await resistance()).find((n) => n.title === CLAIM);
    expect(claim, 'the overturned claim was not surfaced at all').toBeDefined();

    // The attend must still arrive — on an overturned node it is the
    // instruction the correction exists to give.
    expect(claim?.attend).toContain('larger city');
    expect(
      claim?.overturnedBy,
      'The packet delivered a discharged instruction with nothing to say the ' +
        'finding behind it had been retired. Following it redoes finished work.',
    ).toBe(VERDICT);
  });

  it('treats supersedes the same way', async () => {
    await seed('supersedes');
    const claim = (await resistance()).find((n) => n.title === CLAIM);
    expect(claim?.overturnedBy).toBe(VERDICT);
  });

  it('leaves a merely contradicted claim unmarked', async () => {
    // Two positions can conflict while both stay live. Reporting that as
    // overturned would settle by fiat an argument the graph is holding open.
    await seed('contradicts');
    const claim = (await resistance()).find((n) => n.title === CLAIM);
    expect(claim, 'the contradicted claim should still be surfaced').toBeDefined();
    expect(claim?.overturnedBy).toBeUndefined();
  });
});
