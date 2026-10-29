import { describe, expect, it } from 'vitest';
import { embeddingWarmupEnabled } from '../index.js';

/**
 * Background embedding warmup is enabled by default and explicitly declinable.
 * Test the configuration gate without downloading or loading the optional
 * model. The documented environment variable must preserve the opt-out.
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
