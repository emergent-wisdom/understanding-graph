export const UNDERSTANDING_PROTOCOL_ID = 'fluid-understanding-v1';

export const UNDERSTANDING_PROTOCOL_MOVES = [
  'orient',
  'preserve',
  'search',
  'make',
  'test',
  'connect',
  'disrupt',
  'force-bisociation',
  're-enter',
  'reconsider',
  'pause',
] as const;

export const UNDERSTANDING_STANCES = [
  'balanced',
  'deepen',
  'resist',
  'connect',
  'disrupt',
  'revisit',
  'test',
] as const;

export type UnderstandingStance = (typeof UNDERSTANDING_STANCES)[number];

export type UnderstandingProtocolMove =
  (typeof UNDERSTANDING_PROTOCOL_MOVES)[number];

export type UnderstandingMoment = 'entered' | 'encountered' | 'committed';

export const UNDERSTANDING_PROTOCOL_LABEL =
  'UNDERSTANDING MODE — THE GRAPH IS THE MEDIUM';

export function understandingMode(
  moment: UnderstandingMoment,
  evidence: Record<string, unknown> = {},
) {
  return {
    protocol: UNDERSTANDING_PROTOCOL_ID,
    mode: 'understanding',
    medium: 'graph',
    mediumIntegrity: {
      artifact: 'graph-canonical',
      understanding: 'graph-canonical',
      chat: 'mirror-status-or-question',
    },
    moment,
    availableMoves: [...UNDERSTANDING_PROTOCOL_MOVES],
    process: 'agent-chosen',
    evidence,
  };
}
