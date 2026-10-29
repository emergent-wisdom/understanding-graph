import { describe, expect, it } from 'vitest';
import { describeDuplicateDetection } from './PracticeService.js';

/**
 * Duplicate-detection diagnostics must match the guard's actual conditions:
 * both a loaded model and stored embeddings are needed for comparison.
 * Synthetic coverage fixtures distinguish cold, empty, complete, and partial
 * states without relying on a model download or a private project store.
 */
const FULL = { total: 40, withEmbedding: 40, coverage: 1 };
const NONE = { total: 12, withEmbedding: 0, coverage: 0 };
const PARTIAL = { total: 30, withEmbedding: 12, coverage: 12 / 30 };
const EMPTY_GRAPH = { total: 0, withEmbedding: 0, coverage: 0 };

describe('duplicate detection reports what it can actually compare against', () => {
  it('still reports NOT RUNNING when the model is cold', () => {
    // A cold model cannot perform semantic duplicate detection.
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
        'comparing every new concept against an empty set.',
    ).not.toBe('active');
    expect(d.value).toContain('NOT RUNNING');
    // And it has to say why, since the remedy differs from the cold case.
    expect(d.reading).toContain('0 of 12');
    // The basis has to name BOTH conditions, since a reader judging the proxy
    // needs to know the model being loaded was never sufficient.
    expect(d.basis).toMatch(/loaded/i);
    expect(d.basis).toMatch(/embedding/i);
  });

  it('names the fraction when coverage is partial', () => {
    const d = describeDuplicateDetection(true, PARTIAL);

    // Warming the model does not backfill nodes written while it was cold.
    expect(d.value).not.toBe('active');
    expect(d.value).toContain('12 of 30');
    expect(
      d.reading,
      'The reading must identify nodes written while cold rather than assume ' +
        'that all uncovered nodes are the newest.',
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
        [0, 12],
        [1, 12],
        [12, 30],
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
