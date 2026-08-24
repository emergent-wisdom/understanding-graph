import {
  sqlite,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';
// Import tool handlers
import { batchTools, handleBatchTools } from './batch.js';
import { conceptTools, handleConceptTools } from './concept.js';
import { handleConnectionTools } from './connection.js';
import {
  BATCH_ONLY_DOCUMENT_TOOLS,
  documentTools,
  handleDocumentTools,
} from './document.js';
import { handleReflectionTools, reflectionTools } from './reflection.js';
import { handleSolverTools, solverTools } from './solvers.js';
import { handleSourceTools, sourceTools } from './source.js';
import { handleSynthesisTools, synthesisTools } from './synthesis.js';
import { handleThematicTools } from './thematic.js';
import { handleUnderstandingTools, understandingTools } from './understand.js';

// Tool exposure modes. Keep the runtime list and TypeScript union together so
// startup validation, tool listing, and call enforcement cannot drift apart.
export const TOOL_MODES = [
  'general',
  'reading',
  'research',
  'coding',
  'collaborative_coding',
  'writing',
  'full',
  'synthetic_reader',
] as const;
export type ToolMode = (typeof TOOL_MODES)[number];

// These tools operate on reserved synthetic Reader/CMP pretraining blocks.
// Only synthetic_reader may access or mutate the blocks; ordinary modes use a
// graph projection that excludes them and all incident relations.
export const SYNTHETIC_THINKING_TOOLS = [
  'doc_insert_thinking',
  'doc_append_thinking',
  'doc_sign_thinking',
  'doc_get_unsigned_thinking',
  'translate_thinking',
] as const;
const syntheticThinkingToolNames = new Set<string>(SYNTHETIC_THINKING_TOOLS);
const batchOnlyDocumentToolNames = new Set<string>(BATCH_ONLY_DOCUMENT_TOOLS);
const batchOnlyConceptToolNames = new Set(['graph_note']);
const conceptToolNames = new Set(conceptTools.map((tool) => tool.name));

function isThinkingLabel(value: unknown): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === 'thinking';
}

function reflectionToolsForMode(mode: ToolMode): Tool[] {
  if (mode === 'synthetic_reader') return reflectionTools;

  return reflectionTools.map((tool) => {
    if (tool.name !== 'graph_find_by_trigger') return tool;

    const inputSchema = structuredClone(tool.inputSchema);
    const trigger = inputSchema.properties?.trigger as
      | { description?: string; enum?: unknown[] }
      | undefined;
    if (trigger?.enum) {
      trigger.enum = trigger.enum.filter((value) => value !== 'thinking');
      trigger.description =
        'Ordinary authored trigger type to search for. Reserved Reader/CMP thinking blocks are visible only in synthetic_reader mode.';
    }

    return { ...tool, inputSchema };
  });
}

function createsThinkingNode(
  name: string,
  args: Record<string, unknown>,
): boolean {
  if (syntheticThinkingToolNames.has(name)) return true;

  if (
    [
      'graph_add_concept',
      'doc_create',
      'doc_to_concept',
      'node_set_trigger',
    ].includes(name) &&
    isThinkingLabel(args.trigger)
  ) {
    return true;
  }

  if (name === 'doc_create' && isThinkingLabel(args.fileType)) return true;

  if (name === 'graph_batch') {
    const operations = args.operations;
    return (
      Array.isArray(operations) &&
      operations.some((operation) => {
        if (!operation || typeof operation !== 'object') return false;
        const candidate = operation as {
          tool?: unknown;
          params?: unknown;
        };
        if (typeof candidate.tool !== 'string') return false;
        const params =
          candidate.params && typeof candidate.params === 'object'
            ? (candidate.params as Record<string, unknown>)
            : {};
        return createsThinkingNode(candidate.tool, params);
      })
    );
  }

  return false;
}

function assertSyntheticThinkingAccess(
  name: string,
  args: Record<string, unknown>,
  mode: ToolMode,
): void {
  if (mode === 'synthetic_reader' || !createsThinkingNode(name, args)) return;

  throw new Error(
    `Tool call rejected in TOOL_MODE "${mode}": synthetic Reader/CMP thinking blocks can only be created, signed, or translated in TOOL_MODE "synthetic_reader". ` +
      'Use rich non-thinking typed testimony for ordinary work.',
  );
}

// Get tool definitions based on mode
// ARCHITECTURE: All mutations go through graph_batch (enforces commit messages).
export function getToolDefinitions(mode: ToolMode = 'general'): Tool[] {
  const visibleReflectionTools = reflectionToolsForMode(mode);

  // Exploration is read-only at the top level. Synthesis mutations are exact
  // graph_batch operations so their nodes, edges, and provenance land atomically.
  const explorationTools = synthesisTools.filter((t) =>
    [
      'graph_discover',
      'graph_discover_grounded',
      'graph_discover_grounded_chaos',
      'graph_random',
      'graph_chaos',
      'graph_evaluate_variations',
    ].includes(t.name),
  );
  // Ordinary workflows can compare a grounded random sample or inspect a raw
  // random sample. Keep the more disruptive chaos pipeline on local full mode.
  const groundedDiscoveryTools = explorationTools.filter(
    (tool) =>
      tool.name === 'graph_discover_grounded' || tool.name === 'graph_random',
  );

  // Small reflection surface shared by focused workflows.
  const coreReflection = visibleReflectionTools.filter((t) =>
    [
      'graph_skeleton',
      'graph_analyze',
      'graph_semantic_gaps',
      'graph_score',
      'graph_practice',
      'graph_semantic_search',
      'graph_similar',
      'graph_find_by_trigger',
      'graph_context',
      'graph_context_region',
      'graph_path',
      'graph_updates',
      'graph_history',
      'project_switch',
      'project_list',
      'graph_centrality',
      'graph_suggest_next',
      'graph_thermostat',
    ].includes(t.name),
  );

  const coreSourceTools = sourceTools.filter((t) =>
    [
      'source_load',
      'source_read',
      'source_position',
      'source_list',
      'source_export',
    ].includes(t.name),
  );

  // Ordinary reading may revise reading artifacts, but synthetic Reader/CMP
  // block creation, signing, and translation live in their own mode. The
  // batch-only check applies here too: this list names what reading may reach,
  // not an exemption from how it must be reached.
  const readingDocumentTools = documentTools.filter(
    (t) =>
      ['doc_revise'].includes(t.name) &&
      !batchOnlyDocumentToolNames.has(t.name),
  );

  // Concept tools needed for reading (read-only metadata access)
  const coreConceptTools = conceptTools.filter(
    (t) =>
      ['node_get_metadata'].includes(t.name) &&
      !batchOnlyConceptToolNames.has(t.name),
  );

  // Writing uses document trees as its artifact. Reading-specific thinking
  // tools stay out of this mode because they implement a chronological source
  // protocol, not ordinary drafting or editorial revision.
  const writingDocumentTools = documentTools.filter(
    (t) =>
      !batchOnlyDocumentToolNames.has(t.name) &&
      ![
        'doc_sign_thinking',
        'doc_get_unsigned_thinking',
        'doc_insert_thinking',
        'doc_append_thinking',
        'translate_thinking',
      ].includes(t.name),
  );

  // Graph-native code uses document roots as canonical source files and
  // ordered document children as rearrangeable code units. Generated files
  // are executable projections. Exclude reading annotations and creative
  // weaving, but retain structural editing and generation tools.
  const codingDocumentTools = documentTools.filter(
    (t) =>
      !batchOnlyDocumentToolNames.has(t.name) &&
      ![
        'doc_sign_thinking',
        'doc_get_unsigned_thinking',
        'doc_insert_thinking',
        'doc_append_thinking',
        'translate_thinking',
        'doc_weave',
      ].includes(t.name),
  );

  const ordinaryFullDocumentTools = documentTools.filter(
    (tool) =>
      !syntheticThinkingToolNames.has(tool.name) &&
      !batchOnlyDocumentToolNames.has(tool.name),
  );

  const syntheticReaderDocumentTools = documentTools.filter((tool) =>
    [
      'doc_read',
      'doc_get_tree',
      'doc_get_children',
      'doc_get_chain',
      'doc_flatten',
      ...SYNTHETIC_THINKING_TOOLS,
    ].includes(tool.name),
  );

  // Admin reflection tools - debugging, history, external refs (used in 'full' mode via reflectionTools)
  // Defined here for documentation - actual filtering happens via full reflectionTools spread

  if (mode === 'reading') {
    // ~25 tools: focused for reading tasks
    return [
      ...understandingTools,
      ...coreReflection,
      ...batchTools,
      ...groundedDiscoveryTools,
      ...coreSourceTools,
      ...readingDocumentTools,
      ...coreConceptTools,
    ];
  }

  if (mode === 'general') {
    // Safe cross-domain default: the ordinary understanding loop, atomic
    // mutations, bounded exploration, source work, and addressable artifacts.
    // Destructive administration, raw bulk mutation, chaos pipelines, and
    // solver coordination remain explicit full/focused-mode choices.
    return [
      ...understandingTools,
      ...coreReflection,
      ...batchTools,
      ...groundedDiscoveryTools,
      ...coreSourceTools,
      ...ordinaryFullDocumentTools,
      ...coreConceptTools,
    ];
  }

  if (mode === 'research') {
    // ~32 tools: reading + solver/parliament
    return [
      ...understandingTools,
      ...coreReflection,
      ...batchTools,
      ...groundedDiscoveryTools,
      ...solverTools,
      ...coreSourceTools,
    ];
  }

  if (mode === 'coding') {
    // Code is authored and rearranged in document trees, then projected to
    // generated files for builds and tests.
    return [
      ...understandingTools,
      ...coreReflection,
      ...batchTools,
      ...groundedDiscoveryTools,
      ...codingDocumentTools,
      ...coreConceptTools,
    ];
  }

  if (mode === 'collaborative_coding') {
    // Same graph-native code surface, plus ownership/handoff/lock tools.
    return [
      ...understandingTools,
      ...coreReflection,
      ...batchTools,
      ...groundedDiscoveryTools,
      ...codingDocumentTools,
      ...solverTools,
      ...coreConceptTools,
    ];
  }

  if (mode === 'writing') {
    return [
      ...understandingTools,
      ...coreReflection,
      ...batchTools,
      ...groundedDiscoveryTools,
      ...writingDocumentTools,
      ...coreConceptTools,
    ];
  }

  if (mode === 'synthetic_reader') {
    return [
      ...understandingTools,
      ...coreReflection.filter(
        (tool) =>
          tool.name !== 'graph_thermostat' &&
          tool.name !== 'graph_suggest_next',
      ),
      ...batchTools,
      ...coreSourceTools,
      ...syntheticReaderDocumentTools,
      ...coreConceptTools,
    ];
  }

  if (mode !== 'full') {
    throw new Error(`Unsupported tool mode: ${String(mode)}`);
  }

  // 'full' mode: every ordinary workflow tool. Reserved synthetic Reader/CMP
  // production remains isolated even on the broadest ordinary surface.
  return [
    ...understandingTools,
    ...visibleReflectionTools,
    ...batchTools,
    ...explorationTools,
    ...solverTools,
    ...sourceTools,
    ...ordinaryFullDocumentTools,
  ];
}

// Route tool calls to appropriate handlers
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
  mode: ToolMode = 'general',
  internal = false,
): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const result = await withReservedThinkingVisibility(
      mode === 'synthetic_reader',
      () =>
        handleToolCallInVisibility(name, args, contextManager, mode, internal),
    );
    recordToolCall(name, internal, startedAt, refusalIn(result));
    return result;
  } catch (error) {
    recordToolCall(
      name,
      internal,
      startedAt,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/**
 * A refusal that is returned rather than thrown is still a refusal.
 *
 * graph_batch reports a rejected write by returning success:false and rolling
 * back, so it never throws and the recorder logged it as a completed call.
 * Measured: a refused batch and a successful one were indistinguishable in
 * tool_calls, which made the write count wrong and hid the single most
 * informative thing an agent does — the tool saying no. A guard that never
 * fires is dead weight; one that fires constantly means the tool is fighting
 * its users, and neither could be seen.
 */
function refusalIn(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const payload = result as {
    success?: unknown;
    message?: unknown;
    error?: unknown;
  };
  if (payload.success !== false) return null;
  const reason = payload.message ?? payload.error;
  return typeof reason === 'string' && reason.trim() ? reason : 'refused';
}

/**
 * The graph recorded what was written and nothing about what was read.
 *
 * Measured on a real project: 122 writes against 6 re-entries and 2 rolled
 * suggestions — a ratio that had to be reconstructed from files outside the
 * tool, because tool_calls held zero rows. An ordinary agent has no such
 * files, so it could not answer "what have I been doing" from its own graph,
 * and the one axis this distinction turns on — whether the thing is being
 * re-entered or merely written to — was the invisible one.
 *
 * The recording machinery already existed in core, complete with indexes on
 * session and tool name, and was called only from tests. This wires it.
 *
 * Arguments are deliberately NOT stored: they carry the full text of every
 * node written, which would double the database to answer a question about
 * counts. Nested batch operations are skipped so a batch reads as one write
 * rather than as its twenty parts, and recording never throws — a failure to
 * log must not fail the call it is logging.
 */
function recordToolCall(
  name: string,
  internal: boolean,
  startedAt: number,
  error: string | null,
): void {
  if (internal) return;
  const entry = {
    sessionId: MCP_SESSION_ID,
    toolName: name,
    arguments: {},
    durationMs: Date.now() - startedAt,
    error,
  };
  try {
    sqlite.logToolCall(entry);
  } catch {
    // tool_calls.session_id is a foreign key onto conversations, so the very
    // first call against a given database has nothing to point at. Seed the
    // session row and retry rather than caching which projects were seeded:
    // a cache keyed by project id goes stale the moment a project's database
    // is re-created under a running server, and because this path must
    // swallow its own failures, stale would mean recording stops silently and
    // permanently.
    try {
      sqlite.saveConversation(MCP_SESSION_ID, `MCP session ${MCP_SESSION_ID}`);
      sqlite.logToolCall(entry);
    } catch {
      // Never let bookkeeping break the operation it is bookkeeping.
    }
  }
}

/**
 * One session is one server process, which is what makes getToolCallsBySession
 * answer a question worth asking: what did THIS working period do, rather than
 * what has this project accumulated over its lifetime.
 */
const MCP_SESSION_ID = `c_mcp_${process.pid.toString(36)}`;

async function handleToolCallInVisibility(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
  mode: ToolMode,
  internal: boolean,
): Promise<unknown> {
  assertSyntheticThinkingAccess(name, args, mode);

  if (
    !internal &&
    !getToolDefinitions(mode).some((definition) => definition.name === name)
  ) {
    throw new Error(
      `Tool "${name}" is not available in TOOL_MODE "${mode}". The live call allow-list matches the tools advertised for this mode.`,
    );
  }

  // A loaded SQLite connection is not consent to use that project. In a root
  // containing several graphs, startup opens them for cross-project discovery
  // but leaves selection unset. Only the two project-navigation tools are safe
  // before the caller deliberately chooses where the work belongs.
  if (
    !internal &&
    name !== 'project_list' &&
    name !== 'project_switch' &&
    !contextManager.getCurrentProjectId()
  ) {
    const available = contextManager.listProjects();
    const options = available.length
      ? ` Available projects: [${available.join(', ')}].`
      : '';
    throw new Error(
      `No active project.${options} Call project_switch({ project: "<id>" }) before using graph tools. That call creates the project when the id does not exist yet.`,
    );
  }

  if (name === 'graph_understand') {
    return handleUnderstandingTools(name, args, contextManager);
  }

  // Keep internal graph_batch dispatch in exact parity with conceptTools.
  // The external mode allow-list above still determines which, if any, are
  // callable at top level.
  if (conceptToolNames.has(name)) {
    return handleConceptTools(name, args, contextManager, internal);
  }

  // Connection tools
  if (
    name === 'graph_connect' ||
    name === 'graph_answer' ||
    name === 'graph_disconnect' ||
    name === 'edge_update'
  ) {
    return handleConnectionTools(name, args, contextManager);
  }

  // Synthesis tools
  if (
    name === 'graph_discover' ||
    name === 'graph_discover_grounded' ||
    name === 'graph_discover_grounded_chaos' ||
    name === 'graph_random' ||
    name === 'graph_serendipity' ||
    name === 'graph_validate' ||
    name === 'graph_chaos' ||
    name === 'graph_decide' ||
    name === 'graph_evaluate_variations'
  ) {
    return handleSynthesisTools(name, args, contextManager);
  }

  // Reflection tools
  if (
    name === 'graph_context' ||
    name === 'graph_context_region' ||
    name === 'graph_skeleton' ||
    name === 'graph_path' ||
    name === 'graph_analyze' ||
    name === 'graph_history' ||
    name === 'project_switch' ||
    name === 'project_list' ||
    name === 'graph_lookup_external' ||
    name === 'graph_list_external' ||
    name === 'graph_similar' ||
    name === 'graph_semantic_gaps' ||
    name === 'graph_centrality' ||
    name === 'graph_semantic_search' ||
    name === 'graph_backfill_embeddings' ||
    name === 'graph_embedding_stats' ||
    name === 'graph_suggest_next' ||
    name === 'graph_thermostat' ||
    name === 'graph_bulk_replace' ||
    // New revision/query tools
    name === 'node_get_revisions' ||
    name === 'edge_get_revisions' ||
    name === 'graph_find_by_trigger' ||
    name === 'graph_search_metadata' ||
    name === 'graph_find_by_reference' ||
    name === 'graph_purge' ||
    name === 'graph_resolve_references' ||
    name === 'graph_global_lookup' ||
    name === 'graph_score' ||
    name === 'graph_practice'
  ) {
    return handleReflectionTools(name, args, contextManager);
  }

  // Document tools (including translate_thinking macro)
  if (name.startsWith('doc_') || name === 'translate_thinking') {
    return handleDocumentTools(name, args, contextManager, mode);
  }

  // Batch tools
  if (name === 'graph_batch') {
    return handleBatchTools(name, args, contextManager, mode);
  }

  // Thematic system tools
  if (
    name === 'theme_create' ||
    name === 'theme_activate' ||
    name === 'theme_landing' ||
    name === 'theme_get_active' ||
    name === 'theme_check_alignment' ||
    name === 'theme_deactivate'
  ) {
    return handleThematicTools(name, args, contextManager);
  }

  // Solver/Parliament tools
  if (name.startsWith('solver_')) {
    return handleSolverTools(name, args);
  }

  // Source tools (chronological reading)
  if (name.startsWith('source_')) {
    return handleSourceTools(name, args, contextManager, mode);
  }

  throw new Error(`Unknown tool: ${name}`);
}
