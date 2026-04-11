import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { ContextManager } from '../context-manager.js';
// Import tool handlers
import { batchTools, handleBatchTools } from './batch.js';
import { conceptTools, handleConceptTools } from './concept.js';
import { handleConnectionTools } from './connection.js';
import { documentTools, handleDocumentTools } from './document.js';
import { handleReflectionTools, reflectionTools } from './reflection.js';
import { handleSolverTools, solverTools } from './solvers.js';
import { handleSourceTools, sourceTools } from './source.js';
import { handleSynthesisTools, synthesisTools } from './synthesis.js';
import { handleThematicTools } from './thematic.js';

// Tool exposure modes
export type ToolMode = 'reading' | 'research' | 'full';

// Get tool definitions based on mode
// ARCHITECTURE: All mutations go through graph_batch (enforces commit messages).
export function getToolDefinitions(mode: ToolMode = 'full'): Tool[] {
  // Filter synthesis tools to expose exploration and decision tools
  const explorationTools = synthesisTools.filter((t) =>
    [
      'graph_discover',
      'graph_chaos',
      'graph_decide',
      'graph_evaluate_variations',
    ].includes(t.name),
  );

  // Core reading tools - essential for any reading task
  const coreReadingReflection = reflectionTools.filter((t) =>
    [
      'graph_skeleton',
      'graph_analyze',
      'graph_semantic_gaps',
      'graph_score',
      'graph_semantic_search',
      'graph_similar',
      'graph_find_by_trigger',
      'graph_context',
      'graph_context_region',
      'graph_path',
      'graph_centrality',
      'graph_thermostat',
    ].includes(t.name),
  );

  const coreSourceTools = sourceTools.filter((t) =>
    ['source_read', 'source_position'].includes(t.name),
  );

  // Document tools needed for reading (translator uses translate_thinking macro)
  const coreDocumentTools = documentTools.filter((t) =>
    [
      'doc_revise',
      'doc_insert_thinking',
      'doc_append_thinking',
      'translate_thinking',
    ].includes(t.name),
  );

  // Concept tools needed for reading (read-only metadata access)
  const coreConceptTools = conceptTools.filter((t) =>
    ['node_get_metadata'].includes(t.name),
  );

  // Admin reflection tools - debugging, history, external refs (used in 'full' mode via reflectionTools)
  // Defined here for documentation - actual filtering happens via full reflectionTools spread

  if (mode === 'reading') {
    // ~25 tools: focused for reading tasks
    return [
      ...coreReadingReflection,
      ...batchTools,
      ...explorationTools,
      ...coreSourceTools,
      ...coreDocumentTools,
      ...coreConceptTools,
    ];
  }

  if (mode === 'research') {
    // ~32 tools: reading + solver/parliament
    return [
      ...coreReadingReflection,
      ...batchTools,
      ...explorationTools,
      ...solverTools,
      ...coreSourceTools,
    ];
  }

  // 'full' mode: everything (~51 tools)
  return [
    ...reflectionTools,
    ...batchTools,
    ...explorationTools,
    ...solverTools,
    ...sourceTools,
    ...documentTools,
  ];
}

// Route tool calls to appropriate handlers
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  // Concept tools
  if (
    name.startsWith('graph_add_concept') ||
    name === 'graph_question' ||
    name === 'graph_revise' ||
    name === 'graph_supersede' ||
    name === 'graph_add_reference' ||
    name === 'node_set_metadata' ||
    name === 'node_get_metadata'
  ) {
    return handleConceptTools(name, args, contextManager);
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
    name === 'graph_score'
  ) {
    return handleReflectionTools(name, args, contextManager);
  }

  // Document tools (including translate_thinking macro)
  if (name.startsWith('doc_') || name === 'translate_thinking') {
    return handleDocumentTools(name, args, contextManager);
  }

  // Batch tools
  if (name === 'graph_batch') {
    return handleBatchTools(name, args, contextManager);
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
    return handleSourceTools(name, args, contextManager);
  }

  throw new Error(`Unknown tool: ${name}`);
}
