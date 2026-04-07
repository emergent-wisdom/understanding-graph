// Re-export all types

// Re-export database modules
export * as sqlite from './database/sqlite.js';
// Cross-project database functions (preferred over ExternalGraphStore)
export {
  // Commits - "Git for Cognition"
  type Commit,
  createCommit,
  // Cross-project
  createTextSource,
  deleteTextSource,
  type ExternalNodeData,
  getAllDatabases,
  getCommit,
  getCommitForNode, // Fast: uses commit_id column (origin story)
  getCommitsForEdge,
  getCommitsForNode,
  getCurrentProjectId,
  getDocumentRoots,
  getLoadedProjectIds,
  getProjectStats,
  getRecentCommits,
  getTextSource,
  getTextSourceProgress,
  globalNodeLookup,
  initAllDatabases,
  isProjectLoaded,
  listExternalNodes,
  listTextSources,
  lookupExternalNode,
  queryEdges,
  queryNodes,
  readTextSource,
  setCurrentProject,
  // Text Sources (Chronological Reading)
  type TextSource,
  updateTextSource,
} from './database/sqlite.js';
export * as AnalysisService from './services/AnalysisService.js';
// Re-export services (now using GraphStore internally)
export * as ContextService from './services/ContextService.js';
// DocumentWriter - generates markdown files from document nodes
export {
  createDocumentWriter,
  DocumentWriter,
  type DocumentWriterOptions,
  type WriteResult,
} from './services/DocumentWriter.js';
// EmbeddingService - semantic embeddings for nodes
export * as EmbeddingService from './services/EmbeddingService.js';
// GraphStore (SQLite + graphology based) - main graph operations
export {
  type CommunityResult,
  ExternalGraphStore, // Deprecated - kept for backwards compatibility
  type GraphEdgeData,
  type GraphNodeData,
  GraphStore,
  getExternalGraphStore, // Deprecated - use sqlite.* functions instead
  getGraphStore,
  type ImportanceResult,
  type NeighborhoodResult,
  type PathResult,
  type Reference,
  resetGraphStore,
  type SemanticGap,
  type SemanticSearchResult,
  type SimilarNode,
} from './services/GraphStore.js';
export * from './types/index.js';
