import { describe, expect, it } from 'vitest';
import { describeDuplicateDetection } from './PracticeService.js';

/**
 * The diagnostic has to test the same condition as the guard it describes.
 *
 * The real guard is `checkDuplicates` in the batch tool, which returns early
 * on `stats.withEmbedding === 0 || !EmbeddingService.isModelLoaded()`. The
 * diagnostic tested only the second half, so it reported `active` in a state
 * where the guard compares nothing and refuses nothing. A condition strictly
 * weaker than the one it reports on can only ever fail in this direction: it
 * says the check is working when it is not, never the reverse.
 *
 * Measured, not reasoned: this project's own meta graph held 48 nodes and 0
 * embeddings. Calling `graph_evaluate_variations` — which embeds arbitrary
 * text, and so loads the model without storing anything — flipped the
 * diagnostic to `active` while `checkDuplicates` was still returning an empty
 * warning list on entry.
 *
 * A first version of this test claimed the create path never embeds and that
 * `graph_backfill_embeddings` was the only producer. That was wrong, from a
 * grep too narrow to match `generateAndStoreEmbedding`: `batch.ts` embeds each
 * newly created node, guarded by `isModelLoaded()`, specifically so duplicate
 * detection works within the same batch. The consequence matters for the
 * readings below — an unembedded node is one written while the model was COLD,
 * which need not be a new one, so coverage does not decay while the model
 * stays warm.
 */
const FULL = { total: 40, withEmbedding: 40, coverage: 1 };
const NONE = { total: 48, withEmbedding: 0, coverage: 0 };
const PARTIAL = { total: 46, withEmbedding: 24, coverage: 24 / 46 };
const EMPTY_GRAPH = { total: 0, withEmbedding: 0, coverage: 0 };

describe('duplicate detection reports what it can actually compare against', () => {
  it('still reports NOT RUNNING when the model is cold', () => {
    // Unchanged behaviour, pinned: a cold model was always reported honestly.
    const d = describeDuplicateDetection(false, FULL);
    expect(d.value).toBe('NOT RUNNING');
    expect(d.reading).toContain('graph_backfill_embeddings');
  });

  it('reports plain active only when everything is embedded', () => {
    const d = describeDuplicateDetection(true, FULL);
    expect(d.value).toBe('active');
  });

  it('refuses to call itself active when nothing is embedded', () => {
    const d = describeDuplicateDetection(true, NONE);

    // The old code returned exactly 'active' here. Asserting merely that the
    // value "mentions" something would have passed before and after; the
    // assertion has to reject the old string outright.
    expect(
      d.value,
      'A warm model on a graph with no embeddings reported `active` while ' +
        'comparing every new concept against an empty set. Demonstrated live ' +
        'at 0 of 48 nodes.',
    ).not.toBe('active');
    expect(d.value).toContain('NOT RUNNING');
    // And it has to say why, since the remedy differs from the cold case.
    expect(d.reading).toContain('0 of 48');
    // The basis has to name BOTH conditions, since a reader judging the proxy
    // needs to know the model being loaded was never sufficient.
    expect(d.basis).toMatch(/loaded/i);
    expect(d.basis).toMatch(/embedding/i);
  });

  it('names the fraction when coverage is partial', () => {
    const d = describeDuplicateDetection(true, PARTIAL);

    // Partial coverage is what a session looks like after writing while cold
    // and then warming the model — the state this project was in.
    expect(d.value).not.toBe('active');
    expect(d.value).toContain('24 of 46');
    expect(
      d.reading,
      'The reading must say the uncovered nodes are the ones written cold. ' +
        'Calling them the newest was the earlier, wrong mechanism, and it ' +
        'points a reader at the wrong nodes.',
    ).toMatch(/cold/i);
    expect(d.reading).not.toMatch(/newest/i);
  });

  it('never claims to be running where the real guard returns early', () => {
    // The property the whole diagnostic exists to satisfy, stated once against
    // the guard's own condition rather than case by case. Written as a
    // transcription of `checkDuplicates`, so if that guard gains a third
    // condition this test keeps passing while the diagnostic silently drifts —
    // which is the same defect one level up, and worth saying out loud.
    const guardRunsCheck = (loaded: boolean, withEmbedding: number) =>
      withEmbedding !== 0 && loaded;

    for (const loaded of [true, false]) {
      for (const [withEmbedding, total] of [
        [0, 48],
        [1, 48],
        [24, 46],
        [40, 40],
      ]) {
        const d = describeDuplicateDetection(loaded, {
          total,
          withEmbedding,
          coverage: withEmbedding / total,
        });
        const claimsRunning = !d.value.includes('NOT RUNNING');
        expect(
          claimsRunning,
          `loaded=${loaded} withEmbedding=${withEmbedding}/${total}: the ` +
            `diagnostic said "${d.value}" while the guard would ` +
            `${guardRunsCheck(loaded, withEmbedding) ? 'run' : 'return early'}.`,
        ).toBe(guardRunsCheck(loaded, withEmbedding));
      }
    }
  });

  it('does not manufacture a problem on an empty graph', () => {
    // Nothing is unembedded because nothing exists. Reporting 0 of 0 as a
    // failure would train the reader to ignore this line.
    const d = describeDuplicateDetection(true, EMPTY_GRAPH);
    expect(d.value).toBe('active');
  });
});
