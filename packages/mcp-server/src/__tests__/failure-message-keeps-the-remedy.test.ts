import { describe, expect, it } from 'vitest';
import { getExplicitToolFailure } from '../tools/batch.js';

/**
 * A batch refusal must preserve the nested tool's actionable remedy, including
 * referenced nodes and suggested calls. Test the composer directly so coverage
 * does not depend on loading the optional embedding model or reaching a
 * similarity threshold in an end-to-end fixture.
 */
describe('a refusal keeps the remedy the tool attached', () => {
  it('returns null for anything that is not an explicit failure', () => {
    expect(getExplicitToolFailure({ success: true, id: 'n_1' })).toBeNull();
    expect(getExplicitToolFailure({ id: 'n_1' })).toBeNull();
    expect(getExplicitToolFailure('not an object')).toBeNull();
    expect(getExplicitToolFailure(null)).toBeNull();
  });

  it('reads exactly as before when there is nothing but a message', () => {
    // Most refusals carry no extras and must not gain a trailing artefact.
    expect(
      getExplicitToolFailure({ success: false, error: 'EDGE_TYPE_REQUIRED' }),
    ).toBe('EDGE_TYPE_REQUIRED');
    expect(
      getExplicitToolFailure({
        success: false,
        error: 'INVALID_TRIGGER',
        message: 'Invalid trigger "validation".',
      }),
    ).toBe('INVALID_TRIGGER: Invalid trigger "validation".');
  });

  it('carries the hint through', () => {
    const composed = getExplicitToolFailure({
      success: false,
      error: 'Target node "A grounding concept" not found.',
      hint: 'targetNodeIds takes node IDs (n_…), not titles.',
    });
    expect(composed).toContain('not found');
    expect(composed).toContain('node IDs');
  });

  it('names which node a near-duplicate refusal is pointing at', () => {
    const composed = getExplicitToolFailure({
      success: false,
      blocked: true,
      reason: 'NEAR_DUPLICATE',
      message:
        'Found near-duplicate concept with 87% similarity. Extend or link to existing concept instead of creating new.',
      existingConcept: {
        id: 'n_58c053b9',
        name: 'Advising fails and refusing works',
        similarity: 0.87,
      },
      suggestions: [
        'Use graph_revise to update "Advising fails and refusing works" (n_58c053b9)',
        'Set skipDuplicateCheck=true if you are certain this is genuinely different',
      ],
    });

    // The diagnosis was always delivered.
    expect(composed).toContain('near-duplicate');
    // The identity of the thing to link to was not — which made the
    // instruction unfollowable without a separate search.
    expect(
      composed,
      'The refusal told the agent to link to an existing concept without ' +
        'naming it. The id and title are in the payload and were dropped.',
    ).toContain('n_58c053b9');
    expect(composed).toContain('Advising fails and refusing works');
    // And the escape hatch, which is the only way past a false positive.
    expect(composed).toContain('skipDuplicateCheck');
  });

  it('ignores malformed extras rather than emitting undefined', () => {
    const composed = getExplicitToolFailure({
      success: false,
      message: 'Something went wrong.',
      existingConcept: { name: 'no id here' },
      suggestions: [42, null, 'a usable one'],
    });
    expect(composed).toContain('Something went wrong.');
    expect(composed).toContain('a usable one');
    expect(composed).not.toContain('undefined');
    expect(composed).not.toContain('null');
  });
});
