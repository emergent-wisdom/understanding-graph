import { describe, expect, it } from 'vitest';
import { BATCH_OPERATION_TOOLS } from '../tools/batch.js';
import { getToolDefinitions } from '../tools/index.js';

/**
 * Direct mutations belong inside graph_batch, which enforces grounding,
 * duplicate checks, mode boundaries, atomic rollback, and commit provenance.
 * Mode catalogs must not advertise a separate route around those invariants.
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
