// Shared color definitions for node triggers
// Used in both graph visualization and stats display

// Hex colors for graph canvas (WebGL)
export const triggerColorsHex: Record<string, string> = {
  foundation: '#34d399',
  surprise: '#fb7185',
  tension: '#fb923c',
  consequence: '#fbbf24',
  repetition: '#2dd4bf',
  question: '#a5b4fc',
  serendipity: '#f0abfc',
  decision: '#f97316',
  experiment: '#86efac',
  analysis: '#a855f7',
  reference: '#60a5fa',
  library: '#d97706',
  randomness: '#06b6d4',
  thinking: '#a78bfa',
  prediction: '#38bdf8',
  evaluation: '#f472b6',
  hypothesis: '#818cf8',
  model: '#4ade80',
}

// Tailwind classes for UI components
export const triggerColorsTailwind: Record<string, string> = {
  foundation: 'bg-emerald-400',
  surprise: 'bg-rose-400',
  tension: 'bg-orange-400',
  consequence: 'bg-amber-400',
  repetition: 'bg-teal-400',
  question: 'bg-indigo-300',
  serendipity: 'bg-fuchsia-300',
  decision: 'bg-orange-500',
  experiment: 'bg-green-300',
  analysis: 'bg-purple-500',
  reference: 'bg-blue-400',
  library: 'bg-amber-600',
  randomness: 'bg-cyan-500',
  thinking: 'bg-violet-400',
  prediction: 'bg-sky-400',
  evaluation: 'bg-pink-400',
  hypothesis: 'bg-indigo-400',
  model: 'bg-green-400',
}

// Edge type colors
export const edgeColorsTailwind: Record<string, string> = {
  refines: 'bg-cyan-500',
  learned_from: 'bg-indigo-500',
  diverse_from: 'bg-rose-500',
  relates: 'bg-slate-500',
  contains: 'bg-teal-500',
  next: 'bg-gray-400',
  supersedes: 'bg-amber-500',
  answers: 'bg-green-500',
  contradicts: 'bg-red-500',
  contextualizes: 'bg-purple-500',
  questions: 'bg-pink-500',
  validates: 'bg-emerald-500',
}

// Agent colors
export const agentColorsTailwind: Record<string, string> = {
  source_reader: 'bg-green-500',
  synthesizer: 'bg-violet-500',
  connector: 'bg-sky-500',
  translator: 'bg-fuchsia-500',
  critic: 'bg-orange-500',
  skeptic: 'bg-red-400',
  curator: 'bg-teal-500',
  axiologist: 'bg-amber-500',
  belief_tracker: 'bg-indigo-500',
  psychologist: 'bg-pink-500',
  speculator: 'bg-cyan-500',
}

export const DEFAULT_COLOR_HEX = '#71717a'
export const DEFAULT_COLOR_TAILWIND = 'bg-zinc-500'

export function getTriggerColorHex(trigger: string | null): string {
  return triggerColorsHex[trigger || ''] || DEFAULT_COLOR_HEX
}

export function getTriggerColorTailwind(trigger: string | null): string {
  return triggerColorsTailwind[trigger || ''] || DEFAULT_COLOR_TAILWIND
}

export function getEdgeColorTailwind(type: string | null): string {
  return edgeColorsTailwind[type || ''] || DEFAULT_COLOR_TAILWIND
}

export function getAgentColorTailwind(agent: string | null): string {
  return agentColorsTailwind[agent || ''] || DEFAULT_COLOR_TAILWIND
}
