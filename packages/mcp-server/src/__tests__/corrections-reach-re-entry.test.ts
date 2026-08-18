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
 * A correction must not depend on the query resembling it.
 *
 * Resistance is otherwise reached by one hop from a seed, and seeds are chosen
 * by similarity to the query. That makes being shown you were wrong contingent
 * on happening to ask about the thing you were wrong about, which is backwards
 * for a tool whose stated purpose is that re-entry changes later work.
 *
 * Measured on a real graph before this floor existed: the identical query run
 * lexically surfaced two overturned positions, and after backfilling
 * embeddings surfaced none. The packet became more on-topic and stopped
 * reporting the corrections — an "upgrade" that made the tool worse at its
 * stated job, and an easy one to mistake for an improvement.
 *
 * Both directions matter, so both are pinned here: the floor must fire when
 * the selection reports no correction, and must NOT displace anything when the
 * query already reached one.
 */
const PROJECT_ID = 'corrections-reach';
let tmpDir: string;
let contextManager: ContextManager;

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-corrections-'));
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

interface FramedNode {
  id: string;
  title: string;
  excerpt: string;
  attend?: string;
  why?: string;
}

interface Packet {
  frame?: { baseline?: FramedNode[]; resistance?: FramedNode[] };
  selection?: { method?: string };
}

async function batch(
  commit_message: string,
  operations: Array<{ tool: string; params: Record<string, unknown> }>,
) {
  const result = (await handleToolCall(
    'graph_batch',
    { agent_name: 'test-agent', commit_message, operations },
    contextManager,
    'research',
  )) as { success: boolean; message?: string };
  expect(result.success, `setup batch failed: ${result.message}`).toBe(true);
  return result;
}

async function understand(query: string) {
  return (await handleToolCall(
    'graph_understand',
    { query, workflow: 'research', retrieval: 'lexical' },
    contextManager,
    'research',
  )) as Packet;
}

/**
 * A graph where the correction is deliberately unrelated to the query: the
 * overturned claim is about caching, the query is about deployment. Nothing
 * lexically connects them, so only a structural floor can surface it.
 */
async function seedGraphWithDistantCorrection() {
  // One batch, because orphan prevention requires every new concept to reach
  // existing knowledge — a second, self-contained batch would be an island.
  //
  // The grounding edge from the deployment material is deliberately
  // `learned_from`, which is NOT a resistance type. Resistance walks only
  // invalidates / contradicts / supersedes / questions / diverse_from, so this
  // satisfies grounding without opening a one-hop path from a deployment seed
  // to the overturned caching claim. Using a resistance-typed edge here would
  // make the test pass for the wrong reason.
  await batch(
    'Record a claim about caching, overturn it, and add deployment material',
    [
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Cache invalidation can be left to expiry alone',
          trigger: 'hypothesis',
          why: 'Records the position that later work overturned',
          // Deliberately over 600 characters: the excerpt budget must have
          // something to cut, or the truncation assertions pass vacuously.
          understanding:
            'An early belief that time-based expiry would be sufficient and that explicit invalidation was unnecessary complexity. ' +
            'The reasoning ran that a short window bounds staleness, that bounded staleness is acceptable for reads, and that an ' +
            'explicit invalidation path introduces its own failure modes — a missed invalidation is worse than a brief stale read, ' +
            'and the machinery to guarantee delivery is substantial. Under steady traffic this held up well enough that nobody ' +
            'revisited it, and the assumption hardened into something the rest of the design leaned on without ever restating it. ' +
            'The conclusion that matters, and it arrives last: this was wrong under write bursts, and the whole argument above ' +
            'should be read as the setup rather than the finding.',
          attend:
            'Check the write-burst case before trusting any expiry-based staleness bound.',
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Expiry alone left stale reads under write bursts',
          trigger: 'surprise',
          why: 'Overturns the earlier caching position with a measured failure',
          understanding:
            'Under write bursts the expiry window was long enough to serve stale reads, so explicit invalidation is required after all.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: 'Expiry alone left stale reads under write bursts',
          to: 'Cache invalidation can be left to expiry alone',
          type: 'contradicts',
          why: 'Following this reaches the belief the measurement overturned, and why expiry was insufficient.',
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Deployment rollout ordering matters for migrations',
          trigger: 'analysis',
          why: 'Anchors the deployment topic the query will reach',
          understanding:
            'Schema migrations must land before the deployment that depends on them, or the rollout serves errors.',
        },
      },
      {
        tool: 'graph_add_concept',
        params: {
          title: 'Deployment rollback needs a tested path',
          trigger: 'tension',
          why: 'Adds a second deployment node so resistance has query-reached candidates',
          understanding:
            'A rollback path that has never been exercised is not a rollback path, and deployment confidence rests on it.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: 'Deployment rollout ordering matters for migrations',
          to: 'Expiry alone left stale reads under write bursts',
          type: 'learned_from',
          why: 'Following this reaches the staleness measurement that shaped how ordering was thought about here.',
        },
      },
      {
        tool: 'graph_connect',
        params: {
          from: 'Deployment rollback needs a tested path',
          to: 'Deployment rollout ordering matters for migrations',
          type: 'questions',
          why: 'Following this reaches the ordering claim that an untested rollback puts in doubt.',
        },
      },
    ],
  );
}

describe('corrections reach re-entry regardless of the query', () => {
  it('surfaces an overturned position the query never mentions', async () => {
    await seedGraphWithDistantCorrection();

    const packet = await understand(
      'What should I attend to when planning a deployment rollout?',
    );
    const resistance = packet.frame?.resistance ?? [];

    expect(
      resistance.map((r) => r.title),
      'The packet reported no overturned position. Resistance is reached one ' +
        'hop from similarity-selected seeds, so a correction about caching is ' +
        'unreachable from a deployment query — which makes being shown you ' +
        'were wrong contingent on already asking about it.',
    ).toContain('Cache invalidation can be left to expiry alone');
  });

  it('does not duplicate a correction the packet already shows', async () => {
    await seedGraphWithDistantCorrection();

    // This query lands directly on the caching material, so the overturned
    // node is selected as prior state and appears in `baseline`. Resistance
    // excludes baseline by design, so the correct outcome is that the floor
    // adds nothing: the packet already reports it, once.
    const packet = await understand(
      'What did we learn about cache invalidation and expiry?',
    );
    const OVERTURNED = 'Cache invalidation can be left to expiry alone';
    const shown = [
      ...(packet.frame?.baseline ?? []),
      ...(packet.frame?.resistance ?? []),
    ].filter((n) => n.title === OVERTURNED);

    expect(
      shown,
      'The overturned position should appear exactly once across the packet. ' +
        'Zero would mean the correction was lost; two would mean the floor ' +
        'fired on top of a selection that already reported it.',
    ).toHaveLength(1);
  });
});

describe('what re-entry delivers about a correction', () => {
  const OVERTURNED = 'Cache invalidation can be left to expiry alone';

  it('delivers a correction whole rather than excerpted', async () => {
    await seedGraphWithDistantCorrection();

    const packet = await understand(
      'What should I attend to when planning a deployment rollout?',
    );
    const correction = (packet.frame?.resistance ?? []).find(
      (n) => n.title === OVERTURNED,
    );
    expect(correction, 'the correction was not surfaced at all').toBeDefined();

    // A correction's payload is its last sentence. Excerpting a node that was
    // surfaced BECAUSE it overturns something delivers the setup and drops the
    // finding — measured on a real graph, where a withdrawal was cut at
    // "So my inference was", immediately before "it was backwards. Withdrawn."
    expect(
      correction?.excerpt,
      'The correction was truncated. Its conclusion is what makes it a ' +
        'correction, and it arrives last.',
    ).toContain('should be read as the setup rather than the finding');
  });

  it("delivers the correction's attend, which is its instruction", async () => {
    await seedGraphWithDistantCorrection();

    const packet = await understand(
      'What should I attend to when planning a deployment rollout?',
    );
    const correction = (packet.frame?.resistance ?? []).find(
      (n) => n.title === OVERTURNED,
    );

    // 82 nodes carried an attend and none had ever reached a packet, so the
    // field written for a later instance was never delivered to one.
    expect(
      correction?.attend,
      'The correction arrived without its attend. The excerpt tells the story; ' +
        'the attend is the part addressed to whoever is reading it now.',
    ).toContain('write-burst');
  });

  it('delivers the role line on the orientation channels', async () => {
    await seedGraphWithDistantCorrection();

    const packet = await understand(
      'What should I attend to when planning a deployment rollout?',
    );
    const oriented = [
      ...(packet.frame?.baseline ?? []),
      ...(packet.frame?.resistance ?? []),
    ];
    expect(oriented.length, 'no oriented nodes to check').toBeGreaterThan(0);

    // `why` is required on every node precisely because nothing else records
    // what a node DOES to the understanding around it. It was required
    // everywhere and delivered nowhere: a reader scanning a packet got 600
    // characters of what each node says and no line on what any of them is
    // for.
    const withRole = oriented.filter((n) => n.why?.trim());
    expect(
      withRole.length,
      'No node on baseline or resistance carried its why. The role line is ' +
        'the cheapest orientation in the packet and costs 2.7% of it.',
    ).toBeGreaterThan(0);

    // And it must be the role, not the document sentinel.
    for (const node of withRole) {
      expect(
        node.why,
        `"${node.title}" carried the sentinel as a role`,
      ).not.toBe('Document node');
    }
  });

  it('marks a truncated excerpt so a fragment cannot read as whole', async () => {
    await seedGraphWithDistantCorrection();

    // Query the caching material directly: the long node lands in baseline,
    // which is excerpted, so the marker is exercisable there.
    const packet = await understand(
      'What did we learn about cache invalidation and expiry?',
    );
    const truncated = [
      ...(packet.frame?.baseline ?? []),
      ...(packet.frame?.resistance ?? []),
    ].filter((n) => n.excerpt.includes('…'));

    expect(
      truncated.length,
      'nothing was truncated, so this assertion would pass vacuously',
    ).toBeGreaterThan(0);

    // Predicting passages from opening lines gave three correct frames and
    // three missed arguments. A bare ellipsis lets the opening pass as the
    // whole; naming the omitted size does not restore it but stops that.
    for (const node of truncated) {
      expect(
        node.excerpt,
        `"${node.title}" was cut with no indication of how much is missing.`,
      ).toMatch(/\[\+\d+ chars\]/);
    }
  });
});
