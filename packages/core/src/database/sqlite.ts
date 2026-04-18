import fs from 'node:fs';
import path from 'node:path';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { analyzeGraph } from '../services/AnalysisService.js';
import type {
  Conversation,
  Document,
  EventLogEntry,
  ToolCall,
} from '../types/index.js';

// All project databases in memory
const databases = new Map<string, DatabaseType>();
let projectsDir: string | null = null;
let currentProjectId: string | null = null;

/**
 * Initialize all databases from a projects directory.
 * Call this once at startup to load all projects into memory.
 */
export function initAllDatabases(projectsDirPath: string): void {
  projectsDir = projectsDirPath;

  if (!fs.existsSync(projectsDirPath)) {
    fs.mkdirSync(projectsDirPath, { recursive: true });
    return;
  }

  for (const name of fs.readdirSync(projectsDirPath)) {
    const projectPath = path.join(projectsDirPath, name);
    if (fs.statSync(projectPath).isDirectory()) {
      const dbPath = path.join(projectPath, 'store.db');
      if (fs.existsSync(dbPath)) {
        initDatabase(projectPath);
      }
    }
  }
}

/**
 * Get all loaded databases.
 */
export function getAllDatabases(): Map<string, DatabaseType> {
  return databases;
}

/**
 * Get the projects directory path.
 */
export function getProjectsDir(): string | null {
  return projectsDir;
}

/**
 * Get the current project ID.
 */
export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

/**
 * Set the current project (for write operations).
 */
export function setCurrentProject(projectId: string): void {
  if (!databases.has(projectId)) {
    throw new Error(`Project not loaded: ${projectId}`);
  }
  currentProjectId = projectId;
}

// Initialize SQLite for a specific project.
//
// IDEMPOTENT: if a connection for this project already exists in the
// `databases` Map, return it instead of opening a new one. The earlier
// version unconditionally created `new Database(dbPath)` on every call,
// which orphaned the old connection (still alive, still holding any file
// locks) and put a fresh connection in the Map. Two open connections to
// the same SQLite file in journal mode produced "database is locked"
// errors on writes — most visibly, INSIDE graph_batch's BEGIN/COMMIT
// transaction wrapper, where the inner createNode call was hitting a
// different connection than the outer txnDb. This broke the v0.1.2
// atomicity guarantee in production despite the in-process vitest test
// passing.
//
// The duplicate-init pattern was triggered by ContextManager's
// initializeContext, which calls initDatabase whenever a project context
// needs to be (re)initialized — even for projects that the MCP server's
// start() had already loaded via initAllDatabases.
export function initDatabase(projectPath: string): DatabaseType {
  const dbPath = path.join(projectPath, 'store.db');
  const projectId = path.basename(projectPath);

  // Ensure project directory exists
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true });
  }

  // Reuse an existing connection rather than orphaning it.
  const existing = databases.get(projectId);
  if (existing) {
    currentProjectId = projectId;
    return existing;
  }

  const db = new Database(dbPath);
  databases.set(projectId, db);

  // Always set as current when initializing
  // (switchProject relies on this behavior)
  currentProjectId = projectId;

  // Create tables
  db.exec(`
    -- Conversations: user queries and AI responses
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      response TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      metadata TEXT
    );

    -- Document metadata (actual files in documents/ folder)
    CREATE TABLE IF NOT EXISTS documents (
      hash TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now')),
      conversation_id TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Project metadata
    CREATE TABLE IF NOT EXISTS project_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Chat History (Mirrors swarm_history.db schema)
    CREATE TABLE IF NOT EXISTS chat_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT,    -- User, Assistant, System
      event TEXT,    -- message, tool_call, tool_result, thought
      content TEXT,  -- The actual text/payload
      metadata TEXT, -- JSON metadata
      timestamp TEXT DEFAULT (datetime('now'))
    );

    -- Event log: chronological record of all graph mutations
    CREATE TABLE IF NOT EXISTS event_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT DEFAULT (datetime('now')),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      conversation_id TEXT,
      summary TEXT,
      details TEXT,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Graph nodes
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      trigger TEXT,
      why TEXT,
      understanding TEXT,
      source_elements TEXT,
      validated INTEGER,
      active INTEGER DEFAULT 1,
      version INTEGER DEFAULT 1,
      revisions TEXT DEFAULT '[]',
      conversation_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      archived_at TEXT,
      archive_reason TEXT,
      "references" TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Graph edges
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      type TEXT DEFAULT 'relates',
      explanation TEXT,
      why TEXT,
      active INTEGER DEFAULT 1,
      version INTEGER DEFAULT 1,
      revisions TEXT DEFAULT '[]',
      conversation_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY (from_id) REFERENCES nodes(id),
      FOREIGN KEY (to_id) REFERENCES nodes(id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );

    -- Tool calls: auto-logged MCP tool invocations
    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      arguments TEXT,
      result TEXT,
      error TEXT,
      duration_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES conversations(id)
    );

    -- Add tool_call_id to nodes if not exists (for traceability)
    -- SQLite doesn't support ADD COLUMN IF NOT EXISTS, so we handle this separately

    -- Create indexes for fast lookups
    CREATE INDEX IF NOT EXISTS idx_documents_name ON documents(original_name);
    CREATE INDEX IF NOT EXISTS idx_event_log_entity ON event_log(entity_id);
    CREATE INDEX IF NOT EXISTS idx_event_log_timestamp ON event_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_nodes_trigger ON nodes(trigger);
    CREATE INDEX IF NOT EXISTS idx_nodes_active ON nodes(active);
    CREATE INDEX IF NOT EXISTS idx_nodes_conversation ON nodes(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(type);
    CREATE INDEX IF NOT EXISTS idx_edges_active ON edges(active);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_tool ON tool_calls(tool_name);

    -- Parliament of Minds: Agent Registry
    CREATE TABLE IF NOT EXISTS solvers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,          -- 'creative', 'validation', 'executive'
      manifest TEXT NOT NULL,      -- The System Prompt / Persona
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Parliament of Minds: Work Queue
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      solver_id TEXT NOT NULL,     -- Assigned Agent
      input_payload TEXT NOT NULL, -- JSON: The Task Data
      output_payload TEXT,         -- JSON: The Result
      status TEXT DEFAULT 'pending', -- pending, processing, completed, failed, blocked
      accept_spec TEXT,            -- JSON: Validation Criteria
      parent_task_id TEXT,         -- For recursive decomposition
      depth INTEGER DEFAULT 0,     -- Recursion depth (max 3)
      session_id TEXT,             -- Links to conversation for audit trail
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      FOREIGN KEY(solver_id) REFERENCES solvers(id),
      FOREIGN KEY(parent_task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_solver ON tasks(solver_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
    CREATE INDEX IF NOT EXISTS idx_solvers_name ON solvers(name);

    -- Legal System: Enforcement Log (Traffic Light results)
    CREATE TABLE IF NOT EXISTS enforcement_log (
      id TEXT PRIMARY KEY,
      target_id TEXT NOT NULL,           -- Node being evaluated
      light TEXT NOT NULL,               -- RED, YELLOW, GREEN
      pure_json TEXT NOT NULL,           -- Full PURE evaluation JSON
      enforcer_id TEXT,                  -- Which solver enforced
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(target_id) REFERENCES nodes(id)
    );

    -- Legal System: Solver Feedback (Learning from rejection)
    CREATE TABLE IF NOT EXISTS solver_feedback (
      id TEXT PRIMARY KEY,
      solver_id TEXT NOT NULL,
      task_id TEXT,                      -- Optional: which task triggered feedback
      feedback_type TEXT NOT NULL,       -- rejection, improvement, pattern
      content TEXT NOT NULL,             -- The feedback content
      failed_gate TEXT,                  -- Which PURE gate failed (if applicable)
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY(solver_id) REFERENCES solvers(id),
      FOREIGN KEY(task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_enforcement_target ON enforcement_log(target_id);
    CREATE INDEX IF NOT EXISTS idx_enforcement_light ON enforcement_log(light);
    CREATE INDEX IF NOT EXISTS idx_feedback_solver ON solver_feedback(solver_id);

    -- Resource Locking: Enables parallel agent work
    CREATE TABLE IF NOT EXISTS resource_locks (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,         -- Node ID being locked
      resource_type TEXT DEFAULT 'node', -- 'node', 'subtree', 'file'
      holder_id TEXT NOT NULL,           -- Session ID or agent name
      holder_type TEXT DEFAULT 'session', -- 'session', 'agent', 'worker'
      lock_type TEXT DEFAULT 'exclusive', -- 'exclusive' (write) or 'shared' (read)
      scope TEXT DEFAULT 'node',         -- 'node' (just this), 'subtree' (+ children)
      acquired_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,          -- Auto-release time
      reason TEXT,                       -- Why this lock was acquired
      UNIQUE(resource_id, holder_id)     -- One lock per resource per holder
    );

    CREATE INDEX IF NOT EXISTS idx_locks_resource ON resource_locks(resource_id);
    CREATE INDEX IF NOT EXISTS idx_locks_holder ON resource_locks(holder_id);
    CREATE INDEX IF NOT EXISTS idx_locks_expires ON resource_locks(expires_at);

    -- Text Sources: Staged content for chronological reading
    CREATE TABLE IF NOT EXISTS text_sources (
      id TEXT PRIMARY KEY,                 -- Source ID (src_xxx)
      title TEXT NOT NULL,                 -- Source title
      source_type TEXT,                    -- "book", "paper", "article", "code", etc.
      content TEXT NOT NULL,               -- Full text content
      position INTEGER DEFAULT 0,          -- Current read position (char offset)
      total_length INTEGER,                -- Total content length
      project_id TEXT,                     -- Associated project
      root_node_id TEXT,                   -- Graph node for this source (once created)
      last_committed_node_id TEXT,         -- Last document node committed (for chain continuation)
      status TEXT DEFAULT 'pending',       -- pending, reading, completed
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_text_sources_project ON text_sources(project_id);
    CREATE INDEX IF NOT EXISTS idx_text_sources_status ON text_sources(status);

    -- Commits: Atomic batches of graph changes with human-readable messages
    -- "Git for Cognition" - tracks changes to belief structures
    -- agent_name is the tool that wrote the commit (e.g. "claude-code").
    -- author is the human (or human-facing handle) responsible — hosts
    -- that multiplex many users onto one engine set this per-request so
    -- commits can be attributed properly.
    CREATE TABLE IF NOT EXISTS commits (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      agent_name TEXT,
      author TEXT,
      node_ids TEXT DEFAULT '[]',
      edge_ids TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_commits_created ON commits(created_at);
  `);

  // Migrate older databases that predate the `author` column. SQLite's
  // ALTER TABLE ADD COLUMN is idempotent-via-check only; swallow the
  // duplicate-column error if this DB is already current.
  try {
    db.exec(`ALTER TABLE commits ADD COLUMN author TEXT`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(msg)) throw err;
  }

  // Create FTS5 virtual table for full-text search on nodes
  // Using IF NOT EXISTS pattern for FTS5
  try {
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
          id,
          title,
          understanding,
          content='nodes',
          content_rowid='rowid'
        );
      `);
  } catch {
    // FTS table already exists
  }

  // Create triggers to keep FTS index in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
      INSERT INTO nodes_fts(rowid, id, title, understanding)
      VALUES (NEW.rowid, NEW.id, NEW.title, NEW.understanding);
    END;

    CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
      INSERT INTO nodes_fts(nodes_fts, rowid, id, title, understanding)
      VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.understanding);
    END;

    CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
      INSERT INTO nodes_fts(nodes_fts, rowid, id, title, understanding)
      VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.understanding);
      INSERT INTO nodes_fts(rowid, id, title, understanding)
      VALUES (NEW.rowid, NEW.id, NEW.title, NEW.understanding);
    END;
  `);

  // Migration: Add tool_call_id columns if they don't exist
  try {
    db.exec(
      `ALTER TABLE nodes ADD COLUMN tool_call_id INTEGER REFERENCES tool_calls(id)`,
    );
  } catch {
    // Column already exists
  }
  try {
    db.exec(
      `ALTER TABLE edges ADD COLUMN tool_call_id INTEGER REFERENCES tool_calls(id)`,
    );
  } catch {
    // Column already exists
  }
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_nodes_tool_call ON nodes(tool_call_id)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_edges_tool_call ON edges(tool_call_id)`,
    );
  } catch {
    // Index already exists
  }

  // Migration: Add embedding column for semantic search
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN embedding BLOB`);
  } catch {
    // Column already exists
  }

  // Migration: Add temporal tracking columns for memory decay
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN last_accessed TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN access_count INTEGER DEFAULT 0`);
  } catch {
    // Column already exists
  }

  // Migration: Add document fields for document data structure
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN content TEXT`);
  } catch {
    // Column already exists
  }
  // Migration: Rename prose → content (for existing databases)
  try {
    db.exec(`ALTER TABLE nodes RENAME COLUMN prose TO content`);
  } catch {
    // Column doesn't exist or already renamed
  }
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN summary TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN level TEXT`);
  } catch {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN is_doc_root INTEGER`);
  } catch {
    // Column already exists
  }
  // Index for finding document roots
  try {
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_nodes_doc_root ON nodes(is_doc_root) WHERE is_doc_root = 1`,
    );
  } catch {
    // Index already exists
  }
  // Index for document level hierarchy
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_level ON nodes(level)`);
  } catch {
    // Index already exists
  }

  // Migration: Add file_type for document generation
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN file_type TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: Add references for external sources
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN references TEXT DEFAULT '[]'`);
  } catch {
    // Column already exists
  }

  // Migration: Add flexible metadata field for modules (narrative-engine, etc.)
  try {
    db.exec(`ALTER TABLE nodes ADD COLUMN metadata TEXT DEFAULT '{}'`);
  } catch {
    // Column already exists
  }

  // Migration: Add session_id to tasks for agent session tracking
  try {
    db.exec(`ALTER TABLE tasks ADD COLUMN session_id TEXT`);
  } catch {
    // Column already exists
  }

  // Migration: Add commit_id to nodes for "Git for Cognition" tracking
  try {
    db.exec(
      `ALTER TABLE nodes ADD COLUMN commit_id TEXT REFERENCES commits(id)`,
    );
  } catch {
    // Column already exists
  }

  // Migration: Add commit_id to edges for "Git for Cognition" tracking
  try {
    db.exec(
      `ALTER TABLE edges ADD COLUMN commit_id TEXT REFERENCES commits(id)`,
    );
  } catch {
    // Column already exists
  }

  // Index for commit lookups
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nodes_commit ON nodes(commit_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_edges_commit ON edges(commit_id)`);
  } catch {
    // Index already exists
  }

  return db;
}

/**
 * Get database for a specific project.
 * If no projectId provided, returns current project's database.
 */
export function getDb(projectId?: string): DatabaseType {
  const id = projectId ?? currentProjectId;
  if (!id) {
    throw new Error(
      'No active project. Call the project_switch tool with a projectId (e.g. project_switch({ projectId: "default" })) before mutating the graph. If the project does not exist yet, project_switch creates it on first use.',
    );
  }
  const db = databases.get(id);
  if (!db) {
    throw new Error(
      `Project "${id}" exists but its database is not loaded yet. Call project_switch({ projectId: "${id}" }) to load it.`,
    );
  }
  return db;
}

/**
 * Get project path for current project.
 * @deprecated Use getProjectsDir() + projectId instead
 */
export function getProjectPath(): string | null {
  if (!projectsDir || !currentProjectId) return null;
  return path.join(projectsDir, currentProjectId);
}

/**
 * Close all databases.
 */
export function closeAllDatabases(): void {
  for (const [, db] of databases) {
    db.close();
  }
  databases.clear();
  currentProjectId = null;
}

/**
 * Close a specific database.
 * @deprecated Use closeAllDatabases for cleanup
 */
export function closeDatabase(): void {
  closeAllDatabases();
}

/**
 * Find a node by ID across all projects.
 * Returns the node and which project it's in.
 */
export function globalNodeLookup(
  nodeId: string,
): { node: ExternalNodeData; projectId: string } | null {
  for (const [projectId, db] of databases) {
    const row = db
      .prepare(
        'SELECT id, title, trigger, why, understanding, content, "references", created_at FROM nodes WHERE id = ? AND active = 1',
      )
      .get(nodeId) as Record<string, unknown> | undefined;

    if (row) {
      return {
        projectId,
        node: {
          id: row.id as string,
          title: row.title as string,
          trigger: (row.trigger as string) || null,
          why: (row.why as string) || null,
          understanding: (row.understanding as string) || null,
          content: (row.content as string) || null,
          references: row.references
            ? JSON.parse(row.references as string)
            : null,
          createdAt: row.created_at as string,
          project: projectId,
        },
      };
    }
  }
  return null;
}

// Cross-project node lookup (read-only, doesn't affect current project)
export interface ExternalNodeData {
  id: string;
  title: string;
  trigger: string | null;
  why: string | null;
  understanding: string | null;
  content: string | null;
  references: Array<{
    url?: string;
    title?: string;
    project?: string;
    nodeId?: string;
  }> | null;
  createdAt: string;
  project: string;
}

/**
 * Look up a node from a specific project (uses in-memory database).
 * @deprecated projectsDir parameter is ignored - uses loaded databases
 */
export function lookupExternalNode(
  _projectsDir: string,
  projectId: string,
  nodeId: string,
): ExternalNodeData | null {
  const db = databases.get(projectId);
  if (!db) {
    return null;
  }

  const row = db
    .prepare(
      'SELECT id, title, trigger, why, understanding, content, "references", created_at FROM nodes WHERE id = ?',
    )
    .get(nodeId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id as string,
    title: row.title as string,
    trigger: (row.trigger as string) || null,
    why: (row.why as string) || null,
    understanding: (row.understanding as string) || null,
    content: (row.content as string) || null,
    references: row.references ? JSON.parse(row.references as string) : null,
    createdAt: row.created_at as string,
    project: projectId,
  };
}

/**
 * List nodes from a specific project (uses in-memory database).
 * @deprecated projectsDir parameter is ignored - uses loaded databases
 */
export function listExternalNodes(
  _projectsDir: string,
  projectId: string,
  limit = 50,
): ExternalNodeData[] {
  const db = databases.get(projectId);
  if (!db) {
    return [];
  }

  const rows = db
    .prepare(`
      SELECT id, title, trigger, why, understanding, content, "references", created_at
      FROM nodes
      WHERE archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT ?
    `)
    .all(limit) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    trigger: (row.trigger as string) || null,
    why: (row.why as string) || null,
    understanding: (row.understanding as string) || null,
    content: (row.content as string) || null,
    references: row.references ? JSON.parse(row.references as string) : null,
    createdAt: row.created_at as string,
    project: projectId,
  }));
}

// Conversations
export function saveConversation(
  id: string,
  query: string,
  response?: string | null,
  metadata: Record<string, unknown> = {},
): void {
  const stmt = getDb().prepare(`
    INSERT INTO conversations (id, query, response, metadata)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, query, response ?? null, JSON.stringify(metadata));
}

export function updateConversationResponse(id: string, response: string): void {
  const stmt = getDb().prepare(`
    UPDATE conversations SET response = ? WHERE id = ?
  `);
  stmt.run(response, id);
}

export function getConversation(id: string): Conversation | undefined {
  const stmt = getDb().prepare('SELECT * FROM conversations WHERE id = ?');
  const row = stmt.get(id) as { metadata?: string } | undefined;
  if (row?.metadata) {
    return {
      ...row,
      metadata: JSON.parse(row.metadata),
    } as Conversation;
  }
  return row as Conversation | undefined;
}

export function getRecentConversations(limit = 50): Conversation[] {
  const stmt = getDb().prepare(`
    SELECT * FROM conversations
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return (stmt.all(limit) as Array<{ metadata?: string }>).map((row) => {
    if (row.metadata) {
      return { ...row, metadata: JSON.parse(row.metadata) } as Conversation;
    }
    return row as Conversation;
  });
}

// ============================================================================
// Commits - "Git for Cognition" atomic change tracking
// ============================================================================

export interface Commit {
  id: string;
  message: string;
  agentName: string | null;
  author: string | null;
  nodeIds: string[];
  edgeIds: string[];
  createdAt: string;
}

/**
 * Create a new commit record for a batch of graph changes.
 * @param timestamp - Optional ISO timestamp for retroactive commits
 * @param agentName - The tool that wrote this (e.g. "claude-code").
 * @param author   - The human-facing identity responsible (e.g. "@hwesterb").
 */
export function createCommit(
  message: string,
  nodeIds: string[] = [],
  edgeIds: string[] = [],
  agentName?: string,
  timestamp?: string,
  author?: string,
): Commit {
  const db = getDb();
  const id = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const createdAt = timestamp || new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO commits (id, message, agent_name, author, node_ids, edge_ids, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    message,
    agentName ?? null,
    author ?? null,
    JSON.stringify(nodeIds),
    JSON.stringify(edgeIds),
    createdAt,
  );

  // Link nodes and edges back to this commit (for "origin story" lookups)
  if (nodeIds.length > 0) {
    const updateNodes = db.prepare(
      `UPDATE nodes SET commit_id = ? WHERE id = ? AND commit_id IS NULL`,
    );
    for (const nodeId of nodeIds) {
      updateNodes.run(id, nodeId);
    }
  }
  if (edgeIds.length > 0) {
    const updateEdges = db.prepare(
      `UPDATE edges SET commit_id = ? WHERE id = ? AND commit_id IS NULL`,
    );
    for (const edgeId of edgeIds) {
      updateEdges.run(id, edgeId);
    }
  }

  return {
    id,
    message,
    agentName: agentName ?? null,
    author: author ?? null,
    nodeIds,
    edgeIds,
    createdAt,
  };
}

/**
 * Get the commit that created a node (its "origin story").
 */
export function getCommitForNode(nodeId: string): Commit | null {
  const db = getDb();
  // First get the commit_id from the node
  const nodeRow = db
    .prepare(`SELECT commit_id FROM nodes WHERE id = ?`)
    .get(nodeId) as { commit_id: string | null } | undefined;

  if (!nodeRow?.commit_id) return null;

  const row = db
    .prepare(`SELECT * FROM commits WHERE id = ?`)
    .get(nodeRow.commit_id) as
    | {
        id: string;
        message: string;
        agent_name: string | null;
        author: string | null;
        node_ids: string;
        edge_ids: string;
        created_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    message: row.message,
    agentName: row.agent_name,
    author: row.author ?? null,
    nodeIds: JSON.parse(row.node_ids || '[]'),
    edgeIds: JSON.parse(row.edge_ids || '[]'),
    createdAt: row.created_at,
  };
}

/**
 * Get recent commits for the current project.
 */
export function getRecentCommits(limit = 50): Commit[] {
  const stmt = getDb().prepare(`
    SELECT * FROM commits
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const rows = stmt.all(limit) as Array<{
    id: string;
    message: string;
    agent_name: string | null;
    author: string | null;
    node_ids: string;
    edge_ids: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    agentName: row.agent_name,
    author: row.author ?? null,
    nodeIds: JSON.parse(row.node_ids || '[]'),
    edgeIds: JSON.parse(row.edge_ids || '[]'),
    createdAt: row.created_at,
  }));
}

/**
 * Get a specific commit by ID.
 */
export function getCommit(id: string): Commit | null {
  const stmt = getDb().prepare('SELECT * FROM commits WHERE id = ?');
  const row = stmt.get(id) as
    | {
        id: string;
        message: string;
        agent_name: string | null;
        author: string | null;
        node_ids: string;
        edge_ids: string;
        created_at: string;
      }
    | undefined;

  if (!row) return null;

  return {
    id: row.id,
    message: row.message,
    agentName: row.agent_name,
    author: row.author ?? null,
    nodeIds: JSON.parse(row.node_ids || '[]'),
    edgeIds: JSON.parse(row.edge_ids || '[]'),
    createdAt: row.created_at,
  };
}

/**
 * Get all commits that affected a specific node.
 */
export function getCommitsForNode(nodeId: string): Commit[] {
  // Query commits where node_ids array contains the nodeId
  const stmt = getDb().prepare(`
    SELECT * FROM commits
    WHERE node_ids LIKE ?
    ORDER BY created_at DESC
  `);
  const rows = stmt.all(`%"${nodeId}"%`) as Array<{
    id: string;
    message: string;
    agent_name: string | null;
    author: string | null;
    node_ids: string;
    edge_ids: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    agentName: row.agent_name,
    author: row.author ?? null,
    nodeIds: JSON.parse(row.node_ids || '[]'),
    edgeIds: JSON.parse(row.edge_ids || '[]'),
    createdAt: row.created_at,
  }));
}

/**
 * Get all commits that affected a specific edge.
 */
export function getCommitsForEdge(edgeId: string): Commit[] {
  const stmt = getDb().prepare(`
    SELECT * FROM commits
    WHERE edge_ids LIKE ?
    ORDER BY created_at DESC
  `);
  const rows = stmt.all(`%"${edgeId}"%`) as Array<{
    id: string;
    message: string;
    agent_name: string | null;
    author: string | null;
    node_ids: string;
    edge_ids: string;
    created_at: string;
  }>;

  return rows.map((row) => ({
    id: row.id,
    message: row.message,
    agentName: row.agent_name,
    author: row.author ?? null,
    nodeIds: JSON.parse(row.node_ids || '[]'),
    edgeIds: JSON.parse(row.edge_ids || '[]'),
    createdAt: row.created_at,
  }));
}

// Documents
export function saveDocumentMeta(
  hash: string,
  originalName: string,
  mimeType?: string | null,
  sizeBytes?: number | null,
  conversationId?: string | null,
): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO documents (hash, original_name, mime_type, size_bytes, conversation_id)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    hash,
    originalName,
    mimeType ?? null,
    sizeBytes ?? null,
    conversationId ?? null,
  );
}

export function getDocument(hash: string): Document | undefined {
  const stmt = getDb().prepare('SELECT * FROM documents WHERE hash = ?');
  return stmt.get(hash) as Document | undefined;
}

export function getAllDocuments(): Document[] {
  const stmt = getDb().prepare(
    'SELECT * FROM documents ORDER BY uploaded_at DESC',
  );
  return stmt.all() as Document[];
}

// Project metadata
export function setProjectMeta(key: string, value: unknown): void {
  const stmt = getDb().prepare(`
    INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)
  `);
  stmt.run(key, typeof value === 'string' ? value : JSON.stringify(value));
}

export function getProjectMeta<T = unknown>(key: string): T | null {
  const stmt = getDb().prepare('SELECT value FROM project_meta WHERE key = ?');
  const row = stmt.get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as T;
  }
}

export function getAllProjectMeta(): Record<string, unknown> {
  const stmt = getDb().prepare('SELECT * FROM project_meta');
  const rows = stmt.all() as Array<{ key: string; value: string }>;
  const meta: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      meta[row.key] = JSON.parse(row.value);
    } catch {
      meta[row.key] = row.value;
    }
  }
  return meta;
}

// Event log
export function logEvent(
  action: EventLogEntry['action'],
  entityType: EventLogEntry['entity_type'],
  entityId: string,
  conversationId?: string | null,
  summary?: string | null,
  details?: Record<string, unknown> | null,
): number {
  const stmt = getDb().prepare(`
    INSERT INTO event_log (action, entity_type, entity_id, conversation_id, summary, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    action,
    entityType,
    entityId,
    conversationId ?? null,
    summary ?? null,
    details ? JSON.stringify(details) : null,
  );
  return Number(result.lastInsertRowid);
}

export interface EventLogOptions {
  from?: number;
  to?: number;
  entityId?: string;
  limit?: number;
  includeConversations?: boolean;
}

export function getEventLog(options: EventLogOptions = {}): EventLogEntry[] {
  const {
    from,
    to,
    entityId,
    limit = 100,
    includeConversations = false,
  } = options;

  let queryStr: string;
  const params: unknown[] = [];

  if (includeConversations) {
    queryStr = `
      SELECT e.*, c.query as user_query, c.response as ai_response
      FROM event_log e
      LEFT JOIN conversations c ON e.conversation_id = c.id
      WHERE 1=1
    `;
  } else {
    queryStr = `SELECT * FROM event_log WHERE 1=1`;
  }

  if (from !== undefined) {
    queryStr += ` AND seq >= ?`;
    params.push(from);
  }
  if (to !== undefined) {
    queryStr += ` AND seq <= ?`;
    params.push(to);
  }
  if (entityId) {
    queryStr += ` AND entity_id = ?`;
    params.push(entityId);
  }

  queryStr += ` ORDER BY seq DESC LIMIT ?`;
  params.push(limit);

  const stmt = getDb().prepare(queryStr);
  return (
    stmt.all(...params) as Array<EventLogEntry & { details?: string }>
  ).map((row) => {
    if (row.details && typeof row.details === 'string') {
      try {
        return { ...row, details: JSON.parse(row.details) };
      } catch {
        return row;
      }
    }
    return row;
  });
}

export function getEventLogRange(
  from: number,
  to: number,
  includeConversations = false,
): EventLogEntry[] {
  return getEventLog({ from, to, includeConversations, limit: to - from + 1 });
}

export function getEntityHistory(
  entityId: string,
  includeConversations = false,
): EventLogEntry[] {
  return getEventLog({ entityId, includeConversations, limit: 1000 });
}

export function getRecentEvents(
  limit = 50,
  includeConversations = false,
): EventLogEntry[] {
  return getEventLog({ limit, includeConversations });
}

// Database Explorer functions

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  rowCount: number;
}

export interface ColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
}

export interface TableRowsOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: 'asc' | 'desc';
  search?: string;
}

export interface TableRowsResult {
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
}

// Get all table names
export function getTableNames(): string[] {
  const stmt = getDb().prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);
  return (stmt.all() as Array<{ name: string }>).map((row) => row.name);
}

// Get table schema information
export function getTableSchema(tableName: string): TableInfo | null {
  // Validate table name exists (prevent SQL injection)
  const tables = getTableNames();
  if (!tables.includes(tableName)) {
    return null;
  }

  // Get column info
  const columnsStmt = getDb().prepare(`PRAGMA table_info("${tableName}")`);
  const columns = (
    columnsStmt.all() as Array<{
      cid: number;
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>
  ).map((col) => ({
    name: col.name,
    type: col.type,
    notNull: col.notnull === 1,
    primaryKey: col.pk === 1,
  }));

  // Get row count
  const countStmt = getDb().prepare(
    `SELECT COUNT(*) as count FROM "${tableName}"`,
  );
  const countResult = countStmt.get() as { count: number };

  return {
    name: tableName,
    columns,
    rowCount: countResult.count,
  };
}

// Get all tables with their schemas
export function getAllTableSchemas(): TableInfo[] {
  const tableNames = getTableNames();
  return tableNames
    .map((name) => getTableSchema(name))
    .filter((t): t is TableInfo => t !== null);
}

// Get rows from a table with pagination
export function getTableRows(
  tableName: string,
  options: TableRowsOptions = {},
): TableRowsResult | null {
  // Validate table name exists (prevent SQL injection)
  const tables = getTableNames();
  if (!tables.includes(tableName)) {
    return null;
  }

  const {
    limit = 50,
    offset = 0,
    orderBy,
    orderDir = 'desc',
    search,
  } = options;

  // Get total count
  let countQuery = `SELECT COUNT(*) as count FROM "${tableName}"`;
  const countParams: unknown[] = [];

  if (search) {
    // Get columns to search in
    const schema = getTableSchema(tableName);
    if (schema) {
      const textColumns = schema.columns
        .filter((c) => c.type.toUpperCase().includes('TEXT') || c.type === '')
        .map((c) => `"${c.name}" LIKE ?`);
      if (textColumns.length > 0) {
        countQuery += ` WHERE (${textColumns.join(' OR ')})`;
        for (const _ of textColumns) {
          countParams.push(`%${search}%`);
        }
      }
    }
  }

  const countStmt = getDb().prepare(countQuery);
  const total = (countStmt.get(...countParams) as { count: number }).count;

  // Build query
  let query = `SELECT * FROM "${tableName}"`;
  const params: unknown[] = [];

  if (search) {
    const schema = getTableSchema(tableName);
    if (schema) {
      const textColumns = schema.columns
        .filter((c) => c.type.toUpperCase().includes('TEXT') || c.type === '')
        .map((c) => `"${c.name}" LIKE ?`);
      if (textColumns.length > 0) {
        query += ` WHERE (${textColumns.join(' OR ')})`;
        for (const _ of textColumns) {
          params.push(`%${search}%`);
        }
      }
    }
  }

  // Validate orderBy column if provided
  if (orderBy) {
    const schema = getTableSchema(tableName);
    const validColumn = schema?.columns.some((c) => c.name === orderBy);
    if (validColumn) {
      query += ` ORDER BY "${orderBy}" ${orderDir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}`;
    }
  } else {
    // Default ordering by first column (avoid rowid as some tables may be WITHOUT ROWID)
    const schema = getTableSchema(tableName);
    if (schema && schema.columns.length > 0) {
      query += ` ORDER BY "${schema.columns[0].name}" DESC`;
    }
  }

  query += ` LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = getDb().prepare(query);
  const rows = stmt.all(...params) as Record<string, unknown>[];

  return {
    rows,
    total,
    limit,
    offset,
  };
}

// Get a single row by primary key
export function getTableRow(
  tableName: string,
  pkValue: string | number,
): Record<string, unknown> | null {
  // Validate table name exists
  const tables = getTableNames();
  if (!tables.includes(tableName)) {
    return null;
  }

  // Find primary key column
  const schema = getTableSchema(tableName);
  if (!schema) return null;

  const pkColumn = schema.columns.find((c) => c.primaryKey);
  if (!pkColumn) return null;

  const stmt = getDb().prepare(
    `SELECT * FROM "${tableName}" WHERE "${pkColumn.name}" = ?`,
  );
  return (stmt.get(pkValue) as Record<string, unknown>) || null;
}

// Tool calls logging

export interface LogToolCallInput {
  sessionId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string | null;
  durationMs?: number | null;
}

// Start a tool call (before execution) - returns the ID for linking to entities
export function startToolCall(
  sessionId: string,
  toolName: string,
  args: Record<string, unknown>,
): number {
  const stmt = getDb().prepare(`
    INSERT INTO tool_calls (session_id, tool_name, arguments)
    VALUES (?, ?, ?)
  `);
  const res = stmt.run(sessionId, toolName, JSON.stringify(args));
  return Number(res.lastInsertRowid);
}

// Complete a tool call (after execution) - updates with result/error/duration
export function completeToolCall(
  toolCallId: number,
  result?: unknown,
  error?: string | null,
  durationMs?: number | null,
): void {
  const stmt = getDb().prepare(`
    UPDATE tool_calls
    SET result = ?, error = ?, duration_ms = ?
    WHERE id = ?
  `);
  stmt.run(
    result !== undefined ? JSON.stringify(result) : null,
    error ?? null,
    durationMs ?? null,
    toolCallId,
  );
}

// Legacy: log a complete tool call in one step (used when no entity linking needed)
export function logToolCall(input: LogToolCallInput): number {
  const {
    sessionId,
    toolName,
    arguments: args,
    result,
    error,
    durationMs,
  } = input;
  const stmt = getDb().prepare(`
    INSERT INTO tool_calls (session_id, tool_name, arguments, result, error, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const res = stmt.run(
    sessionId,
    toolName,
    JSON.stringify(args),
    result !== undefined ? JSON.stringify(result) : null,
    error ?? null,
    durationMs ?? null,
  );
  return Number(res.lastInsertRowid);
}

export function getToolCallsBySession(sessionId: string): ToolCall[] {
  const stmt = getDb().prepare(`
    SELECT * FROM tool_calls
    WHERE session_id = ?
    ORDER BY created_at ASC
  `);
  return (
    stmt.all(sessionId) as Array<{
      id: number;
      session_id: string;
      tool_name: string;
      arguments: string;
      result: string | null;
      error: string | null;
      duration_ms: number | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    session_id: row.session_id,
    tool_name: row.tool_name,
    arguments: row.arguments ? JSON.parse(row.arguments) : {},
    result: row.result ? JSON.parse(row.result) : undefined,
    error: row.error,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  }));
}

export function getRecentToolCalls(limit = 100): ToolCall[] {
  const stmt = getDb().prepare(`
    SELECT * FROM tool_calls
    ORDER BY created_at DESC
    LIMIT ?
  `);
  return (
    stmt.all(limit) as Array<{
      id: number;
      session_id: string;
      tool_name: string;
      arguments: string;
      result: string | null;
      error: string | null;
      duration_ms: number | null;
      created_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    session_id: row.session_id,
    tool_name: row.tool_name,
    arguments: row.arguments ? JSON.parse(row.arguments) : {},
    result: row.result ? JSON.parse(row.result) : undefined,
    error: row.error,
    duration_ms: row.duration_ms,
    created_at: row.created_at,
  }));
}

// Get tool usage frequency for exploration prompt generation
export function getToolUsageFrequency(
  daysBack = 7,
): Array<{ tool_name: string; count: number }> {
  const stmt = getDb().prepare(`
    SELECT tool_name, COUNT(*) as count
    FROM tool_calls
    WHERE created_at > datetime('now', '-' || ? || ' days')
    GROUP BY tool_name
    ORDER BY count DESC
  `);
  return stmt.all(daysBack) as Array<{ tool_name: string; count: number }>;
}

// Bulk replace across all text fields in nodes
export interface BulkReplaceOptions {
  // Single replacement
  find?: string;
  replace?: string;
  // Batch replacements (array of {find, replace} pairs)
  replacements?: Array<{ find: string; replace: string }>;
  // Common options
  fields?: Array<'title' | 'understanding' | 'content' | 'summary'>;
  caseSensitive?: boolean;
  preview?: boolean;
}

export interface BulkReplaceResult {
  preview: boolean;
  matchCount: number;
  replacementCount: number;
  changes: Array<{
    nodeId: string;
    field: string;
    find: string;
    replace: string;
    occurrences: number;
  }>;
  summary: Array<{ find: string; replace: string; matches: number }>;
}

export function bulkReplace(options: BulkReplaceOptions): BulkReplaceResult {
  const {
    find,
    replace,
    replacements: inputReplacements,
    fields = ['title', 'understanding', 'content', 'summary'],
    caseSensitive = false,
    preview = true,
  } = options;

  // Build replacements array from either single or batch input
  const replacements: Array<{ find: string; replace: string }> = [];

  if (inputReplacements && inputReplacements.length > 0) {
    for (const r of inputReplacements) {
      if (r.find && r.replace !== undefined) {
        replacements.push(r);
      }
    }
  } else if (find && replace !== undefined) {
    replacements.push({ find, replace });
  }

  if (replacements.length === 0) {
    throw new Error(
      'At least one replacement is required (either find/replace or replacements array)',
    );
  }

  const database = getDb();
  const changes: BulkReplaceResult['changes'] = [];
  const summary: BulkReplaceResult['summary'] = [];

  // Get all active nodes
  const nodes = database
    .prepare(
      'SELECT id, title, understanding, content, summary FROM nodes WHERE active = 1',
    )
    .all() as Array<{
    id: string;
    title: string | null;
    understanding: string | null;
    content: string | null;
    summary: string | null;
  }>;

  // Track current values for applying multiple replacements
  const currentValues = new Map<
    string,
    {
      title: string | null;
      understanding: string | null;
      content: string | null;
      summary: string | null;
    }
  >();
  for (const node of nodes) {
    currentValues.set(node.id, { ...node });
  }

  // Process each replacement
  for (const { find: findStr, replace: replaceStr } of replacements) {
    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(
      findStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      flags,
    );
    let matchesForThisReplacement = 0;

    for (const node of nodes) {
      const current = currentValues.get(node.id);
      if (!current) continue;

      for (const field of fields) {
        const value = current[field];
        if (value) {
          const matches = value.match(regex);
          if (matches && matches.length > 0) {
            regex.lastIndex = 0;
            const newValue = value.replace(regex, replaceStr);
            changes.push({
              nodeId: node.id,
              field,
              find: findStr,
              replace: replaceStr,
              occurrences: matches.length,
            });
            matchesForThisReplacement += matches.length;
            // Update current value for chaining replacements
            current[field as keyof typeof current] = newValue;
          }
          regex.lastIndex = 0;
        }
      }
    }

    summary.push({
      find: findStr,
      replace: replaceStr,
      matches: matchesForThisReplacement,
    });
  }

  // Apply changes if not preview
  if (!preview && changes.length > 0) {
    const updateStmt = database.prepare(`
      UPDATE nodes
      SET title = ?,
          understanding = ?,
          content = ?,
          summary = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `);

    const transaction = database.transaction(() => {
      // Get unique node IDs that were changed
      const changedNodeIds = new Set(changes.map((c) => c.nodeId));

      for (const nodeId of changedNodeIds) {
        const current = currentValues.get(nodeId);
        if (!current) continue;

        updateStmt.run(
          current.title,
          current.understanding,
          current.content,
          current.summary,
          nodeId,
        );

        // Log event
        const nodeChanges = changes.filter((c) => c.nodeId === nodeId);
        logEvent(
          'revised',
          'node',
          nodeId,
          null,
          `Bulk replace: ${nodeChanges.map((c) => `"${c.find}" → "${c.replace}"`).join(', ')}`,
          { replacements: nodeChanges },
        );
      }
    });

    transaction();
  }

  return {
    preview,
    matchCount: changes.reduce((sum, c) => sum + c.occurrences, 0),
    replacementCount: replacements.length,
    changes,
    summary,
  };
}

// ============================================================================
// Purge - permanent deletion (admin only)
// ============================================================================

export interface PurgeResult {
  deletedNodes: number;
  deletedEdges: number;
  cascadeEdges: number;
  auditLogId: number;
}

/**
 * Permanently delete nodes and edges from the database.
 * This is a destructive operation that cannot be undone.
 * Use only for test data cleanup.
 */
export function purgeNodes(
  nodeIds: string[],
  edgeIds: string[],
  reason: string,
): PurgeResult {
  const database = getDb();

  let deletedNodes = 0;
  let deletedEdges = 0;
  let cascadeEdges = 0;

  // Log the purge action first for audit trail
  const auditLogId = logEvent(
    'purged',
    'batch',
    'purge_operation',
    null,
    `PURGE: ${reason}`,
    {
      nodeIds,
      edgeIds,
      reason,
      timestamp: new Date().toISOString(),
    },
  );

  const transaction = database.transaction(() => {
    // 1. Delete edges connected to nodes being purged (cascade)
    if (nodeIds.length > 0) {
      const placeholders = nodeIds.map(() => '?').join(',');

      // First, delete from nodes_fts for nodes being deleted
      // Note: The FTS triggers should handle this, but we need to be careful
      // We'll delete the edges first, then the nodes

      // Get cascade edges for counting
      const cascadeRows = database
        .prepare(
          `SELECT id FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`,
        )
        .all(...nodeIds, ...nodeIds) as Array<{ id: string }>;
      cascadeEdges = cascadeRows.length;

      // Delete cascade edges
      database
        .prepare(
          `DELETE FROM edges WHERE from_id IN (${placeholders}) OR to_id IN (${placeholders})`,
        )
        .run(...nodeIds, ...nodeIds);
    }

    // 2. Delete specified edges
    if (edgeIds.length > 0) {
      const placeholders = edgeIds.map(() => '?').join(',');
      const result = database
        .prepare(`DELETE FROM edges WHERE id IN (${placeholders})`)
        .run(...edgeIds);
      deletedEdges = result.changes;
    }

    // 3. Delete nodes (FTS triggers will handle nodes_fts cleanup)
    if (nodeIds.length > 0) {
      const placeholders = nodeIds.map(() => '?').join(',');
      const result = database
        .prepare(`DELETE FROM nodes WHERE id IN (${placeholders})`)
        .run(...nodeIds);
      deletedNodes = result.changes;
    }
  });

  transaction();

  // Log completion
  logEvent(
    'purged',
    'batch',
    'purge_complete',
    null,
    `Purge completed: ${deletedNodes} nodes, ${deletedEdges + cascadeEdges} edges`,
    {
      deletedNodes,
      deletedEdges,
      cascadeEdges,
      auditLogId,
    },
  );

  return {
    deletedNodes,
    deletedEdges,
    cascadeEdges,
    auditLogId,
  };
}

// Exploration prompts for breaking AI habituation
export interface ExplorationPrompt {
  type: 'tool' | 'verify' | 'serendipity' | 'convergence';
  tool?: string;
  action: string;
  reason: string;
}

// Available exploration tools and their prompts
const explorationTools: Array<{
  tool: string;
  action: string;
  category: 'discovery' | 'reflection' | 'verification';
}> = [
  {
    tool: 'graph_random',
    action: 'Get random nodes and look for unexpected connections',
    category: 'discovery',
  },
  {
    tool: 'graph_similar',
    action: 'Find nodes structurally similar to a concept you are about to add',
    category: 'discovery',
  },
  {
    tool: 'graph_semantic_gaps',
    action: 'Look for potential missing connections based on shared keywords',
    category: 'discovery',
  },
  {
    tool: 'graph_centrality',
    action: 'Find the most important concepts and ensure you understand them',
    category: 'reflection',
  },
  {
    tool: 'graph_analyze',
    action: 'Check for open questions, cycles, and bridges in the graph',
    category: 'reflection',
  },
  {
    tool: 'graph_history',
    action: 'Review how understanding has evolved recently',
    category: 'reflection',
  },
];

// Generate exploration prompts, biased toward underused tools
export function generateExplorationPrompts(count = 2): ExplorationPrompt[] {
  const selected: ExplorationPrompt[] = [];

  // Check graph health first - convergence takes priority
  try {
    const analysis = analyzeGraph('current');
    const { isolatedCount, unvalidatedSerendipityCount } = analysis.stats;

    if (isolatedCount > 0 || unvalidatedSerendipityCount > 0) {
      const reasons: string[] = [];
      if (isolatedCount > 0)
        reasons.push(
          `${isolatedCount} isolated node${isolatedCount > 1 ? 's' : ''}`,
        );
      if (unvalidatedSerendipityCount > 0)
        reasons.push(`${unvalidatedSerendipityCount} unvalidated serendipity`);

      selected.push({
        type: 'convergence',
        action: `CONVERGENCE NEEDED: Connect isolated nodes and validate serendipity before adding new concepts`,
        reason: `Graph health check: ${reasons.join(', ')}. Strengthen existing structure before diverging.`,
      });
    }
  } catch {
    // Graph not loaded yet, skip health check
  }

  const usage = getToolUsageFrequency(7);
  const usageMap = new Map(usage.map((u) => [u.tool_name, u.count]));

  // Calculate weights - inverse of usage frequency
  const maxUsage = Math.max(...usage.map((u) => u.count), 1);
  const weightedTools = explorationTools.map((t) => ({
    ...t,
    weight: maxUsage - (usageMap.get(t.tool) || 0) + 1, // +1 so unused tools have weight
  }));

  // Weighted random selection
  const totalWeight = weightedTools.reduce((sum, t) => sum + t.weight, 0);
  const usedIndices = new Set<number>();

  while (
    selected.length < count + 1 &&
    usedIndices.size < weightedTools.length
  ) {
    let random = Math.random() * totalWeight;
    for (let i = 0; i < weightedTools.length; i++) {
      if (usedIndices.has(i)) continue;
      random -= weightedTools[i].weight;
      if (random <= 0) {
        const tool = weightedTools[i];
        selected.push({
          type: 'tool',
          tool: tool.tool,
          action: tool.action,
          reason: usageMap.get(tool.tool)
            ? `Used ${usageMap.get(tool.tool)} times recently - try varying your approach`
            : 'Rarely used tool - might reveal new insights',
        });
        usedIndices.add(i);
        break;
      }
    }
  }

  // 30% chance to add verification prompt
  if (Math.random() < 0.3) {
    selected.push({
      type: 'verify',
      action: 'Pick one foundation node and verify its accuracy via web search',
      reason: 'Prevent echo chamber - ground understanding in external sources',
    });
  }

  // 40% chance to add serendipity prompt if questions exist (only if not in convergence mode)
  if (Math.random() < 0.4 && !selected.some((s) => s.type === 'convergence')) {
    selected.push({
      type: 'serendipity',
      action: 'Run question-focused serendipity (graph_serendipity/questions)',
      reason: 'Questions are receptive targets for random discovery',
    });
  }

  return selected.slice(0, count + 2); // Cap at count+2 to allow convergence + tools
}

// ============================================================================
// Cross-Project Read Functions
// ============================================================================

/**
 * Get all loaded project IDs
 */
export function getLoadedProjectIds(): string[] {
  return Array.from(databases.keys());
}

/**
 * Check if a project is loaded
 */
export function isProjectLoaded(projectId: string): boolean {
  return databases.has(projectId);
}

/**
 * Query nodes from a specific project (read-only)
 */
export function queryNodes(
  projectId: string,
  options: {
    trigger?: string;
    limit?: number;
    includeArchived?: boolean;
  } = {},
): ExternalNodeData[] {
  const db = databases.get(projectId);
  if (!db) return [];

  const { trigger, limit = 50, includeArchived = false } = options;

  let query = `
    SELECT id, title, trigger, why, understanding, content, "references", created_at
    FROM nodes
    WHERE active = 1
  `;
  const params: unknown[] = [];

  if (!includeArchived) {
    query += ' AND archived_at IS NULL';
  }

  if (trigger) {
    query += ' AND trigger = ?';
    params.push(trigger);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as Array<
    Record<string, unknown>
  >;

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    trigger: (row.trigger as string) || null,
    why: (row.why as string) || null,
    understanding: (row.understanding as string) || null,
    content: (row.content as string) || null,
    references: row.references ? JSON.parse(row.references as string) : null,
    createdAt: row.created_at as string,
    project: projectId,
  }));
}

/**
 * Get edges from a specific project (read-only)
 */
export function queryEdges(
  projectId: string,
  options: { fromId?: string; toId?: string; limit?: number } = {},
): Array<{
  id: string;
  fromId: string;
  toId: string;
  type: string;
  why: string | null;
}> {
  const db = databases.get(projectId);
  if (!db) return [];

  const { fromId, toId, limit = 100 } = options;

  let query =
    'SELECT id, from_id, to_id, type, why FROM edges WHERE active = 1';
  const params: unknown[] = [];

  if (fromId) {
    query += ' AND from_id = ?';
    params.push(fromId);
  }
  if (toId) {
    query += ' AND to_id = ?';
    params.push(toId);
  }

  query += ' LIMIT ?';
  params.push(limit);

  const rows = db.prepare(query).all(...params) as Array<
    Record<string, unknown>
  >;

  return rows.map((row) => ({
    id: row.id as string,
    fromId: row.from_id as string,
    toId: row.to_id as string,
    type: (row.type as string) || 'relates',
    why: (row.why as string) || null,
  }));
}

/**
 * Get document roots from a specific project (read-only)
 */
export function getDocumentRoots(projectId: string): ExternalNodeData[] {
  const db = databases.get(projectId);
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT id, title, trigger, why, understanding, content, "references", created_at
       FROM nodes
       WHERE is_doc_root = 1 AND active = 1 AND archived_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    trigger: (row.trigger as string) || null,
    why: (row.why as string) || null,
    understanding: (row.understanding as string) || null,
    content: (row.content as string) || null,
    references: row.references ? JSON.parse(row.references as string) : null,
    createdAt: row.created_at as string,
    project: projectId,
  }));
}

/**
 * Get node count and basic stats for a project
 */
export function getProjectStats(
  projectId: string,
): { nodeCount: number; edgeCount: number; docCount: number } | null {
  const db = databases.get(projectId);
  if (!db) return null;

  const nodeCount = (
    db
      .prepare(
        'SELECT COUNT(*) as count FROM nodes WHERE active = 1 AND archived_at IS NULL',
      )
      .get() as { count: number }
  ).count;

  const edgeCount = (
    db
      .prepare('SELECT COUNT(*) as count FROM edges WHERE active = 1')
      .get() as {
      count: number;
    }
  ).count;

  const docCount = (
    db
      .prepare(
        'SELECT COUNT(*) as count FROM nodes WHERE is_doc_root = 1 AND active = 1',
      )
      .get() as { count: number }
  ).count;

  return { nodeCount, edgeCount, docCount };
}

// ============================================================================
// Text Sources - Chronological Reading System
// ============================================================================

export interface TextSource {
  id: string;
  title: string;
  sourceType: string | null;
  content: string;
  position: number;
  totalLength: number;
  projectId: string | null;
  rootNodeId: string | null;
  lastCommittedNodeId: string | null;
  status: 'pending' | 'reading' | 'completed';
  createdAt: string;
  updatedAt: string | null;
}

/**
 * Create a new text source for reading
 * Accepts either content directly or a filePath to read from
 */
export function createTextSource(input: {
  id: string;
  title: string;
  sourceType?: string;
  content?: string;
  filePath?: string;
  projectId?: string;
}): TextSource {
  const db = getDb();
  const { id, title, sourceType, projectId } = input;

  // Get content from either direct content or file path
  let content: string;
  if (input.filePath) {
    if (!fs.existsSync(input.filePath)) {
      throw new Error(`File not found: ${input.filePath}`);
    }
    content = fs.readFileSync(input.filePath, 'utf-8');
  } else if (input.content) {
    content = input.content;
  } else {
    throw new Error('Either content or filePath must be provided');
  }

  const totalLength = content.length;

  db.prepare(`
    INSERT INTO text_sources (id, title, source_type, content, total_length, project_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title,
    sourceType ?? null,
    content,
    totalLength,
    projectId ?? currentProjectId,
  );

  const source = getTextSource(id);
  if (!source) {
    throw new Error(`Failed to create text source with id ${id}`);
  }
  return source;
}

/**
 * Get a text source by ID
 */
export function getTextSource(id: string): TextSource | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM text_sources WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;

  if (!row) return null;

  return {
    id: row.id as string,
    title: row.title as string,
    sourceType: row.source_type as string | null,
    content: row.content as string,
    position: row.position as number,
    totalLength: row.total_length as number,
    projectId: row.project_id as string | null,
    rootNodeId: row.root_node_id as string | null,
    lastCommittedNodeId: row.last_committed_node_id as string | null,
    status: row.status as 'pending' | 'reading' | 'completed',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string | null,
  };
}

/**
 * List text sources for current project
 */
export function listTextSources(projectId?: string): TextSource[] {
  const db = getDb();
  const pid = projectId ?? currentProjectId;

  const rows = db
    .prepare(`
    SELECT * FROM text_sources
    WHERE project_id = ?
    ORDER BY created_at DESC
  `)
    .all(pid) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: row.id as string,
    title: row.title as string,
    sourceType: row.source_type as string | null,
    content: row.content as string,
    position: row.position as number,
    totalLength: row.total_length as number,
    projectId: row.project_id as string | null,
    rootNodeId: row.root_node_id as string | null,
    lastCommittedNodeId: row.last_committed_node_id as string | null,
    status: row.status as 'pending' | 'reading' | 'completed',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string | null,
  }));
}

/**
 * Read next portion of a text source
 * Returns the content and advances position
 */
export function readTextSource(
  id: string,
  options: { chars?: number; lines?: number; until?: string },
): { content: string; position: number; done: boolean } | null {
  const source = getTextSource(id);
  if (!source) return null;

  const { chars, lines, until } = options;
  const remaining = source.content.slice(source.position);

  if (remaining.length === 0) {
    return { content: '', position: source.position, done: true };
  }

  let readLength = remaining.length; // Default: read all

  if (chars && chars > 0) {
    readLength = Math.min(chars, remaining.length);
  } else if (lines && lines > 0) {
    // Count lines
    let lineCount = 0;
    let idx = 0;
    while (lineCount < lines && idx < remaining.length) {
      if (remaining[idx] === '\n') lineCount++;
      idx++;
    }
    readLength = idx;
  } else if (until) {
    // Find delimiter
    const idx = remaining.indexOf(until);
    if (idx !== -1) {
      readLength = idx + until.length;
    }
  }

  const content = remaining.slice(0, readLength);
  const newPosition = source.position + readLength;
  const done = newPosition >= source.totalLength;

  // Update position and status
  const db = getDb();
  db.prepare(`
    UPDATE text_sources
    SET position = ?, status = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newPosition, done ? 'completed' : 'reading', id);

  return { content, position: newPosition, done };
}

/**
 * Update text source metadata (root node, last committed node)
 */
export function updateTextSource(
  id: string,
  updates: {
    rootNodeId?: string;
    lastCommittedNodeId?: string;
    status?: 'pending' | 'reading' | 'completed';
    position?: number;
  },
): void {
  const db = getDb();
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (updates.rootNodeId !== undefined) {
    setClauses.push('root_node_id = ?');
    params.push(updates.rootNodeId);
  }
  if (updates.lastCommittedNodeId !== undefined) {
    setClauses.push('last_committed_node_id = ?');
    params.push(updates.lastCommittedNodeId);
  }
  if (updates.status !== undefined) {
    setClauses.push('status = ?');
    params.push(updates.status);
  }
  if (updates.position !== undefined) {
    setClauses.push('position = ?');
    params.push(updates.position);
  }

  params.push(id);
  db.prepare(
    `UPDATE text_sources SET ${setClauses.join(', ')} WHERE id = ?`,
  ).run(...params);
}

/**
 * Delete a text source
 */
export function deleteTextSource(id: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM text_sources WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Get reading progress for a text source
 */
export function getTextSourceProgress(id: string): {
  position: number;
  totalLength: number;
  percent: number;
  status: string;
  lastCommittedNodeId: string | null;
} | null {
  const source = getTextSource(id);
  if (!source) return null;

  return {
    position: source.position,
    totalLength: source.totalLength,
    percent: Math.round((source.position / source.totalLength) * 100),
    status: source.status,
    lastCommittedNodeId: source.lastCommittedNodeId,
  };
}

// ============================================================================
// Database Statistics - Comprehensive Graph Analytics
// ============================================================================

export interface DbStats {
  nodes: {
    total: number;
    active: number;
    archived: number;
    byTrigger: Array<{
      trigger: string | null;
      count: number;
      percent: number;
    }>;
  };
  edges: {
    total: number;
    byType: Array<{ type: string | null; count: number; percent: number }>;
  };
  commits: {
    total: number;
    byAgent: Array<{ agent: string | null; count: number; percent: number }>;
  };
  documents: {
    roots: number;
    contentNodes: number;
  };
  thinking: {
    total: number;
    translated: number;
  };
  revisions: {
    avgVersion: number;
    maxVersion: number;
  };
  connectivity: {
    mostConnected: Array<{ id: string; title: string; edgeCount: number }>;
    orphanCount: number;
  };
}

/**
 * Get comprehensive database statistics for the current project.
 */
export function getDatabaseStats(): DbStats {
  const db = getDb();

  // Node statistics
  const activeNodes = (
    db
      .prepare('SELECT COUNT(*) as count FROM nodes WHERE archived_at IS NULL')
      .get() as { count: number }
  ).count;

  const archivedNodes = (
    db
      .prepare(
        'SELECT COUNT(*) as count FROM nodes WHERE archived_at IS NOT NULL',
      )
      .get() as { count: number }
  ).count;

  const nodesByTrigger = db
    .prepare(`
      SELECT trigger, COUNT(*) as count
      FROM nodes
      WHERE archived_at IS NULL
      GROUP BY trigger
      ORDER BY count DESC
    `)
    .all() as Array<{ trigger: string | null; count: number }>;

  // Edge statistics
  const totalEdges = (
    db.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number }
  ).count;

  const edgesByType = db
    .prepare(`
      SELECT type, COUNT(*) as count
      FROM edges
      GROUP BY type
      ORDER BY count DESC
    `)
    .all() as Array<{ type: string | null; count: number }>;

  // Commit statistics
  const totalCommits = (
    db.prepare('SELECT COUNT(*) as count FROM commits').get() as {
      count: number;
    }
  ).count;

  const commitsByAgent = db
    .prepare(`
      SELECT agent_name as agent, COUNT(*) as count
      FROM commits
      WHERE agent_name IS NOT NULL
      GROUP BY agent_name
      ORDER BY count DESC
    `)
    .all() as Array<{ agent: string | null; count: number }>;

  // Document statistics
  const docRoots = (
    db
      .prepare('SELECT COUNT(*) as count FROM nodes WHERE is_doc_root = 1')
      .get() as {
      count: number;
    }
  ).count;

  const docNodes = (
    db
      .prepare(
        'SELECT COUNT(*) as count FROM nodes WHERE file_type IS NOT NULL',
      )
      .get() as {
      count: number;
    }
  ).count;

  // Thinking/translated statistics
  const thinkingNodes = (
    db
      .prepare("SELECT COUNT(*) as count FROM nodes WHERE trigger = 'thinking'")
      .get() as {
      count: number;
    }
  ).count;

  const translatedNodes = (
    db
      .prepare(`
      SELECT COUNT(*) as count
      FROM nodes
      WHERE json_extract(metadata, '$.translated') = 1
    `)
      .get() as { count: number }
  ).count;

  // Revision statistics
  const revisionStats = db
    .prepare(`
      SELECT AVG(version) as avg_version, MAX(version) as max_version
      FROM nodes
      WHERE archived_at IS NULL
    `)
    .get() as { avg_version: number | null; max_version: number | null };

  // Connectivity - most connected nodes (excluding document structure nodes)
  const mostConnected = db
    .prepare(`
      SELECT n.id, n.title, COUNT(e.id) as edge_count
      FROM nodes n
      LEFT JOIN edges e ON n.id = e.from_id OR n.id = e.to_id
      WHERE n.archived_at IS NULL AND n.file_type IS NULL
      GROUP BY n.id
      ORDER BY edge_count DESC
      LIMIT 5
    `)
    .all() as Array<{ id: string; title: string; edge_count: number }>;

  // Orphan nodes (no edges, not document nodes or roots)
  const orphanCount = (
    db
      .prepare(`
      SELECT COUNT(*) as count
      FROM nodes n
      WHERE n.archived_at IS NULL
      AND n.file_type IS NULL
      AND n.is_doc_root IS NULL
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.from_id = n.id OR e.to_id = n.id)
    `)
      .get() as { count: number }
  ).count;

  return {
    nodes: {
      total: activeNodes + archivedNodes,
      active: activeNodes,
      archived: archivedNodes,
      byTrigger: nodesByTrigger.map((row) => ({
        trigger: row.trigger,
        count: row.count,
        percent:
          activeNodes > 0
            ? Math.round((row.count / activeNodes) * 1000) / 10
            : 0,
      })),
    },
    edges: {
      total: totalEdges,
      byType: edgesByType.map((row) => ({
        type: row.type,
        count: row.count,
        percent:
          totalEdges > 0 ? Math.round((row.count / totalEdges) * 1000) / 10 : 0,
      })),
    },
    commits: {
      total: totalCommits,
      byAgent: commitsByAgent.map((row) => ({
        agent: row.agent,
        count: row.count,
        percent:
          totalCommits > 0
            ? Math.round((row.count / totalCommits) * 1000) / 10
            : 0,
      })),
    },
    documents: {
      roots: docRoots,
      contentNodes: docNodes,
    },
    thinking: {
      total: thinkingNodes,
      translated: translatedNodes,
    },
    revisions: {
      avgVersion: revisionStats.avg_version
        ? Math.round(revisionStats.avg_version * 10) / 10
        : 1,
      maxVersion: revisionStats.max_version ?? 1,
    },
    connectivity: {
      mostConnected: mostConnected.map((row) => ({
        id: row.id,
        title: row.title || 'untitled',
        edgeCount: row.edge_count,
      })),
      orphanCount,
    },
  };
}
