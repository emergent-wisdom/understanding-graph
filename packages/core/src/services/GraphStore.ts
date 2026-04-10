// eslint-disable-next-line @typescript-eslint/no-require-imports
import GraphConstructor from 'graphology';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import louvainFn from 'graphology-communities-louvain';
import { bidirectional } from 'graphology-shortest-path';
import { bfsFromNode } from 'graphology-traversal';
import { v4 as uuidv4 } from 'uuid';
import { getDb, logEvent } from '../database/sqlite.js';
import type { TriggerType } from '../types/index.js';
import {
  bufferToEmbedding,
  cosineSimilarity,
  embeddingToBuffer,
  generateEmbedding,
  generateNodeEmbedding,
} from './EmbeddingService.js';

// Graphology types - use any to avoid ESM/CJS issues
// biome-ignore lint/suspicious/noExplicitAny: graphology ESM/CJS compatibility
type GraphType = any;

// ============================================================================
// Types
// ============================================================================

export interface Reference {
  // External URL reference
  url?: string;
  title?: string;
  accessed?: string;
  // Cross-project reference (alternative to url)
  project?: string; // Project ID (e.g., "home", "ccmm-research")
  nodeId?: string; // Node ID in that project
}

export interface GraphNodeData {
  id: string;
  title: string;
  trigger: TriggerType | null;
  why: string | null;
  understanding: string | null;
  sourceElements: string[] | null;
  validated: boolean | null;
  active: boolean;
  version: number;
  revisions: Revision[];
  conversationId: string | null;
  createdAt: string;
  updatedAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  embedding: Float32Array | null;
  references: Reference[] | null;
  // Document fields
  content: string | null;
  summary: string | null;
  level: string | null;
  isDocRoot: boolean | null;
  fileType: string | null;
  // Flexible metadata for modules (narrative-engine, etc.)
  metadata: Record<string, unknown>;
}

export interface GraphEdgeData {
  id: string;
  fromId: string;
  toId: string;
  from: string; // Alias for client compatibility
  to: string; // Alias for client compatibility
  type: string;
  explanation: string | null;
  why: string | null;
  active: boolean;
  version: number;
  revisions: Revision[];
  conversationId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Revision {
  title?: string;
  trigger?: string;
  why?: string;
  understanding?: string;
  explanation?: string;
  version: number;
  timestamp: string;
  revisionWhy: string;
  conversationId: string | null;
}

export interface CreateNodeInput {
  title: string;
  trigger?: TriggerType;
  why?: string;
  understanding?: string;
  sourceElements?: string[];
  references?: Reference[];
  conversationId?: string; // Optional - only set if session is active
  toolCallId?: number | null;
  // Document fields
  content?: string;
  summary?: string;
  level?: string;
  isDocRoot?: boolean;
  fileType?: string;
  // Flexible metadata
  metadata?: Record<string, unknown>;
}

export interface UpdateNodeInput {
  title?: string;
  trigger?: TriggerType;
  why?: string;
  understanding?: string;
  validated?: boolean;
  references?: Reference[];
  revisionWhy?: string;
  conversationId?: string;
  // Document fields
  content?: string;
  summary?: string;
  level?: string;
  isDocRoot?: boolean;
  fileType?: string;
  // Flexible metadata (merges with existing)
  metadata?: Record<string, unknown>;
}

export interface CreateEdgeInput {
  fromId: string;
  toId: string;
  type?: string;
  explanation?: string;
  why?: string;
  conversationId?: string; // Optional - only set if session is active
  toolCallId?: number | null;
}

export interface UpdateEdgeInput {
  type?: string;
  explanation?: string;
  why?: string;
  revisionWhy?: string;
  conversationId?: string;
}

// Query result types
export interface NeighborhoodResult {
  nodes: GraphNodeData[];
  edges: GraphEdgeData[];
  center: string;
  depth: number;
}

export interface PathResult {
  exists: boolean;
  path: string[] | null;
  pathNodes: GraphNodeData[];
  length: number;
}

export interface CommunityResult {
  communities: Map<number, GraphNodeData[]>;
  modularity: number;
  nodeCount: number;
}

export interface ImportanceResult {
  pageRank: Array<{ node: GraphNodeData; score: number }>;
  betweenness: Array<{ node: GraphNodeData; score: number }>;
  degree: Array<{
    node: GraphNodeData;
    inDegree: number;
    outDegree: number;
    total: number;
  }>;
}

export interface SimilarNode {
  node: GraphNodeData;
  sharedNeighbors: number;
  jaccardSimilarity: number;
}

export interface SemanticGap {
  node1: GraphNodeData;
  node2: GraphNodeData;
  sharedTerms: string[];
  embeddingSimilarity?: number;
  connected: boolean;
}

export interface SemanticSearchResult {
  node: GraphNodeData;
  similarity: number;
}

export interface DocumentTreeNode {
  node: GraphNodeData;
  children: DocumentTreeNode[];
}

// ============================================================================
// GraphStore Class
// ============================================================================

export class GraphStore {
  private graph: GraphType | null = null;
  private nodesCache: Map<string, GraphNodeData> = new Map();
  private edgesCache: Map<string, GraphEdgeData> = new Map();
  private dirty = true;

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private parseJson<T>(value: string | null, defaultValue: T): T {
    if (!value) return defaultValue;
    try {
      return JSON.parse(value) as T;
    } catch {
      return defaultValue;
    }
  }

  private rowToNode(row: Record<string, unknown>): GraphNodeData {
    // Parse embedding from BLOB if present
    let embedding: Float32Array | null = null;
    if (row.embedding && Buffer.isBuffer(row.embedding)) {
      embedding = bufferToEmbedding(row.embedding as Buffer);
    }

    return {
      id: row.id as string,
      title: row.title as string,
      trigger: (row.trigger as TriggerType) || null,
      why: (row.why as string) || null,
      understanding: (row.understanding as string) || null,
      sourceElements: this.parseJson<string[] | null>(
        row.source_elements as string,
        null,
      ),
      validated: row.validated === null ? null : Boolean(row.validated),
      active: Boolean(row.active),
      version: (row.version as number) || 1,
      revisions: this.parseJson<Revision[]>(row.revisions as string, []),
      conversationId: (row.conversation_id as string) || null,
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string) || null,
      archivedAt: (row.archived_at as string) || null,
      archiveReason: (row.archive_reason as string) || null,
      embedding,
      references: this.parseJson<Reference[] | null>(
        row.references as string,
        null,
      ),
      // Document fields
      content: (row.content as string) || null,
      summary: (row.summary as string) || null,
      level: (row.level as string) || null,
      isDocRoot: row.is_doc_root === null ? null : Boolean(row.is_doc_root),
      fileType: (row.file_type as string) || null,
      // Flexible metadata
      metadata: this.parseJson<Record<string, unknown>>(
        row.metadata as string,
        {},
      ),
    };
  }

  private rowToEdge(row: Record<string, unknown>): GraphEdgeData {
    const fromId = row.from_id as string;
    const toId = row.to_id as string;
    return {
      id: row.id as string,
      fromId,
      toId,
      from: fromId, // Alias for client compatibility
      to: toId, // Alias for client compatibility
      type: (row.type as string) || 'relates',
      explanation: (row.explanation as string) || null,
      why: (row.why as string) || null,
      active: Boolean(row.active),
      version: (row.version as number) || 1,
      revisions: this.parseJson<Revision[]>(row.revisions as string, []),
      conversationId: (row.conversation_id as string) || null,
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string) || null,
    };
  }

  private markDirty(): void {
    this.dirty = true;
  }

  // --------------------------------------------------------------------------
  // Graph loading
  // --------------------------------------------------------------------------

  /**
   * Load the full graph from SQLite into graphology.
   * Call this at session start or after detecting dirty state.
   */
  loadGraph(options: { includeInactive?: boolean } = {}): GraphType {
    const { includeInactive = false } = options;

    const db = getDb();
    // biome-ignore lint/suspicious/noExplicitAny: graphology ESM/CJS compatibility
    this.graph = new (GraphConstructor as any)({
      type: 'directed',
      allowSelfLoops: false,
    }) as GraphType;
    this.nodesCache.clear();
    this.edgesCache.clear();

    // Load nodes
    const nodeQuery = includeInactive
      ? 'SELECT * FROM nodes'
      : 'SELECT * FROM nodes WHERE active = 1';
    const nodeRows = db.prepare(nodeQuery).all() as Record<string, unknown>[];

    for (const row of nodeRows) {
      const node = this.rowToNode(row);
      this.nodesCache.set(node.id, node);
      this.graph.addNode(node.id, { ...node });
    }

    // Load edges
    const edgeQuery = includeInactive
      ? 'SELECT * FROM edges'
      : 'SELECT * FROM edges WHERE active = 1';
    const edgeRows = db.prepare(edgeQuery).all() as Record<string, unknown>[];

    for (const row of edgeRows) {
      const edge = this.rowToEdge(row);
      this.edgesCache.set(edge.id, edge);
      // Only add edge if both endpoints exist and edge doesn't already exist
      if (
        this.graph.hasNode(edge.fromId) &&
        this.graph.hasNode(edge.toId) &&
        !this.graph.hasEdge(edge.fromId, edge.toId)
      ) {
        this.graph.addEdge(edge.fromId, edge.toId, { ...edge, key: edge.id });
      }
    }

    this.dirty = false;
    return this.graph;
  }

  /**
   * Get the graphology instance (loads if needed)
   */
  getGraph(): GraphType {
    if (!this.graph || this.dirty) {
      this.loadGraph();
    }
    if (!this.graph) {
      throw new Error('Failed to load graph');
    }
    return this.graph;
  }

  // --------------------------------------------------------------------------
  // Node CRUD
  // --------------------------------------------------------------------------

  createNode(input: CreateNodeInput): GraphNodeData & { seq: number } {
    // --- STRICT VALIDATION (Impossible to create illegal nodes) ---
    const isDocument = !!input.content || !!input.level;

    if (isDocument) {
      if (!input.title || !input.content) {
        throw new Error(
          "ILLEGAL_DOCUMENT_NODE: Document nodes MUST have 'title' and 'content'.",
        );
      }
    } else {
      // Concept node validation
      const missing = [];
      if (!input.title) missing.push('title');
      if (!input.trigger) missing.push('trigger');
      if (!input.why) missing.push('why');
      if (!input.understanding) missing.push('understanding');

      if (missing.length > 0) {
        throw new Error(
          `ILLEGAL_CONCEPT_NODE: Missing required fields: ${missing.join(', ')}. Every concept must capture its metabolic intent (trigger, why, understanding).`,
        );
      }
    }

    const db = getDb();
    const id = `n_${uuidv4().slice(0, 8)}`;
    const isSerendipity = input.trigger === 'serendipity';

    const stmt = db.prepare(`
      INSERT INTO nodes (id, title, trigger, why, understanding, source_elements, validated, conversation_id, tool_call_id, content, summary, level, is_doc_root, file_type, "references", metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.title,
      input.trigger || null,
      input.why || null,
      input.understanding || null,
      input.sourceElements ? JSON.stringify(input.sourceElements) : null,
      isSerendipity ? 0 : null,
      input.conversationId,
      input.toolCallId ?? null,
      input.content || null,
      input.summary || null,
      input.level || null,
      input.isDocRoot ? 1 : null,
      input.fileType || null,
      input.references ? JSON.stringify(input.references) : null,
      input.metadata ? JSON.stringify(input.metadata) : '{}',
    );

    // Log event
    const seq = logEvent(
      'created',
      'node',
      id,
      input.conversationId,
      `Created concept: ${input.title}`,
    );

    this.markDirty();

    // Return the created node
    const row = db
      .prepare('SELECT * FROM nodes WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return { ...this.rowToNode(row), seq };
  }

  getNode(id: string): GraphNodeData | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToNode(row) : null;
  }

  updateNode(
    id: string,
    input: UpdateNodeInput,
  ): GraphNodeData & { seq: number } {
    const db = getDb();

    // Get current state for revision
    const current = this.getNode(id);
    if (!current) {
      throw new Error(`Node not found: ${id}`);
    }

    // Build revision
    const revision: Revision = {
      title: current.title,
      trigger: current.trigger || undefined,
      why: current.why || undefined,
      understanding: current.understanding || undefined,
      version: current.version,
      timestamp: new Date().toISOString(),
      revisionWhy: input.revisionWhy || 'Updated',
      conversationId: input.conversationId || null,
    };

    const revisions = [...current.revisions, revision];

    // Merge metadata if provided
    let mergedMetadata: string | null = null;
    if (input.metadata) {
      const existingMetadata = current.metadata || {};
      mergedMetadata = JSON.stringify({
        ...existingMetadata,
        ...input.metadata,
      });
    }

    // Update
    const stmt = db.prepare(`
      UPDATE nodes SET
        title = COALESCE(?, title),
        trigger = COALESCE(?, trigger),
        why = COALESCE(?, why),
        understanding = COALESCE(?, understanding),
        validated = CASE WHEN ? IS NOT NULL THEN ? ELSE validated END,
        revisions = ?,
        version = version + 1,
        updated_at = datetime('now'),
        content = COALESCE(?, content),
        summary = COALESCE(?, summary),
        level = COALESCE(?, level),
        is_doc_root = CASE WHEN ? IS NOT NULL THEN ? ELSE is_doc_root END,
        file_type = COALESCE(?, file_type),
        "references" = COALESCE(?, "references"),
        metadata = COALESCE(?, metadata)
      WHERE id = ?
    `);

    const validatedVal =
      input.validated !== undefined ? (input.validated ? 1 : 0) : null;
    const isDocRootVal =
      input.isDocRoot !== undefined ? (input.isDocRoot ? 1 : 0) : null;
    stmt.run(
      input.title || null,
      input.trigger || null,
      input.why || null,
      input.understanding || null,
      validatedVal,
      validatedVal,
      JSON.stringify(revisions),
      input.content || null,
      input.summary || null,
      input.level || null,
      isDocRootVal,
      isDocRootVal,
      input.fileType || null,
      input.references ? JSON.stringify(input.references) : null,
      mergedMetadata,
      id,
    );

    const seq = logEvent(
      'revised',
      'node',
      id,
      input.conversationId || null,
      `Revised concept: ${input.title || current.title}`,
      { revisionWhy: input.revisionWhy },
    );

    this.markDirty();

    const row = db
      .prepare('SELECT * FROM nodes WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return { ...this.rowToNode(row), seq };
  }

  /**
   * Add a reference to an existing node (appends to existing references)
   */
  addReference(nodeId: string, reference: Reference): GraphNodeData | null {
    const db = getDb();
    const node = this.getNode(nodeId);
    if (!node) return null;

    const existingRefs = node.references || [];

    // Check for duplicates - by URL or by project+nodeId
    const isDuplicate = existingRefs.some((r) => {
      if (reference.url && r.url === reference.url) return true;
      if (
        reference.project &&
        reference.nodeId &&
        r.project === reference.project &&
        r.nodeId === reference.nodeId
      )
        return true;
      return false;
    });

    if (isDuplicate) {
      return node; // Already exists
    }

    const newRefs = [...existingRefs, reference];
    db.prepare(
      'UPDATE nodes SET "references" = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(JSON.stringify(newRefs), nodeId);

    this.markDirty();
    return this.getNode(nodeId);
  }

  /**
   * Set metadata on a node (merges with existing metadata)
   * Use this for module-specific data like narrative-engine coordinates
   */
  setMetadata(
    nodeId: string,
    metadata: Record<string, unknown>,
  ): GraphNodeData | null {
    const db = getDb();
    const node = this.getNode(nodeId);
    if (!node) return null;

    const existingMetadata = node.metadata || {};
    const merged = { ...existingMetadata, ...metadata };

    db.prepare(
      "UPDATE nodes SET metadata = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(merged), nodeId);

    this.markDirty();
    return this.getNode(nodeId);
  }

  /**
   * Get metadata from a node
   */
  getMetadata(nodeId: string): Record<string, unknown> | null {
    const node = this.getNode(nodeId);
    if (!node) return null;
    return node.metadata || {};
  }

  /**
   * Set a specific metadata key on a node
   */
  setMetadataKey(
    nodeId: string,
    key: string,
    value: unknown,
  ): GraphNodeData | null {
    return this.setMetadata(nodeId, { [key]: value });
  }

  /**
   * Get a specific metadata key from a node
   */
  getMetadataKey(nodeId: string, key: string): unknown | null {
    const metadata = this.getMetadata(nodeId);
    if (!metadata) return null;
    return metadata[key] ?? null;
  }

  /**
   * Remove a metadata key from a node
   */
  removeMetadataKey(nodeId: string, key: string): GraphNodeData | null {
    const db = getDb();
    const node = this.getNode(nodeId);
    if (!node) return null;

    const existingMetadata = { ...(node.metadata || {}) };
    delete existingMetadata[key];

    db.prepare(
      "UPDATE nodes SET metadata = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(JSON.stringify(existingMetadata), nodeId);

    this.markDirty();
    return this.getNode(nodeId);
  }

  archiveNode(id: string, reason?: string, conversationId?: string): boolean {
    const db = getDb();
    const node = this.getNode(id);
    if (!node) return false;

    db.prepare(`
      UPDATE nodes SET active = 0, archived_at = datetime('now'), archive_reason = ?
      WHERE id = ?
    `).run(reason || null, id);

    logEvent(
      'archived',
      'node',
      id,
      conversationId || null,
      `Archived: ${node.title}`,
    );
    this.markDirty();
    return true;
  }

  /**
   * Convert a document node to a concept node by clearing document-specific fields.
   * Optionally moves content to understanding.
   */
  convertToConcept(
    id: string,
    options: {
      moveContent?: boolean; // If true, move content to understanding (if understanding is empty)
      trigger?: string; // New trigger type (default: keeps existing or 'foundation')
      why?: string; // Revision reason
      conversationId?: string;
    } = {},
  ): GraphNodeData & { seq: number } {
    const db = getDb();
    const current = this.getNode(id);
    if (!current) {
      throw new Error(`Node not found: ${id}`);
    }

    // Determine new understanding
    let newUnderstanding = current.understanding;
    if (options.moveContent && current.content && !current.understanding) {
      newUnderstanding = current.content;
    }

    // Build revision
    const revision = {
      title: current.title,
      trigger: current.trigger || undefined,
      why: current.why || undefined,
      understanding: current.understanding || undefined,
      content: current.content || undefined,
      version: current.version,
      timestamp: new Date().toISOString(),
      revisionWhy: options.why || 'Converted from document to concept node',
      conversationId: options.conversationId || null,
    };

    const revisions = [...current.revisions, revision];

    // Clear document fields, update trigger and understanding
    const stmt = db.prepare(`
      UPDATE nodes SET
        content = NULL,
        summary = NULL,
        level = NULL,
        is_doc_root = NULL,
        file_type = NULL,
        trigger = ?,
        understanding = ?,
        revisions = ?,
        version = version + 1,
        updated_at = datetime('now')
      WHERE id = ?
    `);

    stmt.run(
      options.trigger || current.trigger || 'foundation',
      newUnderstanding || null,
      JSON.stringify(revisions),
      id,
    );

    const seq = logEvent(
      'revised',
      'node',
      id,
      options.conversationId || null,
      `Converted to concept: ${current.title}`,
    );
    this.markDirty();
    const updated = this.getNode(id);
    if (!updated) {
      throw new Error(`Node not found after update: ${id}`);
    }
    return { ...updated, seq };
  }

  findNodeByName(name: string): GraphNodeData | null {
    const db = getDb();
    const row = db
      .prepare(`
      SELECT * FROM nodes WHERE active = 1 AND LOWER(title) = LOWER(?)
    `)
      .get(name) as Record<string, unknown> | undefined;
    return row ? this.rowToNode(row) : null;
  }

  findSimilarNodes(name: string, limit = 5): GraphNodeData[] {
    const db = getDb();
    const rows = db
      .prepare(`
      SELECT * FROM nodes WHERE active = 1 AND LOWER(title) LIKE LOWER(?)
      ORDER BY LENGTH(title) ASC LIMIT ?
    `)
      .all(`%${name}%`, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  // --------------------------------------------------------------------------
  // Edge CRUD
  // --------------------------------------------------------------------------

  createEdge(input: CreateEdgeInput): GraphEdgeData & { seq: number } {
    const db = getDb();
    const id = `e_${uuidv4().slice(0, 8)}`;

    // Verify nodes exist to prevent FK constraint failure
    const fromNode = this.getNode(input.fromId);
    if (!fromNode) {
      throw new Error(
        `Source node not found: "${input.fromId}". You must create the node first using graph_add_concept.`,
      );
    }
    const toNode = this.getNode(input.toId);
    if (!toNode) {
      throw new Error(
        `Target node not found: "${input.toId}". You must create the node first using graph_add_concept.`,
      );
    }

    // Validate edge type - ordered by category, 'relates' is LAST RESORT
    const VALID_EDGE_TYPES = [
      // Semantic - how ideas relate conceptually
      'supersedes', // New understanding replaces old
      'contradicts', // Creates tension (one must yield)
      'diverse_from', // Different perspective (both valid)
      'refines', // Adds precision to existing concept
      'answers', // Resolves a question
      'questions', // Raises doubt about a concept
      'expresses', // Document → concept it discusses
      'implements', // Abstract → concrete realization
      'contextualizes', // Provides framing
      // Epistemic - how knowledge was acquired
      'learned_from', // Derived understanding from source
      // Predictive - tracking forecasts
      'validates', // Later evidence confirms a prediction
      'invalidates', // Later evidence refutes a prediction
      // Structural - document organization
      'contains', // Parent → child
      'next', // Sequence ordering
      // LAST RESORT - only use if NONE of the above fit
      'relates', // Avoid! Pick a specific type above
    ];
    if (!input.type) {
      throw new Error(
        `Edge type is required. Pick one: ${VALID_EDGE_TYPES.slice(0, -1).join(', ')}. ` +
          `(Use 'relates' ONLY if nothing else fits.) ` +
          `Think: How does "${fromNode.title}" affect understanding of "${toNode.title}"?`,
      );
    }
    if (!VALID_EDGE_TYPES.includes(input.type)) {
      throw new Error(
        `Invalid edge type: "${input.type}". Valid types are: ${VALID_EDGE_TYPES.join(', ')}. ` +
          `Do not invent edge types like "chosen as" or "considered for".`,
      );
    }

    // Require why field for ALL edges - every connection is a cognitive decision
    if (!input.why || input.why.trim().length < 3) {
      throw new Error(
        `Edge requires a meaningful "why" field (min 3 chars). ` +
          `Explain WHY "${fromNode.title}" ${input.type} "${toNode.title}". ` +
          `Bad: "" or "connects". Good: "Relates to X".`,
      );
    }

    const stmt = db.prepare(`
      INSERT INTO edges (id, from_id, to_id, type, explanation, why, conversation_id, tool_call_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.fromId,
      input.toId,
      input.type || 'relates',
      input.explanation || null,
      input.why || null,
      input.conversationId,
      input.toolCallId ?? null,
    );

    const seq = logEvent(
      'created',
      'edge',
      id,
      input.conversationId,
      `Created edge: ${input.fromId} → ${input.toId}`,
    );
    this.markDirty();

    const row = db
      .prepare('SELECT * FROM edges WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return { ...this.rowToEdge(row), seq };
  }

  getEdge(id: string): GraphEdgeData | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM edges WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToEdge(row) : null;
  }

  getEdgesBetween(fromId: string, toId: string): GraphEdgeData[] {
    const db = getDb();
    const rows = db
      .prepare(
        'SELECT * FROM edges WHERE from_id = ? AND to_id = ? AND active = 1',
      )
      .all(fromId, toId) as Record<string, unknown>[];
    return rows.map((row) => this.rowToEdge(row));
  }

  updateEdge(
    id: string,
    input: UpdateEdgeInput,
  ): GraphEdgeData & { seq: number } {
    const db = getDb();
    const current = this.getEdge(id);
    if (!current) {
      throw new Error(`Edge not found: ${id}`);
    }

    const revision: Revision = {
      explanation: current.explanation || undefined,
      why: current.why || undefined,
      version: current.version,
      timestamp: new Date().toISOString(),
      revisionWhy: input.revisionWhy || 'Updated',
      conversationId: input.conversationId || null,
    };

    const revisions = [...current.revisions, revision];

    db.prepare(`
      UPDATE edges SET
        type = COALESCE(?, type),
        explanation = COALESCE(?, explanation),
        why = COALESCE(?, why),
        revisions = ?,
        version = version + 1,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.type || null,
      input.explanation || null,
      input.why || null,
      JSON.stringify(revisions),
      id,
    );

    const seq = logEvent(
      'revised',
      'edge',
      id,
      input.conversationId || null,
      `Revised edge: ${id}`,
    );
    this.markDirty();

    const row = db
      .prepare('SELECT * FROM edges WHERE id = ?')
      .get(id) as Record<string, unknown>;
    return { ...this.rowToEdge(row), seq };
  }

  archiveEdge(id: string, conversationId?: string): boolean {
    const db = getDb();
    const edge = this.getEdge(id);
    if (!edge) return false;

    db.prepare(
      "UPDATE edges SET active = 0, updated_at = datetime('now') WHERE id = ?",
    ).run(id);
    logEvent(
      'archived',
      'edge',
      id,
      conversationId || null,
      `Archived edge: ${id}`,
    );
    this.markDirty();
    return true;
  }

  // --------------------------------------------------------------------------
  // Full-text search
  // --------------------------------------------------------------------------

  searchNodes(query: string, limit = 20): GraphNodeData[] {
    const db = getDb();
    const rows = db
      .prepare(`
      SELECT n.* FROM nodes n
      JOIN nodes_fts fts ON n.id = fts.id
      WHERE nodes_fts MATCH ? AND n.active = 1
      ORDER BY rank
      LIMIT ?
    `)
      .all(query, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  // --------------------------------------------------------------------------
  // Advanced queries using graphology
  // --------------------------------------------------------------------------

  /**
   * Get all nodes within N hops of a given node
   */
  getNeighborhood(nodeId: string, depth = 2): NeighborhoodResult {
    const graph = this.getGraph();
    if (!graph.hasNode(nodeId)) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const visited = new Set<string>();
    const nodeIds: string[] = [];

    bfsFromNode(graph, nodeId, (node, _attr, d) => {
      if (d <= depth) {
        visited.add(node);
        nodeIds.push(node);
        return false; // continue
      }
      return true; // stop this branch
    });

    const nodes = nodeIds
      .map((id) => this.nodesCache.get(id))
      .filter((n): n is GraphNodeData => n !== undefined);
    const edges: GraphEdgeData[] = [];

    // Collect edges between visited nodes
    for (const nid of visited) {
      graph.forEachOutEdge(
        nid,
        (
          _edge: string,
          attrs: Record<string, unknown>,
          _source: string,
          target: string,
        ) => {
          if (visited.has(target)) {
            const edgeData = this.edgesCache.get(attrs.id as string);
            if (edgeData) edges.push(edgeData);
          }
        },
      );
    }

    return { nodes, edges, center: nodeId, depth };
  }

  /**
   * Find shortest path between two nodes
   */
  findPath(fromId: string, toId: string): PathResult {
    const graph = this.getGraph();

    if (!graph.hasNode(fromId) || !graph.hasNode(toId)) {
      return { exists: false, path: null, pathNodes: [], length: 0 };
    }

    const path = bidirectional(graph, fromId, toId);

    if (!path) {
      return { exists: false, path: null, pathNodes: [], length: 0 };
    }

    const pathNodes = path
      .map((id) => this.nodesCache.get(id))
      .filter((n): n is GraphNodeData => n !== undefined);

    return {
      exists: true,
      path,
      pathNodes,
      length: path.length - 1,
    };
  }

  /**
   * Detect communities using Louvain algorithm
   */
  detectCommunities(): CommunityResult {
    const graph = this.getGraph();

    // Louvain needs undirected graph
    // biome-ignore lint/suspicious/noExplicitAny: graphology ESM/CJS compatibility
    const undirected = new (GraphConstructor as any)({
      type: 'undirected',
    }) as GraphType;
    graph.forEachNode((node: string) => undirected.addNode(node));
    graph.forEachEdge(
      (
        _edge: string,
        _attrs: Record<string, unknown>,
        source: string,
        target: string,
      ) => {
        if (!undirected.hasEdge(source, target)) {
          undirected.addEdge(source, target);
        }
      },
    );

    // biome-ignore lint/suspicious/noExplicitAny: graphology-communities-louvain ESM/CJS compatibility
    const communities = (louvainFn as any)(undirected) as Record<
      string,
      number
    >;
    const result = new Map<number, GraphNodeData[]>();

    for (const [nodeId, communityId] of Object.entries(communities)) {
      if (!result.has(communityId)) {
        result.set(communityId, []);
      }
      const node = this.nodesCache.get(nodeId);
      if (node) result.get(communityId)?.push(node);
    }

    // Calculate modularity - just return number of communities as proxy
    const modularity = result.size > 0 ? 1 / result.size : 0;

    return {
      communities: result,
      modularity,
      nodeCount: graph.order,
    };
  }

  /**
   * Get importance scores using various centrality measures
   */
  getImportance(): ImportanceResult {
    const graph = this.getGraph();

    // Degree centrality - calculate manually
    const degreeResults: Array<{
      node: GraphNodeData;
      inDegree: number;
      outDegree: number;
      total: number;
    }> = [];

    graph.forEachNode((id: string) => {
      const node = this.nodesCache.get(id);
      if (node) {
        degreeResults.push({
          node,
          inDegree: graph.inDegree(id),
          outDegree: graph.outDegree(id),
          total: graph.degree(id),
        });
      }
    });

    degreeResults.sort((a, b) => b.total - a.total);

    // Simplified betweenness - nodes that appear on many shortest paths
    // For now, use degree as proxy (high-degree nodes tend to be on more paths)
    const betweennessResults = degreeResults.map((r) => ({
      node: r.node,
      score: r.total / (graph.order || 1),
    }));

    // PageRank (simplified - using degree as proxy for now)
    const pageRankResults = degreeResults.map((r) => ({
      node: r.node,
      score: r.total / (graph.order || 1),
    }));

    return {
      pageRank: pageRankResults.slice(0, 20),
      betweenness: betweennessResults.slice(0, 20),
      degree: degreeResults.slice(0, 20),
    };
  }

  /**
   * Find structurally similar nodes (same neighbor patterns)
   */
  findSimilar(nodeId: string, limit = 10): SimilarNode[] {
    const graph = this.getGraph();
    if (!graph.hasNode(nodeId)) return [];

    const neighbors = new Set(graph.neighbors(nodeId));
    const results: SimilarNode[] = [];

    graph.forEachNode((otherId: string) => {
      if (otherId === nodeId) return;

      const otherNeighbors = new Set(graph.neighbors(otherId));
      const intersection = new Set(
        [...neighbors].filter((n) => otherNeighbors.has(n)),
      );
      const union = new Set([...neighbors, ...otherNeighbors]);

      const sharedNeighbors = intersection.size;
      const jaccardSimilarity =
        union.size > 0 ? intersection.size / union.size : 0;

      if (sharedNeighbors > 0) {
        const node = this.nodesCache.get(otherId);
        if (node) {
          results.push({
            node,
            sharedNeighbors,
            jaccardSimilarity,
          });
        }
      }
    });

    return results
      .sort((a, b) => b.jaccardSimilarity - a.jaccardSimilarity)
      .slice(0, limit);
  }

  /**
   * Find semantic gaps - nodes that share keywords but aren't connected
   */
  findSemanticGaps(limit = 20): SemanticGap[] {
    const graph = this.getGraph();
    const gaps: SemanticGap[] = [];

    // Build term index
    const nodeTerms = new Map<string, Set<string>>();
    this.nodesCache.forEach((node, id) => {
      const text = `${node.title} ${node.understanding || ''}`.toLowerCase();
      const terms = new Set(text.split(/\W+/).filter((t) => t.length > 3));
      nodeTerms.set(id, terms);
    });

    // Find pairs with shared terms but no connection
    const nodeIds = Array.from(this.nodesCache.keys());
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const id1 = nodeIds[i];
        const id2 = nodeIds[j];

        const terms1 = nodeTerms.get(id1);
        const terms2 = nodeTerms.get(id2);
        if (!terms1 || !terms2) continue;
        const shared = [...terms1].filter((t) => terms2.has(t));

        if (shared.length >= 2) {
          const connected = graph.hasEdge(id1, id2) || graph.hasEdge(id2, id1);
          if (!connected) {
            const node1 = this.nodesCache.get(id1);
            const node2 = this.nodesCache.get(id2);
            if (node1 && node2) {
              gaps.push({
                node1,
                node2,
                sharedTerms: shared,
                connected: false,
              });
            }
          }
        }
      }
    }

    return gaps
      .sort((a, b) => b.sharedTerms.length - a.sharedTerms.length)
      .slice(0, limit);
  }

  /**
   * Get all nodes and edges (for context building)
   */
  getAll(): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
    const db = getDb();
    const nodeRows = db
      .prepare('SELECT * FROM nodes WHERE active = 1')
      .all() as Record<string, unknown>[];
    const edgeRows = db
      .prepare('SELECT * FROM edges WHERE active = 1')
      .all() as Record<string, unknown>[];

    return {
      nodes: nodeRows.map((r) => this.rowToNode(r)),
      edges: edgeRows.map((r) => this.rowToEdge(r)),
    };
  }

  /**
   * Get all nodes and edges including superseded (inactive) nodes
   * Superseded nodes are those that have an incoming 'supersedes' edge
   */
  getAllWithSuperseded(): {
    nodes: GraphNodeData[];
    edges: GraphEdgeData[];
    supersededNodeIds: Set<string>;
  } {
    const db = getDb();

    // Get all active edges first
    const edgeRows = db
      .prepare('SELECT * FROM edges WHERE active = 1')
      .all() as Record<string, unknown>[];
    const edges = edgeRows.map((r) => this.rowToEdge(r));

    // Find nodes that are superseded (have incoming supersedes edge)
    const supersededNodeIds = new Set(
      edges.filter((e) => e.type === 'supersedes').map((e) => e.toId),
    );

    // Get active nodes
    const activeNodeRows = db
      .prepare('SELECT * FROM nodes WHERE active = 1')
      .all() as Record<string, unknown>[];
    const activeNodes = activeNodeRows.map((r) => this.rowToNode(r));

    // Get inactive nodes that are superseded (they were archived when superseded)
    const supersededIds = Array.from(supersededNodeIds);
    let inactiveSupersededNodes: GraphNodeData[] = [];
    if (supersededIds.length > 0) {
      const placeholders = supersededIds.map(() => '?').join(',');
      const inactiveRows = db
        .prepare(
          `SELECT * FROM nodes WHERE active = 0 AND id IN (${placeholders})`,
        )
        .all(...supersededIds) as Record<string, unknown>[];
      inactiveSupersededNodes = inactiveRows.map((r) => this.rowToNode(r));
    }

    return {
      nodes: [...activeNodes, ...inactiveSupersededNodes],
      edges,
      supersededNodeIds,
    };
  }

  /**
   * Get random nodes for serendipity
   */
  getRandomNodes(count: number): GraphNodeData[] {
    const db = getDb();
    const rows = db
      .prepare(`
      SELECT * FROM nodes WHERE active = 1 ORDER BY RANDOM() LIMIT ?
    `)
      .all(count) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Get random edges for serendipity
   */
  getRandomEdges(count: number): GraphEdgeData[] {
    const db = getDb();
    const rows = db
      .prepare(`
      SELECT * FROM edges WHERE active = 1 ORDER BY RANDOM() LIMIT ?
    `)
      .all(count) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEdge(r));
  }

  /**
   * Question-focused serendipity: pair open questions with random nodes
   * This preserves true randomness while directing it toward receptive targets (questions seeking answers)
   */
  questionSerendipity(
    options: { questionsLimit?: number; randomPerQuestion?: number } = {},
  ): Array<{
    question: GraphNodeData;
    randomNodes: GraphNodeData[];
  }> {
    const { questionsLimit = 5, randomPerQuestion = 3 } = options;
    const db = getDb();

    // Get open questions (nodes with trigger = 'question')
    const questionRows = db
      .prepare(`
      SELECT * FROM nodes
      WHERE active = 1 AND trigger = 'question'
      ORDER BY RANDOM()
      LIMIT ?
    `)
      .all(questionsLimit) as Record<string, unknown>[];

    const questions = questionRows.map((r) => this.rowToNode(r));

    if (questions.length === 0) {
      return [];
    }

    // For each question, get random nodes (excluding the question itself)
    const results: Array<{
      question: GraphNodeData;
      randomNodes: GraphNodeData[];
    }> = [];

    for (const question of questions) {
      const randomRows = db
        .prepare(`
        SELECT * FROM nodes
        WHERE active = 1 AND id != ? AND trigger != 'question'
        ORDER BY RANDOM()
        LIMIT ?
      `)
        .all(question.id, randomPerQuestion) as Record<string, unknown>[];

      const randomNodes = randomRows.map((r) => this.rowToNode(r));

      if (randomNodes.length > 0) {
        results.push({ question, randomNodes });
      }
    }

    return results;
  }

  /**
   * Get supersession chain for a node
   */
  getEvolutionChain(nodeId: string): GraphNodeData[] {
    const db = getDb();
    const chain: GraphNodeData[] = [];
    let currentId: string | null = nodeId;

    // Walk backwards through supersession edges
    while (currentId) {
      const node = this.getNode(currentId);
      if (node) chain.unshift(node);

      // Find what this node supersedes
      const supersedes = db
        .prepare(`
        SELECT to_id FROM edges
        WHERE from_id = ? AND type = 'supersedes' AND active = 1
      `)
        .get(currentId) as { to_id: string } | undefined;

      currentId = supersedes?.to_id || null;
    }

    // Also walk forward to find what supersedes this node
    currentId = nodeId;
    while (currentId) {
      const supersededBy = db
        .prepare(`
        SELECT from_id FROM edges
        WHERE to_id = ? AND type = 'supersedes' AND active = 1
      `)
        .get(currentId) as { from_id: string } | undefined;

      if (supersededBy) {
        const node = this.getNode(supersededBy.from_id);
        if (node) chain.push(node);
        currentId = supersededBy.from_id;
      } else {
        currentId = null;
      }
    }

    return chain;
  }

  /**
   * Suggest potential bridges - nodes that would connect disconnected clusters
   */
  suggestBridges(limit = 10): Array<{
    node1: GraphNodeData;
    node2: GraphNodeData;
    wouldConnect: number;
  }> {
    const graph = this.getGraph();
    const suggestions: Array<{
      node1: GraphNodeData;
      node2: GraphNodeData;
      wouldConnect: number;
    }> = [];

    // Find nodes with no path between them
    const nodeIds = Array.from(this.nodesCache.keys());

    for (let i = 0; i < Math.min(nodeIds.length, 50); i++) {
      for (let j = i + 1; j < Math.min(nodeIds.length, 50); j++) {
        const id1 = nodeIds[i];
        const id2 = nodeIds[j];

        const path = bidirectional(graph, id1, id2);
        if (!path) {
          // These nodes aren't connected - connecting them would bridge clusters
          const node1 = this.nodesCache.get(id1);
          const node2 = this.nodesCache.get(id2);
          if (node1 && node2) {
            suggestions.push({
              node1,
              node2,
              wouldConnect:
                graph.neighbors(id1).length + graph.neighbors(id2).length,
            });
          }
        }
      }
    }

    return suggestions
      .sort((a, b) => b.wouldConnect - a.wouldConnect)
      .slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Embedding and Semantic Search
  // --------------------------------------------------------------------------

  /**
   * Generate and store embedding for a node
   * Call this after creating a node to enable semantic search
   */
  async generateAndStoreEmbedding(nodeId: string): Promise<boolean> {
    const db = getDb();
    const node = this.getNode(nodeId);
    if (!node) return false;

    try {
      const embedding = await generateNodeEmbedding({
        title: node.title,
        understanding: node.understanding,
        why: node.why,
      });

      const buffer = embeddingToBuffer(embedding);
      db.prepare('UPDATE nodes SET embedding = ? WHERE id = ?').run(
        buffer,
        nodeId,
      );
      this.markDirty();
      return true;
    } catch (error) {
      console.error(
        `[GraphStore] Failed to generate embedding for ${nodeId}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Generate embeddings for all nodes that don't have them
   * Returns count of nodes processed
   */
  async backfillEmbeddings(
    onProgress?: (current: number, total: number) => void,
  ): Promise<number> {
    const db = getDb();
    const rows = db
      .prepare(`
      SELECT id FROM nodes WHERE active = 1 AND embedding IS NULL
    `)
      .all() as Array<{ id: string }>;

    let processed = 0;
    for (const row of rows) {
      await this.generateAndStoreEmbedding(row.id);
      processed++;
      if (onProgress) onProgress(processed, rows.length);
    }

    return processed;
  }

  /**
   * Semantic search: find nodes similar to a query string
   */
  async semanticSearch(
    query: string,
    limit = 10,
  ): Promise<SemanticSearchResult[]> {
    const db = getDb();

    // Generate embedding for query
    const queryEmbedding = await generateEmbedding(query);

    // Get all nodes with embeddings
    const rows = db
      .prepare(`
      SELECT * FROM nodes WHERE active = 1 AND embedding IS NOT NULL
    `)
      .all() as Record<string, unknown>[];

    // Score by cosine similarity
    const results: SemanticSearchResult[] = [];
    for (const row of rows) {
      const node = this.rowToNode(row);
      if (node.embedding) {
        const similarity = cosineSimilarity(queryEmbedding, node.embedding);
        results.push({ node, similarity });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results.slice(0, limit);
  }

  /**
   * Find semantic gaps using embedding similarity
   * Finds node pairs that are semantically similar but not connected
   */
  findSemanticGapsWithEmbeddings(
    limit = 20,
    minSimilarity = 0.5,
  ): SemanticGap[] {
    const graph = this.getGraph();
    const gaps: SemanticGap[] = [];

    // Get nodes with embeddings
    const nodesWithEmbeddings = Array.from(this.nodesCache.values()).filter(
      (n) => n.embedding !== null,
    );

    // Compare all pairs
    for (let i = 0; i < nodesWithEmbeddings.length; i++) {
      for (let j = i + 1; j < nodesWithEmbeddings.length; j++) {
        const node1 = nodesWithEmbeddings[i];
        const node2 = nodesWithEmbeddings[j];

        // Skip if already connected
        if (
          graph.hasEdge(node1.id, node2.id) ||
          graph.hasEdge(node2.id, node1.id)
        ) {
          continue;
        }

        // Calculate similarity (embeddings are guaranteed non-null by filter above)
        const emb1 = node1.embedding;
        const emb2 = node2.embedding;
        if (!emb1 || !emb2) continue;
        const similarity = cosineSimilarity(emb1, emb2);

        if (similarity >= minSimilarity) {
          gaps.push({
            node1,
            node2,
            sharedTerms: [], // Not using keyword matching in this version
            embeddingSimilarity: similarity,
            connected: false,
          });
        }
      }
    }

    // Sort by similarity descending
    gaps.sort(
      (a, b) => (b.embeddingSimilarity || 0) - (a.embeddingSimilarity || 0),
    );

    return gaps.slice(0, limit);
  }

  /**
   * Get embedding coverage stats
   */
  getEmbeddingStats(): {
    total: number;
    withEmbedding: number;
    coverage: number;
  } {
    const db = getDb();
    const total = (
      db
        .prepare('SELECT COUNT(*) as count FROM nodes WHERE active = 1')
        .get() as { count: number }
    ).count;
    const withEmbedding = (
      db
        .prepare(
          'SELECT COUNT(*) as count FROM nodes WHERE active = 1 AND embedding IS NOT NULL',
        )
        .get() as { count: number }
    ).count;
    return {
      total,
      withEmbedding,
      coverage: total > 0 ? withEmbedding / total : 0,
    };
  }

  // ==================== Temporal Tracking ====================

  /**
   * Record an access to a node (increments access_count, updates last_accessed)
   */
  recordAccess(nodeId: string): void {
    const db = getDb();
    db.prepare(`
      UPDATE nodes
      SET access_count = COALESCE(access_count, 0) + 1,
          last_accessed = datetime('now')
      WHERE id = ?
    `).run(nodeId);
  }

  /**
   * Record access to multiple nodes at once
   */
  recordAccessBatch(nodeIds: string[]): void {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE nodes
      SET access_count = COALESCE(access_count, 0) + 1,
          last_accessed = datetime('now')
      WHERE id = ?
    `);
    for (const id of nodeIds) {
      stmt.run(id);
    }
  }

  /**
   * Calculate temperature for a node (0-1 scale)
   * Temperature combines recency and frequency of access
   * Higher = hotter (more recently/frequently accessed)
   */
  getNodeTemperature(nodeId: string): number {
    const db = getDb();
    const row = db
      .prepare(`
      SELECT
        access_count,
        last_accessed,
        created_at
      FROM nodes WHERE id = ? AND active = 1
    `)
      .get(nodeId) as
      | {
          access_count: number | null;
          last_accessed: string | null;
          created_at: string;
        }
      | undefined;

    if (!row) return 0;

    const accessCount = row.access_count || 0;
    const lastAccessed = row.last_accessed
      ? new Date(row.last_accessed)
      : new Date(row.created_at);
    const now = new Date();

    // Recency score: exponential decay with half-life of 7 days
    const daysSinceAccess =
      (now.getTime() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
    const halfLifeDays = 7;
    const recencyScore = Math.exp((-daysSinceAccess * Math.LN2) / halfLifeDays);

    // Frequency score: logarithmic scaling (diminishing returns on high access)
    const frequencyScore = Math.log10(accessCount + 1) / Math.log10(100); // Normalized to ~1 at 100 accesses

    // Combined temperature: 70% recency, 30% frequency
    const temperature = 0.7 * recencyScore + 0.3 * Math.min(frequencyScore, 1);

    return Math.round(temperature * 1000) / 1000;
  }

  /**
   * Get all nodes ranked by temperature (hottest first)
   */
  getTemperatureRanking(
    limit = 50,
  ): Array<{ node: GraphNodeData; temperature: number }> {
    const db = getDb();
    const rows = db
      .prepare(`
      SELECT * FROM nodes WHERE active = 1
    `)
      .all() as Record<string, unknown>[];

    const ranked = rows.map((row) => {
      const node = this.rowToNode(row);
      return {
        node,
        temperature: this.getNodeTemperature(node.id),
      };
    });

    ranked.sort((a, b) => b.temperature - a.temperature);
    return ranked.slice(0, limit);
  }

  /**
   * Get cold nodes - least accessed, candidates for serendipity or review
   */
  getColdNodes(limit = 20): Array<{
    node: GraphNodeData;
    temperature: number;
    daysSinceAccess: number;
  }> {
    const db = getDb();
    const rows = db
      .prepare(`
      SELECT *,
        COALESCE(access_count, 0) as access_count,
        COALESCE(last_accessed, created_at) as effective_last_accessed
      FROM nodes
      WHERE active = 1
      ORDER BY access_count ASC, effective_last_accessed ASC
      LIMIT ?
    `)
      .all(limit) as Record<string, unknown>[];

    const now = new Date();
    return rows.map((row) => {
      const node = this.rowToNode(row);
      const lastAccessed =
        (row.last_accessed as string) || (row.created_at as string);
      const daysSinceAccess = Math.round(
        (now.getTime() - new Date(lastAccessed).getTime()) /
          (1000 * 60 * 60 * 24),
      );
      return {
        node,
        temperature: this.getNodeTemperature(node.id),
        daysSinceAccess,
      };
    });
  }

  /**
   * Get hot nodes - most recently/frequently accessed
   */
  getHotNodes(
    limit = 20,
  ): Array<{ node: GraphNodeData; temperature: number; accessCount: number }> {
    const ranked = this.getTemperatureRanking(limit);
    const db = getDb();

    return ranked.map(({ node, temperature }) => {
      const row = db
        .prepare('SELECT access_count FROM nodes WHERE id = ?')
        .get(node.id) as { access_count: number | null } | undefined;
      return {
        node,
        temperature,
        accessCount: row?.access_count || 0,
      };
    });
  }

  /**
   * Get temporal stats for the graph
   */
  getTemporalStats(): {
    totalNodes: number;
    accessedNodes: number;
    neverAccessed: number;
    avgTemperature: number;
    hottestNode: { id: string; name: string; temperature: number } | null;
    coldestNode: { id: string; name: string; temperature: number } | null;
  } {
    const db = getDb();
    const totalNodes = (
      db
        .prepare('SELECT COUNT(*) as count FROM nodes WHERE active = 1')
        .get() as { count: number }
    ).count;
    const accessedNodes = (
      db
        .prepare(
          'SELECT COUNT(*) as count FROM nodes WHERE active = 1 AND access_count > 0',
        )
        .get() as { count: number }
    ).count;

    const ranking = this.getTemperatureRanking(totalNodes);
    const avgTemperature =
      ranking.length > 0
        ? Math.round(
            (ranking.reduce((sum, r) => sum + r.temperature, 0) /
              ranking.length) *
              1000,
          ) / 1000
        : 0;

    const hottest = ranking[0] || null;
    const coldest = ranking[ranking.length - 1] || null;

    return {
      totalNodes,
      accessedNodes,
      neverAccessed: totalNodes - accessedNodes,
      avgTemperature,
      hottestNode: hottest
        ? {
            id: hottest.node.id,
            name: hottest.node.title,
            temperature: hottest.temperature,
          }
        : null,
      coldestNode: coldest
        ? {
            id: coldest.node.id,
            name: coldest.node.title,
            temperature: coldest.temperature,
          }
        : null,
    };
  }

  // ==================== Link Prediction ====================

  /**
   * Get neighbors of a node (both directions)
   */
  private getNeighbors(nodeId: string): Set<string> {
    const db = getDb();
    const outgoing = db
      .prepare(`
      SELECT to_id FROM edges WHERE from_id = ? AND active = 1
    `)
      .all(nodeId) as Array<{ to_id: string }>;
    const incoming = db
      .prepare(`
      SELECT from_id FROM edges WHERE to_id = ? AND active = 1
    `)
      .all(nodeId) as Array<{ from_id: string }>;

    const neighbors = new Set<string>();
    for (const r of outgoing) {
      neighbors.add(r.to_id);
    }
    for (const r of incoming) {
      neighbors.add(r.from_id);
    }
    return neighbors;
  }

  /**
   * Check if two nodes are connected
   */
  private areConnected(nodeId1: string, nodeId2: string): boolean {
    const db = getDb();
    const edge = db
      .prepare(`
      SELECT id FROM edges
      WHERE ((from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?))
      AND active = 1
    `)
      .get(nodeId1, nodeId2, nodeId2, nodeId1);
    return !!edge;
  }

  /**
   * Common Neighbors score - count of shared neighbors
   */
  commonNeighborsScore(nodeId1: string, nodeId2: string): number {
    const neighbors1 = this.getNeighbors(nodeId1);
    const neighbors2 = this.getNeighbors(nodeId2);
    let count = 0;
    neighbors1.forEach((n) => {
      if (neighbors2.has(n)) count++;
    });
    return count;
  }

  /**
   * Jaccard similarity - shared neighbors / total unique neighbors
   */
  jaccardScore(nodeId1: string, nodeId2: string): number {
    const neighbors1 = this.getNeighbors(nodeId1);
    const neighbors2 = this.getNeighbors(nodeId2);

    let intersection = 0;
    neighbors1.forEach((n) => {
      if (neighbors2.has(n)) intersection++;
    });

    const union = new Set([...neighbors1, ...neighbors2]).size;
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Adamic-Adar score - weighted by inverse log degree of shared neighbors
   * Rare shared neighbors count more than common hubs
   */
  adamicAdarScore(nodeId1: string, nodeId2: string): number {
    const neighbors1 = this.getNeighbors(nodeId1);
    const neighbors2 = this.getNeighbors(nodeId2);

    let score = 0;
    neighbors1.forEach((n) => {
      if (neighbors2.has(n)) {
        const neighborDegree = this.getNeighbors(n).size;
        if (neighborDegree > 1) {
          score += 1 / Math.log(neighborDegree);
        }
      }
    });
    return score;
  }

  /**
   * Preferential Attachment score - product of degrees
   * Nodes with many connections tend to form more connections
   */
  preferentialAttachmentScore(nodeId1: string, nodeId2: string): number {
    const degree1 = this.getNeighbors(nodeId1).size;
    const degree2 = this.getNeighbors(nodeId2).size;
    return degree1 * degree2;
  }

  /**
   * Combined link prediction score
   * Normalizes and combines multiple signals
   */
  linkPredictionScore(
    nodeId1: string,
    nodeId2: string,
  ): {
    commonNeighbors: number;
    jaccard: number;
    adamicAdar: number;
    preferentialAttachment: number;
    combined: number;
  } {
    const cn = this.commonNeighborsScore(nodeId1, nodeId2);
    const jac = this.jaccardScore(nodeId1, nodeId2);
    const aa = this.adamicAdarScore(nodeId1, nodeId2);
    const pa = this.preferentialAttachmentScore(nodeId1, nodeId2);

    // Normalize preferential attachment (can be very large)
    const paMax = 400; // Assume max degree ~20 each
    const paNorm = Math.min(pa / paMax, 1);

    // Combined score: weight Adamic-Adar highest (best for novelty)
    const combined =
      0.4 * Math.min(aa / 3, 1) +
      0.3 * jac +
      0.2 * Math.min(cn / 5, 1) +
      0.1 * paNorm;

    return {
      commonNeighbors: cn,
      jaccard: Math.round(jac * 1000) / 1000,
      adamicAdar: Math.round(aa * 1000) / 1000,
      preferentialAttachment: pa,
      combined: Math.round(combined * 1000) / 1000,
    };
  }

  /**
   * Suggest edges to create based on link prediction + embedding similarity
   * Returns pairs that are structurally likely to connect but don't yet have an edge
   */
  async suggestEdges(limit = 20): Promise<
    Array<{
      node1: GraphNodeData;
      node2: GraphNodeData;
      structuralScore: number;
      embeddingScore: number | null;
      noveltyScore: number;
      reason: string;
    }>
  > {
    const db = getDb();
    const nodes = db
      .prepare('SELECT * FROM nodes WHERE active = 1')
      .all() as Record<string, unknown>[];
    const nodeList = nodes.map((r) => this.rowToNode(r));

    // Check embedding coverage
    const embeddingStats = this.getEmbeddingStats();
    const hasEmbeddings = embeddingStats.coverage > 0.5;

    const suggestions: Array<{
      node1: GraphNodeData;
      node2: GraphNodeData;
      structuralScore: number;
      embeddingScore: number | null;
      noveltyScore: number;
      reason: string;
    }> = [];

    // Compare all pairs (O(n²) but n is typically small for understanding graphs)
    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const node1 = nodeList[i];
        const node2 = nodeList[j];

        // Skip if already connected
        if (this.areConnected(node1.id, node2.id)) continue;

        // Calculate structural score
        const linkScore = this.linkPredictionScore(node1.id, node2.id);

        // Skip if no structural signal at all
        if (linkScore.combined < 0.05) continue;

        // Calculate embedding similarity if available
        let embeddingScore: number | null = null;
        if (hasEmbeddings && node1.embedding && node2.embedding) {
          embeddingScore = cosineSimilarity(node1.embedding, node2.embedding);
        }

        // Calculate novelty score
        // High novelty = high embedding distance (surprising connection) + structural support
        let noveltyScore: number;
        let reason: string;

        if (embeddingScore !== null) {
          // Embedding distance (1 - similarity) indicates novelty
          const embeddingDistance = 1 - embeddingScore;

          if (embeddingDistance > 0.5 && linkScore.combined > 0.2) {
            // High novelty: structurally supported but semantically distant
            noveltyScore = 0.6 * embeddingDistance + 0.4 * linkScore.combined;
            reason =
              'Surprising bridge - semantically distant but structurally connected';
          } else if (embeddingScore > 0.6 && linkScore.combined > 0.1) {
            // Low novelty but likely valid: semantically similar with some structure
            noveltyScore = 0.3 * embeddingScore + 0.3 * linkScore.combined;
            reason =
              'Likely valid - semantically similar with structural support';
          } else {
            // Mixed signal
            noveltyScore = 0.5 * linkScore.combined;
            reason = 'Structural pattern suggests connection';
          }
        } else {
          // No embeddings, use structural score only
          noveltyScore = linkScore.combined;
          reason = `Structural: ${linkScore.commonNeighbors} shared neighbors`;
        }

        suggestions.push({
          node1,
          node2,
          structuralScore: linkScore.combined,
          embeddingScore:
            embeddingScore !== null
              ? Math.round(embeddingScore * 1000) / 1000
              : null,
          noveltyScore: Math.round(noveltyScore * 1000) / 1000,
          reason,
        });
      }
    }

    // Sort by novelty score (highest first)
    suggestions.sort((a, b) => b.noveltyScore - a.noveltyScore);

    return suggestions.slice(0, limit);
  }

  /**
   * Get link prediction stats for a specific node
   * Shows what edges this node might want to form
   */
  async suggestEdgesForNode(
    nodeId: string,
    limit = 10,
  ): Promise<
    Array<{
      target: GraphNodeData;
      structuralScore: number;
      embeddingScore: number | null;
      noveltyScore: number;
      reason: string;
    }>
  > {
    const node = this.getNode(nodeId);
    if (!node) return [];

    const db = getDb();
    const otherNodes = db
      .prepare('SELECT * FROM nodes WHERE active = 1 AND id != ?')
      .all(nodeId) as Record<string, unknown>[];

    const embeddingStats = this.getEmbeddingStats();
    const hasEmbeddings = embeddingStats.coverage > 0.5;

    const suggestions: Array<{
      target: GraphNodeData;
      structuralScore: number;
      embeddingScore: number | null;
      noveltyScore: number;
      reason: string;
    }> = [];

    for (const row of otherNodes) {
      const target = this.rowToNode(row);

      // Skip if already connected
      if (this.areConnected(nodeId, target.id)) continue;

      const linkScore = this.linkPredictionScore(nodeId, target.id);
      if (linkScore.combined < 0.05) continue;

      let embeddingScore: number | null = null;
      if (hasEmbeddings && node.embedding && target.embedding) {
        embeddingScore = cosineSimilarity(node.embedding, target.embedding);
      }

      let noveltyScore: number;
      let reason: string;

      if (embeddingScore !== null) {
        const embeddingDistance = 1 - embeddingScore;
        if (embeddingDistance > 0.5 && linkScore.combined > 0.2) {
          noveltyScore = 0.6 * embeddingDistance + 0.4 * linkScore.combined;
          reason = 'Surprising bridge';
        } else if (embeddingScore > 0.6) {
          noveltyScore = 0.3 * embeddingScore + 0.3 * linkScore.combined;
          reason = 'Semantically similar';
        } else {
          noveltyScore = 0.5 * linkScore.combined;
          reason = 'Structural pattern';
        }
      } else {
        noveltyScore = linkScore.combined;
        reason = `${linkScore.commonNeighbors} shared neighbors`;
      }

      suggestions.push({
        target,
        structuralScore: linkScore.combined,
        embeddingScore:
          embeddingScore !== null
            ? Math.round(embeddingScore * 1000) / 1000
            : null,
        noveltyScore: Math.round(noveltyScore * 1000) / 1000,
        reason,
      });
    }

    suggestions.sort((a, b) => b.noveltyScore - a.noveltyScore);
    return suggestions.slice(0, limit);
  }

  // ============================================================================
  // Spreading Activation
  // ============================================================================

  /**
   * Spreading activation from seed nodes
   * Returns nodes ranked by accumulated activation energy
   */
  spreadingActivation(
    seedIds: string[],
    options: {
      decayFactor?: number; // How much activation decays per step (0-1)
      maxSteps?: number; // Maximum hops from seeds
      initialEnergy?: number; // Starting energy at seeds
      temperatureWeighted?: boolean; // Weight by node temperature
    } = {},
  ): Array<{
    node: GraphNodeData;
    activation: number;
    pathLength: number;
    source: string;
  }> {
    const {
      decayFactor = 0.5,
      maxSteps = 3,
      initialEnergy = 1.0,
      temperatureWeighted = true,
    } = options;

    const activation = new Map<
      string,
      { energy: number; pathLength: number; source: string }
    >();

    // Initialize seeds
    for (const seedId of seedIds) {
      const seedNode = this.getNode(seedId);
      if (!seedNode) continue;

      let energy = initialEnergy;
      if (temperatureWeighted) {
        const temp = this.getNodeTemperature(seedId);
        // Cold nodes get boosted (more interesting to activate)
        energy *= 1 + (1 - temp);
      }

      activation.set(seedId, { energy, pathLength: 0, source: seedId });
    }

    // Spread activation
    for (let step = 0; step < maxSteps; step++) {
      const currentNodes = Array.from(activation.entries()).filter(
        ([, data]) => data.pathLength === step,
      );

      for (const [nodeId, data] of currentNodes) {
        const neighbors = this.graph.neighbors(nodeId);
        const spreadEnergy =
          (data.energy * decayFactor) / Math.max(neighbors.length, 1);

        for (const neighborId of neighbors) {
          const existing = activation.get(neighborId);
          const newPathLength = step + 1;

          if (!existing) {
            let neighborEnergy = spreadEnergy;
            if (temperatureWeighted) {
              const temp = this.getNodeTemperature(neighborId);
              neighborEnergy *= 1 + (1 - temp);
            }
            activation.set(neighborId, {
              energy: neighborEnergy,
              pathLength: newPathLength,
              source: data.source,
            });
          } else if (existing.pathLength > newPathLength) {
            // Found shorter path
            existing.energy += spreadEnergy;
            existing.pathLength = newPathLength;
          } else {
            // Accumulate energy from multiple paths
            existing.energy += spreadEnergy * 0.5;
          }
        }
      }
    }

    // Convert to result array (excluding seeds)
    const results: Array<{
      node: GraphNodeData;
      activation: number;
      pathLength: number;
      source: string;
    }> = [];
    for (const [nodeId, data] of activation) {
      if (seedIds.includes(nodeId)) continue;
      const node = this.getNode(nodeId);
      if (node) {
        results.push({
          node,
          activation: Math.round(data.energy * 1000) / 1000,
          pathLength: data.pathLength,
          source: data.source,
        });
      }
    }

    return results.sort((a, b) => b.activation - a.activation);
  }

  // ============================================================================
  // Information Theory Scoring
  // ============================================================================

  /**
   * Compute information gain (surprisal) of connecting two nodes
   * Higher = more surprising/novel connection
   */
  informationGain(
    nodeId1: string,
    nodeId2: string,
  ): {
    structuralSurprisal: number; // How unexpected based on graph structure
    semanticSurprisal: number | null; // How unexpected based on embeddings
    clusterSurprisal: number; // How unexpected based on communities
    combined: number;
  } {
    const node1 = this.getNode(nodeId1);
    const node2 = this.getNode(nodeId2);
    if (!node1 || !node2) {
      return {
        structuralSurprisal: 0,
        semanticSurprisal: null,
        clusterSurprisal: 0,
        combined: 0,
      };
    }

    // Structural surprisal: inverse of link prediction score
    // Low prediction = high surprisal
    const linkScore = this.linkPredictionScore(nodeId1, nodeId2);
    const structuralSurprisal = 1 - linkScore.combined;

    // Semantic surprisal: inverse of embedding similarity
    let semanticSurprisal: number | null = null;
    if (node1.embedding && node2.embedding) {
      const similarity = cosineSimilarity(node1.embedding, node2.embedding);
      semanticSurprisal = 1 - similarity;
    }

    // Cluster surprisal: are they in different communities?
    const communityResult = this.detectCommunities();
    let comm1: number | undefined;
    let comm2: number | undefined;
    for (const [commId, nodes] of communityResult.communities) {
      if (nodes.some((n) => n.id === nodeId1)) comm1 = commId;
      if (nodes.some((n) => n.id === nodeId2)) comm2 = commId;
      if (comm1 !== undefined && comm2 !== undefined) break;
    }
    const clusterSurprisal = comm1 !== comm2 ? 1.0 : 0.0;

    // Combined score
    let combined: number;
    if (semanticSurprisal !== null) {
      // Novel = structurally close but semantically distant
      // This is "surprising bridge" territory
      combined =
        structuralSurprisal * 0.3 +
        semanticSurprisal * 0.4 +
        clusterSurprisal * 0.3;
    } else {
      combined = structuralSurprisal * 0.5 + clusterSurprisal * 0.5;
    }

    return {
      structuralSurprisal: Math.round(structuralSurprisal * 1000) / 1000,
      semanticSurprisal:
        semanticSurprisal !== null
          ? Math.round(semanticSurprisal * 1000) / 1000
          : null,
      clusterSurprisal,
      combined: Math.round(combined * 1000) / 1000,
    };
  }

  // ============================================================================
  // Unified Serendipity Engine
  // ============================================================================

  /**
   * Unified serendipity discovery - combines all algorithms
   * Returns candidate connections ranked by serendipitous potential
   */
  async unifiedSerendipity(
    options: {
      limit?: number;
      seedStrategy?: 'hot' | 'cold' | 'random' | 'bridge' | 'mixed';
      numSeeds?: number;
    } = {},
  ): Promise<
    Array<{
      node1: GraphNodeData;
      node2: GraphNodeData;
      score: number;
      reason: string;
      sources: {
        spreading?: number;
        linkPrediction?: number;
        informationGain?: number;
        semanticGap?: number;
      };
    }>
  > {
    const { limit = 10, seedStrategy = 'mixed', numSeeds = 3 } = options;

    // Step 1: Select seeds based on strategy
    const seeds: string[] = [];
    const { nodes: allNodes } = this.getAll();

    if (allNodes.length < 2) {
      return [];
    }

    switch (seedStrategy) {
      case 'hot': {
        const hot = this.getHotNodes(numSeeds);
        seeds.push(...hot.map((h) => h.node.id));
        break;
      }
      case 'cold': {
        const cold = this.getColdNodes(numSeeds);
        seeds.push(...cold.map((c) => c.node.id));
        break;
      }
      case 'random': {
        const random = this.getRandomNodes(numSeeds);
        seeds.push(...random.map((n) => n.id));
        break;
      }
      case 'bridge': {
        // Select nodes with high betweenness centrality
        const importance = this.getImportance();
        seeds.push(
          ...importance.betweenness.slice(0, numSeeds).map((b) => b.node.id),
        );
        break;
      }
      default: {
        // Mix of strategies: pick from different clusters
        const communityResult = this.detectCommunities();
        const clusterNodeIds: string[][] = [];
        for (const [, nodes] of communityResult.communities) {
          clusterNodeIds.push(nodes.map((n) => n.id));
        }

        if (clusterNodeIds.length >= 2) {
          // Pick from different clusters
          for (let i = 0; i < Math.min(numSeeds, clusterNodeIds.length); i++) {
            const clusterMembers = clusterNodeIds[i];
            const randomIdx = Math.floor(Math.random() * clusterMembers.length);
            seeds.push(clusterMembers[randomIdx]);
          }
        } else {
          // Single cluster - mix hot/cold/random
          const hot = this.getHotNodes(1);
          const cold = this.getColdNodes(1);
          const random = this.getRandomNodes(1);
          if (hot.length) seeds.push(hot[0].node.id);
          if (cold.length && !seeds.includes(cold[0].node.id))
            seeds.push(cold[0].node.id);
          if (random.length && !seeds.includes(random[0].id))
            seeds.push(random[0].id);
        }
        break;
      }
    }

    if (seeds.length === 0) {
      return [];
    }

    // Step 2: Spreading activation from seeds
    const activated = this.spreadingActivation(seeds, {
      decayFactor: 0.6,
      maxSteps: 3,
      temperatureWeighted: true,
    });

    // Step 3: Find candidate pairs
    const candidates = new Map<
      string,
      {
        node1: GraphNodeData;
        node2: GraphNodeData;
        sources: {
          spreading?: number;
          linkPrediction?: number;
          informationGain?: number;
          semanticGap?: number;
        };
      }
    >();

    // Add pairs from spreading activation (activated nodes that aren't connected)
    for (const act of activated.slice(0, 20)) {
      for (const other of activated.slice(0, 20)) {
        if (act.node.id >= other.node.id) continue; // Avoid duplicates
        if (this.graph.hasEdge(act.node.id, other.node.id)) continue;
        if (this.graph.hasEdge(other.node.id, act.node.id)) continue;

        const key = `${act.node.id}:${other.node.id}`;
        if (!candidates.has(key)) {
          candidates.set(key, {
            node1: act.node,
            node2: other.node,
            sources: { spreading: (act.activation + other.activation) / 2 },
          });
        }
      }
    }

    // Add pairs from link prediction
    const linkSuggestions = await this.suggestEdges(15);
    for (const suggestion of linkSuggestions) {
      const key =
        suggestion.node1.id < suggestion.node2.id
          ? `${suggestion.node1.id}:${suggestion.node2.id}`
          : `${suggestion.node2.id}:${suggestion.node1.id}`;

      if (candidates.has(key)) {
        const candidate = candidates.get(key);
        if (candidate) {
          candidate.sources.linkPrediction = suggestion.noveltyScore;
        }
      } else {
        candidates.set(key, {
          node1: suggestion.node1,
          node2: suggestion.node2,
          sources: { linkPrediction: suggestion.noveltyScore },
        });
      }
    }

    // Add pairs from semantic gaps
    const stats = this.getEmbeddingStats();
    if (stats.coverage > 0.5) {
      const gaps = this.findSemanticGapsWithEmbeddings(15);
      for (const gap of gaps) {
        const key =
          gap.node1.id < gap.node2.id
            ? `${gap.node1.id}:${gap.node2.id}`
            : `${gap.node2.id}:${gap.node1.id}`;

        if (candidates.has(key)) {
          const candidate = candidates.get(key);
          if (candidate) {
            candidate.sources.semanticGap = gap.embeddingSimilarity || 0;
          }
        } else {
          candidates.set(key, {
            node1: gap.node1,
            node2: gap.node2,
            sources: { semanticGap: gap.embeddingSimilarity || 0 },
          });
        }
      }
    }

    // Step 4: Score all candidates using information theory
    const scored: Array<{
      node1: GraphNodeData;
      node2: GraphNodeData;
      score: number;
      reason: string;
      sources: {
        spreading?: number;
        linkPrediction?: number;
        informationGain?: number;
        semanticGap?: number;
      };
    }> = [];

    for (const [, candidate] of candidates) {
      const infoGain = this.informationGain(
        candidate.node1.id,
        candidate.node2.id,
      );
      candidate.sources.informationGain = infoGain.combined;

      // Compute final score - weight based on which sources found this pair
      const sourceCount = Object.values(candidate.sources).filter(
        (v) => v !== undefined,
      ).length;
      let score = 0;
      let reason = '';

      if (candidate.sources.spreading) {
        score += candidate.sources.spreading * 0.25;
      }
      if (candidate.sources.linkPrediction) {
        score += candidate.sources.linkPrediction * 0.25;
      }
      if (candidate.sources.semanticGap) {
        score += candidate.sources.semanticGap * 0.25;
      }
      score += infoGain.combined * 0.25;

      // Bonus for being found by multiple algorithms
      score *= 1 + (sourceCount - 1) * 0.2;

      // Determine reason
      if (sourceCount >= 3) {
        reason = 'Multi-signal convergence';
      } else if (infoGain.clusterSurprisal > 0.5) {
        reason = 'Cross-cluster bridge';
      } else if (
        candidate.sources.spreading &&
        candidate.sources.spreading > 0.3
      ) {
        reason = 'Activation collision';
      } else if (
        candidate.sources.semanticGap &&
        candidate.sources.semanticGap > 0.5
      ) {
        reason = 'Semantic similarity';
      } else {
        reason = 'Structural affinity';
      }

      scored.push({
        node1: candidate.node1,
        node2: candidate.node2,
        score: Math.round(score * 1000) / 1000,
        reason,
        sources: candidate.sources,
      });
    }

    // Sort by score and return top results
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // ============================================================================
  // Document Structure Methods
  // ============================================================================

  /**
   * Get all document root nodes (nodes with isDocRoot = true)
   */
  getDocumentRoots(): GraphNodeData[] {
    const db = getDb();
    const rows = db
      .prepare(`
        SELECT * FROM nodes WHERE active = 1 AND is_doc_root = 1
        ORDER BY created_at DESC
      `)
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Get child nodes of a parent via "contains" edges
   * Returns children in order based on their position in "next" chains within the parent
   */
  getChildren(parentId: string): GraphNodeData[] {
    const db = getDb();

    // Get all nodes that this parent contains
    const childRows = db
      .prepare(`
        SELECT n.* FROM nodes n
        JOIN edges e ON n.id = e.to_id
        WHERE e.from_id = ? AND e.type = 'contains' AND e.active = 1 AND n.active = 1
      `)
      .all(parentId) as Record<string, unknown>[];

    const children = childRows.map((r) => this.rowToNode(r));

    if (children.length <= 1) return children;

    // Order children by following "next" chains within the parent
    // Find child that has no "next" pointing TO it (the first in sequence)
    const _childIds = new Set(children.map((c) => c.id));
    const nextTargets = new Set<string>();

    const nextEdges = db
      .prepare(`
        SELECT from_id, to_id FROM edges
        WHERE type = 'next' AND active = 1
        AND from_id IN (${children.map(() => '?').join(',')})
        AND to_id IN (${children.map(() => '?').join(',')})
      `)
      .all(
        ...children.map((c) => c.id),
        ...children.map((c) => c.id),
      ) as Array<{
      from_id: string;
      to_id: string;
    }>;

    // Build next-pointer map and find targets
    const nextMap = new Map<string, string>();
    for (const edge of nextEdges) {
      nextMap.set(edge.from_id, edge.to_id);
      nextTargets.add(edge.to_id);
    }

    // Find first child (not a target of any next edge)
    let firstId: string | null = null;
    for (const child of children) {
      if (!nextTargets.has(child.id)) {
        firstId = child.id;
        break;
      }
    }

    if (!firstId) {
      // No clear first - just return unordered
      return children;
    }

    // Follow the chain
    const ordered: GraphNodeData[] = [];
    const childMap = new Map(children.map((c) => [c.id, c]));
    let currentId: string | null = firstId;

    while (currentId && childMap.has(currentId)) {
      const child = childMap.get(currentId);
      if (child) {
        ordered.push(child);
        childMap.delete(currentId); // Prevent cycles
      }
      currentId = nextMap.get(currentId) || null;
    }

    // Add any remaining children that weren't in the chain
    for (const remaining of childMap.values()) {
      ordered.push(remaining);
    }

    return ordered;
  }

  /**
   * Get the next-chain starting from a given node
   * Follows "next" edges until no more are found
   */
  getNextChain(startId: string): GraphNodeData[] {
    const db = getDb();
    const chain: GraphNodeData[] = [];

    const startNode = this.getNode(startId);
    if (!startNode) return chain;

    chain.push(startNode);

    let currentId = startId;
    const visited = new Set<string>([currentId]);

    while (true) {
      const nextEdge = db
        .prepare(`
          SELECT to_id FROM edges
          WHERE from_id = ? AND type = 'next' AND active = 1
        `)
        .get(currentId) as { to_id: string } | undefined;

      if (!nextEdge || visited.has(nextEdge.to_id)) break;

      const nextNode = this.getNode(nextEdge.to_id);
      if (!nextNode) break;

      chain.push(nextNode);
      visited.add(nextEdge.to_id);
      currentId = nextEdge.to_id;
    }

    return chain;
  }

  /**
   * Get the full document tree starting from a root
   * Returns a nested structure with children
   */
  getDocumentTree(rootId: string, maxDepth = 10): DocumentTreeNode | null {
    const node = this.getNode(rootId);
    if (!node) return null;

    const buildTree = (
      nodeId: string,
      depth: number,
    ): DocumentTreeNode | null => {
      const n = this.getNode(nodeId);
      if (!n || depth > maxDepth) return null;

      const children = this.getChildren(nodeId);
      return {
        node: n,
        children: children
          .map((child) => buildTree(child.id, depth + 1))
          .filter((c): c is DocumentTreeNode => c !== null),
      };
    };

    return buildTree(rootId, 0);
  }

  /**
   * Get concepts that a document node expresses (linked via "expresses" edges)
   */
  getExpressedConcepts(nodeId: string): GraphNodeData[] {
    const db = getDb();
    const rows = db
      .prepare(`
        SELECT n.* FROM nodes n
        JOIN edges e ON n.id = e.to_id
        WHERE e.from_id = ? AND e.type = 'expresses' AND e.active = 1 AND n.active = 1
      `)
      .all(nodeId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Get document nodes that express a given concept (reverse lookup)
   */
  getExpressingDocuments(conceptId: string): GraphNodeData[] {
    const db = getDb();
    const rows = db
      .prepare(`
        SELECT n.* FROM nodes n
        JOIN edges e ON n.id = e.from_id
        WHERE e.to_id = ? AND e.type = 'expresses' AND e.active = 1 AND n.active = 1
      `)
      .all(conceptId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToNode(r));
  }

  /**
   * Get the parent of a document node (via "contains" edge where this node is the target)
   */
  getParent(nodeId: string): GraphNodeData | null {
    const db = getDb();
    const edge = db
      .prepare(`
        SELECT from_id FROM edges
        WHERE to_id = ? AND type = 'contains' AND active = 1
      `)
      .get(nodeId) as { from_id: string } | undefined;

    if (!edge) return null;
    return this.getNode(edge.from_id);
  }

  /**
   * Get the path from a document root to a specific node
   * Returns array from root to node, or null if not found
   */
  getDocumentPath(nodeId: string): GraphNodeData[] | null {
    const path: GraphNodeData[] = [];
    let currentId: string | null = nodeId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      const node = this.getNode(currentId);
      if (!node) return null;

      path.unshift(node);
      visited.add(currentId);

      if (node.isDocRoot) {
        return path;
      }

      const parent = this.getParent(currentId);
      currentId = parent?.id || null;
    }

    return null; // No root found
  }

  /**
   * Create a document node with proper structure
   * Convenience method that sets up the node with document fields
   */
  createDocumentNode(input: {
    title: string;
    content: string;
    summary?: string;
    level?: string;
    isDocRoot?: boolean;
    fileType?: string; // File extension for generation (e.g., 'md', 'py', 'txt')
    trigger?: TriggerType; // Trigger type (e.g., 'thinking', 'foundation')
    parentId?: string; // If provided, creates "contains" edge from parent
    afterId?: string; // If provided, creates "next" edge from this node
    expressesIds?: string[]; // Concept IDs this node expresses
    conversationId?: string; // Optional - only set if session is active
    toolCallId?: number | null;
  }): GraphNodeData & { seq: number } {
    // Validate document hierarchy requirement
    if (!input.isDocRoot && !input.parentId) {
      throw new Error(
        'Document node must either be a root (isDocRoot: true) or have a parentId. ' +
          'Orphan document nodes are not allowed.',
      );
    }

    // If parentId provided, verify it exists
    if (input.parentId) {
      const parent = this.getNode(input.parentId);
      if (!parent) {
        throw new Error(`Parent node not found: ${input.parentId}`);
      }
    }

    // Create the node
    const node = this.createNode({
      title: input.title,
      trigger: input.trigger || 'foundation',
      why: 'Document node',
      understanding:
        input.summary || input.content?.slice(0, 200) || input.title,
      content: input.content,
      summary: input.summary,
      level: input.level,
      isDocRoot: input.isDocRoot,
      fileType: input.fileType,
      conversationId: input.conversationId,
      toolCallId: input.toolCallId,
    });

    // Create contains edge if parent specified
    if (input.parentId) {
      const parent = this.getNode(input.parentId);
      this.createEdge({
        fromId: input.parentId,
        toId: node.id,
        type: 'contains',
        explanation: `Contains ${input.level || 'content'}`,
        why: `"${parent?.title || 'Parent'}" contains "${node.title}" as a ${input.level || 'child'} element in the document structure`,
        conversationId: input.conversationId,
        toolCallId: input.toolCallId,
      });
    }

    // Create next edge if afterId specified
    if (input.afterId) {
      const prev = this.getNode(input.afterId);
      this.createEdge({
        fromId: input.afterId,
        toId: node.id,
        type: 'next',
        explanation: 'Sequence',
        why: `"${node.title}" follows "${prev?.title || 'Previous'}" in the reading order of the document`,
        conversationId: input.conversationId,
        toolCallId: input.toolCallId,
      });
    }

    // Create expresses edges for linked concepts
    if (input.expressesIds) {
      for (const conceptId of input.expressesIds) {
        const concept = this.getNode(conceptId);
        this.createEdge({
          fromId: node.id,
          toId: conceptId,
          type: 'expresses',
          explanation: 'Expresses concept',
          why: `This document section discusses or elaborates on the concept "${concept?.title || conceptId}"`,
          conversationId: input.conversationId,
          toolCallId: input.toolCallId,
        });
      }
    }

    return node;
  }

  /**
   * Flatten a document tree into a linear sequence for rendering
   * Uses depth-first traversal, respecting next-chains at each level
   */
  flattenDocument(
    rootId: string,
  ): Array<{ node: GraphNodeData; depth: number }> {
    const result: Array<{ node: GraphNodeData; depth: number }> = [];
    const visited = new Set<string>();
    const MAX_DEPTH = 50;

    const traverse = (nodeId: string, depth: number) => {
      // Prevent infinite recursion from cycles or excessive depth
      if (visited.has(nodeId) || depth > MAX_DEPTH) return;
      visited.add(nodeId);

      const node = this.getNode(nodeId);
      if (!node) return;

      result.push({ node, depth });

      // Get ordered children and traverse each
      const children = this.getChildren(nodeId);
      for (const child of children) {
        traverse(child.id, depth + 1);
      }
    };

    traverse(rootId, 0);
    return result;
  }

  // ============================================================================
  // Reference Resolution
  // ============================================================================

  /**
   * Resolve soft references in text.
   * Syntax: {{type:id_or_name}}
   * Types: char, character, story, place, concept, node (generic)
   *
   * Examples:
   *   {{char:n_abc123}} -> "Kael Thornwood"
   *   {{char:Kael}} -> "Kael Thornwood" (by name)
   *   {{concept:Authentication}} -> "Authentication"
   *   {{node:n_xyz}} -> resolves any node by ID
   */
  resolveReferences(text: string): string {
    if (!text) return text;

    // Pattern: {{type:reference}}
    const pattern =
      /\{\{(char|character|story|place|concept|node):([^}]+)\}\}/g;

    return text.replace(pattern, (match, _type, ref) => {
      const trimmedRef = ref.trim();

      // Try to find the node
      let node: GraphNodeData | null = null;

      // First try by ID
      if (trimmedRef.startsWith('n_')) {
        node = this.getNode(trimmedRef);
      }

      // If not found by ID, try by name
      if (!node) {
        node = this.getNodeByName(trimmedRef);
      }

      // If still not found, return original placeholder
      if (!node) {
        console.warn(`Reference not found: ${match}`);
        return match;
      }

      // Return the node's current name
      return node.title;
    });
  }

  /**
   * Find a node by its title/name field
   */
  getNodeByName(name: string): GraphNodeData | null {
    for (const node of this.nodesCache.values()) {
      if (node.active && node.title === name) {
        return node;
      }
    }
    return null;
  }

  /**
   * Rename a node (update its title field)
   * Returns the updated node or null if not found
   */
  renameNode(nodeId: string, newName: string): GraphNodeData | null {
    const db = getDb();
    const node = this.getNode(nodeId);

    if (!node) {
      return null;
    }

    const now = new Date().toISOString();

    const oldName = node.title;

    db.prepare(`
      UPDATE nodes
      SET title = ?, updated_at = ?
      WHERE id = ?
    `).run(newName, now, nodeId);

    // Update cache
    node.title = newName;
    node.updatedAt = now;

    logEvent(
      'revised',
      'node',
      nodeId,
      null,
      `Renamed from "${oldName}" to "${newName}"`,
      {
        oldName,
        newName,
      },
    );

    return node;
  }
}

// Singleton instance
let graphStoreInstance: GraphStore | null = null;

export function getGraphStore(): GraphStore {
  if (!graphStoreInstance) {
    graphStoreInstance = new GraphStore();
  }
  return graphStoreInstance;
}

export function resetGraphStore(): void {
  graphStoreInstance = null;
}

// ============================================================================
// Cross-Project Access (Deprecated - Use sqlite.ts functions directly)
// ============================================================================

/**
 * @deprecated Use sqlite.globalNodeLookup, sqlite.queryNodes, etc. instead.
 * All databases are now loaded in memory at startup.
 */
export class ExternalGraphStore {
  readonly projectId: string;

  constructor(_dbPath: string, projectId: string) {
    console.warn(
      'ExternalGraphStore is deprecated. Use sqlite.ts cross-project functions instead.',
    );
    this.projectId = projectId;
  }

  // Stub methods for backwards compatibility - these throw errors
  getNode(_id: string): GraphNodeData | null {
    throw new Error(
      'ExternalGraphStore is deprecated. Use sqlite.lookupExternalNode() instead.',
    );
  }

  getAll(): { nodes: GraphNodeData[]; edges: GraphEdgeData[] } {
    throw new Error(
      'ExternalGraphStore is deprecated. Use sqlite.listExternalNodes() instead.',
    );
  }

  close(): void {
    // No-op - databases are managed by sqlite.ts
  }
}

/**
 * @deprecated Use sqlite.isProjectLoaded() and sqlite.* functions instead.
 */
export function getExternalGraphStore(
  _projectsDir: string,
  projectId: string,
): ExternalGraphStore | null {
  console.warn(
    'getExternalGraphStore is deprecated. Use sqlite.* cross-project functions instead.',
  );
  return new ExternalGraphStore('', projectId);
}
