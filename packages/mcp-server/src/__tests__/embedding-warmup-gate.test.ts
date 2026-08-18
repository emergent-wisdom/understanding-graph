import { describe, expect, it } from 'vitest';
import { embeddingWarmupEnabled } from '../index.js';

/**
 * The gate on background model warmup.
 *
 * Warming at startup is what makes duplicate detection run by default — for
 * most of this tool's life nothing loaded the model, so sessions wrote whole
 * graphs unchecked while the batch's description asserted otherwise. The gate
 * is tested rather than the warmup itself: loading a real model in a unit test
 * is the same trade rejected everywhere else in this suite, and the warmup
 * body is a straight call to preloadModel with logging.
 *
 * The opt-out matters as much as the default. Embeddings are an optional peer
 * dependency, and the first-ever run downloads ~23 MB; DISABLE_EMBEDDING_WARMUP
 * is the documented way to keep the old lazy behaviour, so its spelling is
 * pinned here — an env var that silently stops working is an opt-out users
 * believe they have.
 */
describe('embedding warmup is on by default and declinable', () => {
  it('warms when nothing is set', () => {
    expect(embeddingWarmupEnabled({})).toBe(true);
  });

  it('respects DISABLE_EMBEDDING_WARMUP=1 and =true, however cased', () => {
    expect(embeddingWarmupEnabled({ DISABLE_EMBEDDING_WARMUP: '1' })).toBe(
      false,
    );
    expect(embeddingWarmupEnabled({ DISABLE_EMBEDDING_WARMUP: 'true' })).toBe(
      false,
    );
    expect(embeddingWarmupEnabled({ DISABLE_EMBEDDING_WARMUP: 'TRUE' })).toBe(
      false,
    );
    expect(embeddingWarmupEnabled({ DISABLE_EMBEDDING_WARMUP: ' 1 ' })).toBe(
      false,
    );
  });

  it('does not treat other values as an opt-out', () => {
    // '0', 'false', and empty mean the user did NOT decline. Anything that
    // half-matches silently disabling the default would be the familiar
    // failure: a guard off while believed on.
    expect(embeddingWarmupEnabled({ DISABLE_EMBEDDING_WARMUP: '0' })).toBe(
      true,
    );
    expect(embeddingWarmupEnabled({ DISABLE_EMBEDDING_WARMUP: 'false' })).toBe(
      true,
    );
    expect(embeddingWarmupEnabled({ DISABLE_EMBEDDING_WARMUP: '' })).toBe(true);
  });
});
