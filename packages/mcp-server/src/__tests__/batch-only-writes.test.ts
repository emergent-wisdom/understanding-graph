import { describe, expect, it } from 'vitest';
import { BATCH_OPERATION_TOOLS } from '../tools/batch.js';
import { getToolDefinitions } from '../tools/index.js';

/**
 * graph_batch is where the invariants live. It runs orphan prevention and its
 * post-execution sweep, duplicate detection, cross-mode checks, atomic
 * rollback, and it records the commit that gives every node and edge its
 * provenance.
 *
 * A mutation reachable outside the batch skips all of it. Measured on
 * doc_create called standalone: the node is written, `commit_id` is empty,
 * and no commit row exists — the work is in the graph with no record of why
 * it arrived or what it belonged to.
 *
 * So the rule is structural, not stylistic: if a tool can mutate the graph,
 * it belongs inside graph_batch and must not be separately advertised.
 * Advertising it is what makes it reachable, so that is what these tests
 * check.
 */
describe('only graph_batch may write', () => {
  const MODES = [
    'reading',
    'research',
    'coding',
    'collaborative_coding',
    'writing',
    'full',
  ];

  const mutationTools = new Set<string>(BATCH_OPERATION_TOOLS);

  for (const mode of MODES) {
    it(`${mode} mode advertises no mutation tool except graph_batch`, () => {
      const advertised = getToolDefinitions(mode).map((t) => t.name);
      const leaked = advertised.filter(
        (name) => name !== 'graph_batch' && mutationTools.has(name),
      );

      expect(
        leaked,
        `These mutation tools are callable outside graph_batch in "${mode}": ` +
          `${leaked.join(', ')}. Each one skips orphan prevention, duplicate ` +
          'detection, atomic rollback and commit provenance — a node created ' +
          'this way has an empty commit_id and no commit row. Keep them in ' +
          'BATCH_OPERATION_TOOLS and remove them from the advertised set.',
      ).toEqual([]);
    });
  }

  it('graph_batch itself is advertised wherever writing is possible', () => {
    // Guard against "fixing" the above by removing the batch too.
    for (const mode of ['writing', 'coding', 'full']) {
      const advertised = getToolDefinitions(mode).map((t) => t.name);
      expect(advertised, `${mode} cannot write at all`).toContain(
        'graph_batch',
      );
    }
  });

  it('the mutation vocabulary is non-empty', () => {
    // A trivially-passing suite if BATCH_OPERATION_TOOLS were ever emptied.
    expect(mutationTools.size).toBeGreaterThan(10);
  });
});
