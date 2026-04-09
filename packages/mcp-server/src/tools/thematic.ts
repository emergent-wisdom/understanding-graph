/**
 * Thematic System MCP Tools
 *
 * Tools for purposeful idea transmission in narratives.
 * Themes are ideas with scope, activation zones, and landing points.
 */

import { getGraphStore } from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';

// ============================================================================
// Types
// ============================================================================

type ThemeScope = 'story' | 'arc' | 'scene' | 'moment';
type ExpressionMode =
  | 'dialogue'
  | 'action'
  | 'image'
  | 'reflection'
  | 'silence';

interface IntensityPoint {
  position: number; // 0.0 to 1.0 through activation zone
  intensity: number; // 0.0 to 1.0 how strongly idea should be present
}

interface ActivationZone {
  startId: string; // Node ID where idea becomes active
  peakId: string; // Node ID where idea lands (pause point)
  endId?: string; // Node ID where idea completes
  intensityCurve: IntensityPoint[];
}

interface ThematicMetadata {
  type: 'theme';
  scope: ThemeScope;
  idea: string;
  purpose: string;
  activationZone: ActivationZone;
  expressionModes: ExpressionMode[];
  requiredSetup: string[];
  conflictsWith: string[];
  isActive: boolean;
  currentIntensity: number;
  hasLanded: boolean;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Constants
// ============================================================================

const THEMATIC_METADATA_KEY = 'thematic-system';

const DENSITY_LIMITS: Record<ThemeScope, number> = {
  story: 3,
  arc: 7,
  scene: 2,
  moment: 1,
};

const DEFAULT_CURVES: Record<ThemeScope, IntensityPoint[]> = {
  story: [
    { position: 0.0, intensity: 0.2 },
    { position: 0.3, intensity: 0.4 },
    { position: 0.7, intensity: 0.6 },
    { position: 0.9, intensity: 1.0 },
    { position: 1.0, intensity: 0.5 },
  ],
  arc: [
    { position: 0.0, intensity: 0.3 },
    { position: 0.5, intensity: 0.6 },
    { position: 0.8, intensity: 1.0 },
    { position: 1.0, intensity: 0.2 },
  ],
  scene: [
    { position: 0.0, intensity: 0.4 },
    { position: 0.6, intensity: 0.8 },
    { position: 0.8, intensity: 1.0 },
    { position: 1.0, intensity: 0.3 },
  ],
  moment: [
    { position: 0.0, intensity: 0.5 },
    { position: 0.5, intensity: 1.0 },
    { position: 1.0, intensity: 0.2 },
  ],
};

const DEFAULT_EXPRESSION_MODES: ExpressionMode[] = [
  'dialogue',
  'action',
  'reflection',
];

// ============================================================================
// Tool Definitions
// ============================================================================

export const thematicTools: Tool[] = [
  {
    name: 'theme_create',
    description:
      'Create a theme node defining an idea to transmit through the narrative. Themes have scope (story/arc/scene/moment), activation zones (where they become active), and landing points (pause moments where ideas land).',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Theme name (e.g., "Redemption through acceptance")',
        },
        scope: {
          type: 'string',
          enum: ['story', 'arc', 'scene', 'moment'],
          description:
            'Scope level: story (1-3 max), arc (1-7 max), scene (1-2 active), moment (1 landing)',
        },
        idea: {
          type: 'string',
          description:
            'The actual idea to transmit to the reader (e.g., "Power corrupts those who seek it for protection")',
        },
        purpose: {
          type: 'string',
          description:
            'WHY this idea matters to the reader - what should they feel/understand?',
        },
        activationZone: {
          type: 'object',
          description: 'Where the idea becomes active and lands',
          properties: {
            startId: {
              type: 'string',
              description: 'Node ID where idea becomes active',
            },
            peakId: {
              type: 'string',
              description: 'Node ID where idea lands (the pause point)',
            },
            endId: {
              type: 'string',
              description:
                'Node ID where idea completes (optional for story-scope)',
            },
          },
          required: ['startId', 'peakId'],
        },
        expressionModes: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['dialogue', 'action', 'image', 'reflection', 'silence'],
          },
          description:
            'How the idea can manifest. Default: dialogue, action, reflection',
        },
        requiredSetup: {
          type: 'array',
          items: { type: 'string' },
          description: 'What must be established before the idea can land',
        },
        conflictsWith: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Theme IDs that should not be active simultaneously (cognitive competition)',
        },
      },
      required: ['name', 'scope', 'idea', 'purpose', 'activationZone'],
    },
  },
  {
    name: 'theme_activate',
    description:
      'Mark a theme as entering its activation zone. Call when narrative reaches the startId. Returns density check and active theme list.',
    inputSchema: {
      type: 'object',
      properties: {
        themeId: {
          type: 'string',
          description: 'Theme node ID to activate',
        },
        narrativePosition: {
          type: 'number',
          description:
            'Current position through activation zone (0.0-1.0) for intensity calculation. Default 0.0',
        },
      },
      required: ['themeId'],
    },
  },
  {
    name: 'theme_landing',
    description:
      'Mark a pause point where an idea lands. Call at peakId. This signals the narrative should slow down to let the idea sink in.',
    inputSchema: {
      type: 'object',
      properties: {
        themeId: {
          type: 'string',
          description: 'Theme node ID that is landing',
        },
        landingQuality: {
          type: 'number',
          description: 'Self-assessment 0-1 of how well the idea landed',
        },
        landingNotes: {
          type: 'string',
          description: 'How the idea was expressed in the landing moment',
        },
      },
      required: ['themeId'],
    },
  },
  {
    name: 'theme_get_active',
    description:
      'Get all currently active themes and their intensities. Use before generating prose to know what ideas should be expressed.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['story', 'arc', 'scene', 'moment'],
          description: 'Filter by scope (optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'theme_check_alignment',
    description:
      'Validate if prose aligns with active themes. Call after generating significant prose to ensure ideas are being transmitted.',
    inputSchema: {
      type: 'object',
      properties: {
        prose: {
          type: 'string',
          description: 'The text to check for theme alignment',
        },
        sceneId: {
          type: 'string',
          description: 'Current scene context (optional)',
        },
      },
      required: ['prose'],
    },
  },
  {
    name: 'theme_deactivate',
    description:
      'Mark a theme as leaving its activation zone. Call at endId or when theme is complete.',
    inputSchema: {
      type: 'object',
      properties: {
        themeId: {
          type: 'string',
          description: 'Theme node ID to deactivate',
        },
        reason: {
          type: 'string',
          enum: ['completed', 'transformed', 'deferred'],
          description:
            'Why deactivating: completed normally, transformed into another theme, or deferred for later',
        },
      },
      required: ['themeId'],
    },
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

function getThematicMetadata(nodeId: string): ThematicMetadata | null {
  const store = getGraphStore();
  const metadata = store.getMetadataKey(nodeId, THEMATIC_METADATA_KEY);
  if (
    metadata &&
    typeof metadata === 'object' &&
    'type' in metadata &&
    (metadata as ThematicMetadata).type === 'theme'
  ) {
    return metadata as ThematicMetadata;
  }
  return null;
}

function getAllThemes(): Array<{
  id: string;
  name: string;
  metadata: ThematicMetadata;
}> {
  const store = getGraphStore();
  const { nodes: allNodes } = store.getAll();
  const themes: Array<{
    id: string;
    name: string;
    metadata: ThematicMetadata;
  }> = [];

  for (const node of allNodes) {
    const metadata = getThematicMetadata(node.id);
    if (metadata) {
      themes.push({ id: node.id, name: node.title, metadata });
    }
  }

  return themes;
}

function getActiveThemes(scopeFilter?: ThemeScope): Array<{
  id: string;
  name: string;
  metadata: ThematicMetadata;
}> {
  const themes = getAllThemes();
  return themes.filter((t) => {
    if (!t.metadata.isActive) return false;
    if (scopeFilter && t.metadata.scope !== scopeFilter) return false;
    return true;
  });
}

function getDensityStatus(): {
  counts: Record<ThemeScope, number>;
  limits: Record<ThemeScope, number>;
  withinLimits: boolean;
} {
  const activeThemes = getActiveThemes();
  const counts: Record<ThemeScope, number> = {
    story: 0,
    arc: 0,
    scene: 0,
    moment: 0,
  };

  for (const theme of activeThemes) {
    counts[theme.metadata.scope]++;
  }

  const withinLimits = Object.entries(counts).every(
    ([scope, count]) => count <= DENSITY_LIMITS[scope as ThemeScope],
  );

  return { counts, limits: DENSITY_LIMITS, withinLimits };
}

function interpolateIntensity(
  curve: IntensityPoint[],
  position: number,
): number {
  if (position <= 0) return curve[0]?.intensity ?? 0;
  if (position >= 1) return curve[curve.length - 1]?.intensity ?? 0;

  // Find surrounding points
  let lower = curve[0];
  let upper = curve[curve.length - 1];

  for (let i = 0; i < curve.length - 1; i++) {
    if (curve[i].position <= position && curve[i + 1].position >= position) {
      lower = curve[i];
      upper = curve[i + 1];
      break;
    }
  }

  // Linear interpolation
  const range = upper.position - lower.position;
  if (range === 0) return lower.intensity;
  const t = (position - lower.position) / range;
  return lower.intensity + t * (upper.intensity - lower.intensity);
}

function checkProseAlignment(
  prose: string,
  activeThemes: Array<{ id: string; name: string; metadata: ThematicMetadata }>,
): {
  alignmentScore: number;
  themeAlignments: Array<{
    id: string;
    name: string;
    targetIntensity: number;
    expressedIntensity: number;
    aligned: boolean;
    suggestions?: string;
  }>;
  issues: {
    missingThemes: string[];
    competingIdeas: string[];
    densityViolation: boolean;
  };
} {
  const proseWords = prose.toLowerCase().split(/\s+/);
  const themeAlignments: Array<{
    id: string;
    name: string;
    targetIntensity: number;
    expressedIntensity: number;
    aligned: boolean;
    suggestions?: string;
  }> = [];
  const missingThemes: string[] = [];

  for (const theme of activeThemes) {
    // Basic keyword matching for alignment check
    // In production, this could use embeddings for semantic similarity
    const ideaWords = theme.metadata.idea.toLowerCase().split(/\s+/);
    const nameWords = theme.name.toLowerCase().split(/\s+/);
    const keywords = [...new Set([...ideaWords, ...nameWords])].filter(
      (w) => w.length > 3,
    );

    let matchCount = 0;
    for (const keyword of keywords) {
      if (proseWords.some((w) => w.includes(keyword) || keyword.includes(w))) {
        matchCount++;
      }
    }

    const expressedIntensity =
      keywords.length > 0
        ? Math.min(1, matchCount / (keywords.length * 0.5))
        : 0;
    const targetIntensity = theme.metadata.currentIntensity;
    const aligned = expressedIntensity >= targetIntensity * 0.6;

    themeAlignments.push({
      id: theme.id,
      name: theme.name,
      targetIntensity,
      expressedIntensity: Math.round(expressedIntensity * 100) / 100,
      aligned,
      suggestions: aligned
        ? undefined
        : `Consider expressing "${theme.metadata.idea}" more explicitly through ${theme.metadata.expressionModes.join(' or ')}`,
    });

    if (!aligned && targetIntensity > 0.3) {
      missingThemes.push(theme.name);
    }
  }

  const density = getDensityStatus();
  const alignedCount = themeAlignments.filter((t) => t.aligned).length;
  const alignmentScore =
    themeAlignments.length > 0 ? alignedCount / themeAlignments.length : 1;

  return {
    alignmentScore: Math.round(alignmentScore * 100) / 100,
    themeAlignments,
    issues: {
      missingThemes,
      competingIdeas: [], // Would require inactive theme detection
      densityViolation: !density.withinLimits,
    },
  };
}

// ============================================================================
// Tool Handlers
// ============================================================================

export async function handleThematicTools(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  const projectId =
    (args.project as string) || contextManager.getCurrentProjectId();
  const conversationId =
    await contextManager.getCurrentConversationId(projectId);
  const toolCallId = contextManager.getCurrentToolCall();

  switch (name) {
    case 'theme_create': {
      const store = getGraphStore();
      const themeName = args.name as string;
      const scope = args.scope as ThemeScope;
      const idea = args.idea as string;
      const purpose = args.purpose as string;
      const activationZone = args.activationZone as {
        startId: string;
        peakId: string;
        endId?: string;
      };
      const expressionModes =
        (args.expressionModes as ExpressionMode[]) || DEFAULT_EXPRESSION_MODES;
      const requiredSetup = (args.requiredSetup as string[]) || [];
      const conflictsWith = (args.conflictsWith as string[]) || [];

      // Check density limits before creating
      const density = getDensityStatus();

      // Create the theme node
      const now = Date.now();

      const thematicMetadata: ThematicMetadata = {
        type: 'theme',
        scope,
        idea,
        purpose,
        activationZone: {
          startId: activationZone.startId,
          peakId: activationZone.peakId,
          endId: activationZone.endId,
          intensityCurve: DEFAULT_CURVES[scope],
        },
        expressionModes,
        requiredSetup,
        conflictsWith,
        isActive: false,
        currentIntensity: 0,
        hasLanded: false,
        createdAt: now,
        updatedAt: now,
      };

      // Create node with understanding text
      const node = store.createNode({
        title: themeName,
        understanding: `THEME (${scope}): "${idea}"\n\nPurpose: ${purpose}\n\nExpression modes: ${expressionModes.join(', ')}\nActivation: ${activationZone.startId} → ${activationZone.peakId}${activationZone.endId ? ` → ${activationZone.endId}` : ''}`,
        trigger: 'foundation',
        why: `Theme node for purposeful idea transmission: ${purpose}`,
        conversationId,
        toolCallId: toolCallId ?? undefined,
        metadata: {
          [THEMATIC_METADATA_KEY]: thematicMetadata,
        },
      });

      // Log event
      contextManager.logEvent(
        'created',
        'node',
        node.id,
        `Created theme: ${themeName}`,
        {
          scope,
          idea,
        },
      );

      const densityWarning =
        density.counts[scope] >= density.limits[scope] - 1
          ? `Warning: Creating one more ${scope}-scope theme will exceed the density limit (${density.limits[scope]})`
          : undefined;

      return {
        success: true,
        id: node.id,
        name: node.title,
        scope,
        isActive: false,
        message: `Created theme "${themeName}" (${scope}-scope)`,
        _operatorReminder: {
          law: 'T1: THEME FIRST',
          instruction: `Theme created but NOT active. Call theme_activate when narrative reaches node ${activationZone.startId}. The idea "${idea}" should be subtly prepared before activation.`,
          densityWarning,
        },
      };
    }

    case 'theme_activate': {
      const store = getGraphStore();
      const themeId = args.themeId as string;
      const position = (args.narrativePosition as number) ?? 0;

      const metadata = getThematicMetadata(themeId);
      if (!metadata) {
        throw new Error(`Theme not found: ${themeId}`);
      }

      // Calculate current intensity
      const currentIntensity = interpolateIntensity(
        metadata.activationZone.intensityCurve,
        position,
      );

      // Check for conflicts
      const activeThemes = getActiveThemes();
      const conflicts = activeThemes.filter((t) =>
        metadata.conflictsWith.includes(t.id),
      );

      // Update metadata
      const updatedMetadata: ThematicMetadata = {
        ...metadata,
        isActive: true,
        currentIntensity,
        updatedAt: Date.now(),
      };

      store.setMetadata(themeId, { [THEMATIC_METADATA_KEY]: updatedMetadata });

      const node = store.getNode(themeId);
      const density = getDensityStatus();

      contextManager.logEvent('revised', 'node', themeId, `Activated theme`, {
        intensity: currentIntensity,
      });

      return {
        success: true,
        themeId,
        themeName: node?.title ?? 'Unknown',
        currentIntensity: Math.round(currentIntensity * 100) / 100,
        activeThemes: getActiveThemes().map((t) => ({
          id: t.id,
          name: t.name,
          scope: t.metadata.scope,
          intensity: Math.round(t.metadata.currentIntensity * 100) / 100,
        })),
        densityCheck: {
          withinLimits: density.withinLimits,
          counts: density.counts,
          limits: density.limits,
        },
        _operatorReminder: {
          law: 'T2: ACTIVATION AWARENESS',
          activeIdeas: getActiveThemes().map(
            (t) => `${t.name} (${t.metadata.scope}): "${t.metadata.idea}"`,
          ),
          instruction: `Theme "${node?.title}" now active at intensity ${Math.round(currentIntensity * 100)}%. Your prose MUST express this idea through: ${metadata.expressionModes.join(', ')}`,
          warning: !density.withinLimits
            ? `DENSITY LIMIT EXCEEDED: ${JSON.stringify(density.counts)} vs limits ${JSON.stringify(density.limits)}`
            : conflicts.length > 0
              ? `CONFLICTING THEMES: ${conflicts.map((c) => c.name).join(', ')} - cognitive competition may confuse reader`
              : undefined,
        },
      };
    }

    case 'theme_landing': {
      const store = getGraphStore();
      const themeId = args.themeId as string;
      const landingQuality = args.landingQuality as number | undefined;
      const landingNotes = args.landingNotes as string | undefined;

      const metadata = getThematicMetadata(themeId);
      if (!metadata) {
        throw new Error(`Theme not found: ${themeId}`);
      }

      // Update metadata
      const updatedMetadata: ThematicMetadata = {
        ...metadata,
        hasLanded: true,
        currentIntensity: 1.0, // Peak at landing
        updatedAt: Date.now(),
      };

      store.setMetadata(themeId, { [THEMATIC_METADATA_KEY]: updatedMetadata });

      const node = store.getNode(themeId);

      // Update understanding with landing notes
      if (landingNotes) {
        const currentUnderstanding = node?.understanding ?? '';
        store.updateNode(themeId, {
          understanding: `${currentUnderstanding}\n\n---\nLanding (quality: ${landingQuality ?? 'unrated'}): ${landingNotes}`,
        });
      }

      contextManager.logEvent('revised', 'node', themeId, `Theme landed`, {
        quality: landingQuality,
      });

      const remaining = getActiveThemes().filter((t) => !t.metadata.hasLanded);

      return {
        success: true,
        themeId,
        themeName: node?.title ?? 'Unknown',
        hasLanded: true,
        message: `Theme "${node?.title}" has landed. The idea should now resonate with the reader.`,
        remainingActiveThemes: remaining.map((t) => ({
          id: t.id,
          name: t.name,
          scope: t.metadata.scope,
        })),
        _operatorReminder: {
          law: 'T4: LANDING REQUIRED',
          instruction:
            'This idea has landed. Create SPACE for it - slow the pacing, allow reflection. The reader needs a moment to absorb.',
          nextStep: metadata.activationZone.endId
            ? `Continue until endId (${metadata.activationZone.endId}), then call theme_deactivate`
            : 'Call theme_deactivate when ready to close this theme',
        },
      };
    }

    case 'theme_get_active': {
      const scope = args.scope as ThemeScope | undefined;
      const activeThemes = getActiveThemes(scope);
      const density = getDensityStatus();

      return {
        activeThemes: activeThemes.map((t) => ({
          id: t.id,
          name: t.name,
          scope: t.metadata.scope,
          idea: t.metadata.idea,
          currentIntensity: Math.round(t.metadata.currentIntensity * 100) / 100,
          expressionModes: t.metadata.expressionModes,
          peakId: t.metadata.activationZone.peakId,
          hasLanded: t.metadata.hasLanded,
        })),
        densityStatus: {
          counts: density.counts,
          limits: density.limits,
          withinLimits: density.withinLimits,
        },
        _operatorReminder: {
          law: 'T3: DENSITY RESPECT',
          currentLoad: `Active themes: ${activeThemes.length} (${Object.entries(
            density.counts,
          )
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${k}:${v}`)
            .join(', ')})`,
          instruction:
            activeThemes.length === 0
              ? 'No active themes. Consider activating a theme before generating prose.'
              : `Express these ideas: ${activeThemes.map((t) => `"${t.metadata.idea}" via ${t.metadata.expressionModes.join('/')}`).join('; ')}`,
        },
      };
    }

    case 'theme_check_alignment': {
      const prose = args.prose as string;
      const activeThemes = getActiveThemes();

      if (activeThemes.length === 0) {
        return {
          alignmentScore: 1,
          activeThemes: [],
          issues: {
            missingThemes: [],
            competingIdeas: [],
            densityViolation: false,
          },
          _operatorReminder: {
            instruction:
              'No active themes to check alignment against. If this story should transmit ideas, define and activate themes first.',
          },
        };
      }

      const alignment = checkProseAlignment(prose, activeThemes);

      return {
        alignmentScore: alignment.alignmentScore,
        activeThemes: alignment.themeAlignments,
        issues: alignment.issues,
        _operatorReminder: {
          instruction:
            alignment.alignmentScore < 0.7
              ? `LOW ALIGNMENT (${Math.round(alignment.alignmentScore * 100)}%): Prose does not sufficiently express active themes. Revise to include: ${alignment.issues.missingThemes.join(', ')}`
              : alignment.alignmentScore < 0.9
                ? `MODERATE ALIGNMENT (${Math.round(alignment.alignmentScore * 100)}%): Some themes underexpressed. Consider strengthening: ${alignment.themeAlignments
                    .filter((t) => !t.aligned)
                    .map((t) => t.name)
                    .join(', ')}`
                : `GOOD ALIGNMENT (${Math.round(alignment.alignmentScore * 100)}%): Prose expresses active themes well.`,
          requiredFixes:
            alignment.issues.missingThemes.length > 0
              ? alignment.themeAlignments
                  .filter((t) => !t.aligned && t.suggestions)
                  .map((t) => t.suggestions as string)
              : undefined,
        },
      };
    }

    case 'theme_deactivate': {
      const store = getGraphStore();
      const themeId = args.themeId as string;
      const reason =
        (args.reason as 'completed' | 'transformed' | 'deferred') ??
        'completed';

      const metadata = getThematicMetadata(themeId);
      if (!metadata) {
        throw new Error(`Theme not found: ${themeId}`);
      }

      if (!metadata.hasLanded && reason === 'completed') {
        return {
          success: false,
          message: `Theme has not landed yet. Call theme_landing first, or use reason='deferred' if intentionally skipping.`,
          _operatorReminder: {
            law: 'T4: LANDING REQUIRED',
            instruction:
              'Every activated theme MUST reach its landing point. Either land this theme or explicitly mark as deferred.',
          },
        };
      }

      // Update metadata
      const updatedMetadata: ThematicMetadata = {
        ...metadata,
        isActive: false,
        currentIntensity: 0,
        updatedAt: Date.now(),
      };

      store.setMetadata(themeId, { [THEMATIC_METADATA_KEY]: updatedMetadata });

      const node = store.getNode(themeId);

      contextManager.logEvent(
        'revised',
        'node',
        themeId,
        `Theme deactivated: ${reason}`,
      );

      return {
        success: true,
        themeId,
        themeName: node?.title ?? 'Unknown',
        reason,
        message: `Theme "${node?.title}" deactivated (${reason})`,
      };
    }

    default:
      throw new Error(`Unknown thematic tool: ${name}`);
  }
}
