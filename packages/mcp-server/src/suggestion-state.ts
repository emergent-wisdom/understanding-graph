import type { RolledNextMove } from './next-move.js';
import type { UnderstandingStance } from './protocol.js';

type SuggestedStance = {
  stance: UnderstandingStance;
  subjectIds: string[];
  weight: number;
};

const suggestedStances = new Map<string, SuggestedStance[]>();

export function rememberSuggestedStances(
  projectId: string,
  options: RolledNextMove[],
) {
  suggestedStances.set(
    projectId,
    options.map((option) => ({
      stance: option.stance,
      subjectIds: (option.subjects ?? []).map((subject) => subject.id).sort(),
      weight: option.weight,
    })),
  );
}

export function inferSuggestedStance(
  projectId: string,
  focusNodeIds: string[],
): UnderstandingStance | undefined {
  if (focusNodeIds.length === 0) return undefined;
  const focus = new Set(focusNodeIds);
  return suggestedStances
    .get(projectId)
    ?.filter(
      (option) =>
        option.subjectIds.length > 0 &&
        option.subjectIds.every((nodeId) => focus.has(nodeId)),
    )
    .sort(
      (a, b) =>
        b.subjectIds.length - a.subjectIds.length || b.weight - a.weight,
    )[0]?.stance;
}
