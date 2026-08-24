export const GUIDANCE_MODES = ['guided', 'direct'] as const;

export type GuidanceMode = (typeof GUIDANCE_MODES)[number];

/**
 * Resolve the suggestion preference for this server process/connection.
 *
 * This is deliberately process/connection scoped rather than graph scoped:
 * agents sharing one graph may want different amounts of navigational aid.
 */
export function guidanceModeFromEnv(
  env: Record<string, string | undefined>,
): GuidanceMode {
  const configured = (env.UG_GUIDANCE_MODE ?? 'guided').trim().toLowerCase();
  if (!GUIDANCE_MODES.includes(configured as GuidanceMode)) {
    throw new Error(
      `Invalid UG_GUIDANCE_MODE "${configured}". Choose one of: ${GUIDANCE_MODES.join(', ')}`,
    );
  }
  return configured as GuidanceMode;
}

export function ambientGuidanceEnabled(mode: GuidanceMode): boolean {
  return mode === 'guided';
}
