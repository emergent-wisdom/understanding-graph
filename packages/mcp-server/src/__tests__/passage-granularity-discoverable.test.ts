import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../tools/index.js';

/**
 * The cheap path to addressable prose has to be the one the author is already
 * looking at.
 *
 * Passages are meant to be independently revisable: doc_create_passages says
 * "use the smallest unit that may plausibly change independently". In the
 * Khepri dogfood, 31 of 31 prose leaves came out as multi-paragraph blocks
 * (median 173 words), so no beat could be revised without rewriting its
 * neighbours.
 *
 * That was never a comprehension failure. A model authoring prose could see
 * doc_create — one node per call — but not doc_create_passages, which is
 * batch-only. Its choices were N calls with N boundary decisions, or one cheap
 * call producing one coarse block, and it took the cheap one every time.
 * graph_batch's description named the bulk path the whole time, but an author
 * reached for the obvious name and never read graph_batch's text.
 *
 * These assertions were red for days against that topology, and what closed
 * them was an unrelated change. Every mutating document tool is now batch-only,
 * so doc_create cannot be reached for at all: graph_batch is the single
 * authoring door, and it is the door that names the fine-grained path. The
 * coarse route did not get more expensive — the reader stopped being able to
 * walk past the sign.
 *
 * So what is pinned here is the new topology, and both halves of it matter. If
 * a direct document mutator is ever re-advertised, authors get a starting point
 * that says nothing about granularity and the original defect returns. If
 * graph_batch stops naming the bulk path, the only remaining sign comes down.
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
