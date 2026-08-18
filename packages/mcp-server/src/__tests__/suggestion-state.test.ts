import { describe, expect, it } from 'vitest';
import type { RolledNextMove } from '../next-move.js';
import {
  inferSuggestedStance,
  rememberSuggestedStances,
} from '../suggestion-state.js';

describe('suggested stance continuity', () => {
  it('recovers the stance of the concrete route when the model omits it', () => {
    rememberSuggestedStances('project-a', [
      {
        action: 'preserve',
        label: 'Preserve',
        stance: 'balanced',
        weight: 44,
        whyNow: 'Useful state may be transient.',
        steps: [],
      },
      {
        action: 'disrupt',
        label: 'Perturb the path',
        stance: 'disrupt',
        weight: 84,
        whyNow: 'Distant material may reveal another structure.',
        subjects: [
          { id: 'n_a', title: 'Dream' },
          { id: 'n_b', title: 'Maintenance fault' },
        ],
        steps: [],
      },
    ] satisfies RolledNextMove[]);

    expect(inferSuggestedStance('project-a', ['n_b', 'n_a', 'n_extra'])).toBe(
      'disrupt',
    );
    expect(inferSuggestedStance('project-a', ['n_unrelated'])).toBeUndefined();
  });
});
