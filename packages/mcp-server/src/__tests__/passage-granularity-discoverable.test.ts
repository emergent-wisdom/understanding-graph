import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../tools/index.js';

/**
 * Atomic authoring must make addressable passage creation discoverable. Document
 * mutations are batch-only, and the graph_batch contract must name the bulk
 * passage tool so authors can create independently revisable prose units.
 */
describe('the cheap path to addressable prose is discoverable', () => {
  const BULK = 'doc_create_passages';
  const AUTHORING_MODES = ['writing', 'full'];

  for (const mode of AUTHORING_MODES) {
    it(`${mode} mode routes authoring through a door that names ${BULK}`, () => {
      const tools = getToolDefinitions(mode);
      if (tools.some((t) => t.name === BULK)) return; // advertised outright

      const batch = tools.find((t) => t.name === 'graph_batch');
      expect(
        batch,
        `"${mode}" advertises no graph_batch, so there is no authoring door at all.`,
      ).toBeDefined();

      expect(
        batch?.description ?? '',
        `In "${mode}", graph_batch is the only authoring entry point and its ` +
          `description no longer names ${BULK}. The fine-grained path is then ` +
          'invisible from where every author starts, and the cheapest ' +
          'available route yields one coarse block per call.',
      ).toContain(BULK);
    });

    it(`${mode} mode advertises no direct document mutator to reach for instead`, () => {
      // The original defect was an author reaching for the obvious name. It
      // returns the moment any direct mutator is advertised beside the batch,
      // because that tool becomes the starting point and says nothing about
      // granularity.
      const advertised = getToolDefinitions(mode).map((t) => t.name);
      const directMutators = [
        'doc_create',
        'doc_weave',
        'doc_revise',
        'doc_merge',
      ].filter((name) => advertised.includes(name));

      expect(
        directMutators,
        `"${mode}" advertises ${directMutators.join(', ')} alongside ` +
          'graph_batch. An author reaches for the obvious name, never reads ' +
          "graph_batch's text, and the coarse path wins on cost again.",
      ).toEqual([]);
    });
  }

  it('writing mode can still create prose at all', () => {
    // Guard against "fixing" the above by removing authoring entirely.
    const names = getToolDefinitions('writing').map((t) => t.name);
    expect(names).toContain('graph_batch');
    expect(names.some((n) => n.startsWith('doc_'))).toBe(true);
  });
});
