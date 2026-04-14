import fs from 'node:fs';
import path from 'node:path';
import {
  getGraphStore,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { v4 as uuidv4 } from 'uuid';

export interface ConversationContext {
  conversationId: string;
  projectId: string;
  createdAt: Date;
}

export class ContextManager {
  private currentContext: ConversationContext | null = null;
  private projectDir: string = './projects';

  setProjectDir(dir: string): void {
    this.projectDir = dir;
    // Ensure directory exists
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  getProjectDir(): string {
    return this.projectDir;
  }

  // Get or create current conversation context
  // Set allowCreate=false to reject unknown projects (prevents accidental project creation)
  async getContext(
    projectId?: string,
    allowCreate: boolean = false,
  ): Promise<ConversationContext> {
    const targetProject =
      projectId || this.currentContext?.projectId || 'default';

    // If switching projects or no context, initialize
    if (
      !this.currentContext ||
      this.currentContext.projectId !== targetProject
    ) {
      await this.initializeContext(targetProject, allowCreate);
    }

    if (!this.currentContext) {
      throw new Error('Failed to initialize context');
    }
    return this.currentContext;
  }

  // Get current project ID (or default)
  getCurrentProjectId(): string {
    return this.currentContext?.projectId || 'default';
  }

  // Get current conversation ID for linking to nodes/edges
  // Returns the context's conversationId for internal tracking
  async getCurrentConversationId(
    projectId?: string,
  ): Promise<string | undefined> {
    // Ensure context is initialized
    await this.getContext(projectId);
    return this.currentContext?.conversationId;
  }

  // Initialize context for a project
  // allowCreate=true allows creating new projects, false rejects unknown projects
  private async initializeContext(
    projectId: string,
    allowCreate: boolean = false,
    goal?: string,
  ): Promise<void> {
    // Validate projectId to prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
      throw new Error(
        `Invalid project ID: "${projectId}". Must contain only alphanumeric characters, underscores, and hyphens.`,
      );
    }

    // Strip user prefix if present (e.g., "developer__my-project" -> "my-project")
    // This ensures both db_manager and Understanding MCP use the same directory
    const actualProjectId = projectId.includes('__')
      ? (projectId.split('__').pop() ?? projectId)
      : projectId;

    // Ensure project directory exists and SQLite is initialized
    const projectPath = path.join(this.projectDir, actualProjectId);
    const isNewProject = !fs.existsSync(projectPath);

    // CRITICAL: Reject unknown projects unless allowCreate is true
    // This prevents agents from accidentally creating projects by passing wrong project IDs
    if (isNewProject && !allowCreate) {
      const existingProjects = this.listProjects();
      throw new Error(
        `Project "${actualProjectId}" does not exist. ` +
          `Available projects: [${existingProjects.join(', ')}]. ` +
          `Use project_switch to create a new project.`,
      );
    }

    if (isNewProject) {
      fs.mkdirSync(projectPath, { recursive: true });
      fs.mkdirSync(path.join(projectPath, 'documents'), { recursive: true });
      fs.mkdirSync(path.join(projectPath, 'generated'), { recursive: true });

      // Create meta.json for web UI compatibility
      const meta = { name: actualProjectId, goal: goal || '' };
      fs.writeFileSync(
        path.join(projectPath, 'meta.json'),
        JSON.stringify(meta, null, 2),
      );
    } else if (goal !== undefined) {
      // Update goal on existing project when explicitly provided
      const metaPath = path.join(projectPath, 'meta.json');
      let meta = { name: actualProjectId, goal: '' };
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        } catch {}
      }
      meta.goal = goal;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    }

    // Initialize SQLite for this project (includes nodes/edges tables now)
    sqlite.initDatabase(projectPath);

    // Reset GraphStore to force reload for new project
    resetGraphStore();

    // Generate conversation ID for internal tracking
    const conversationId = `c_${uuidv4().slice(0, 8)}`;

    // CRITICAL: Insert conversation record into database for foreign key constraint
    sqlite.saveConversation(
      conversationId,
      `Project initialized: ${actualProjectId}`,
    );

    this.currentContext = {
      conversationId,
      projectId: actualProjectId, // Store stripped ID for consistency
      createdAt: new Date(),
    };
  }

  // Switch to a different project (creates if it doesn't exist)
  async switchProject(
    projectId: string,
    goal?: string,
  ): Promise<ConversationContext> {
    await this.initializeContext(projectId, true, goal); // allowCreate=true
    if (!this.currentContext) {
      throw new Error('Failed to initialize context');
    }
    return this.currentContext;
  }

  // List available projects (includes "default" which is shown as "Home" in UI)
  listProjects(): string[] {
    if (!fs.existsSync(this.projectDir)) {
      return [];
    }
    return fs.readdirSync(this.projectDir).filter((name) => {
      const projectPath = path.join(this.projectDir, name);
      return fs.statSync(projectPath).isDirectory();
    });
  }

  // Resolve a node reference (name or ID)
  resolveNode(
    ref: string,
    _projectId?: string,
  ): { id: string; title: string } | null {
    const store = getGraphStore();

    // Already an ID?
    if (ref.startsWith('n_')) {
      const node = store.getNode(ref);
      if (node) {
        return { id: node.id, title: node.title };
      }
      return null;
    }

    // Search by name
    const node = store.findNodeByName(ref);
    if (node) {
      return { id: node.id, title: node.title };
    }

    return null;
  }

  // Resolve node with suggestions on failure
  resolveNodeWithSuggestions(
    ref: string,
    projectId?: string,
  ): { id: string; title: string } {
    const resolved = this.resolveNode(ref, projectId);
    if (resolved) {
      return resolved;
    }

    // Get suggestions
    const store = getGraphStore();
    const suggestions = store.findSimilarNodes(ref, 5);

    if (suggestions.length > 0) {
      const suggestionList = suggestions
        .map((s) => `  - "${s.title}" (${s.id})`)
        .join('\n');
      throw new Error(
        `Node not found: "${ref}"\n\nDid you mean one of these?\n${suggestionList}\n\nYou can use either the name or ID.`,
      );
    }

    throw new Error(
      `Node not found: "${ref}"\n\nUse graph_context to see available nodes.`,
    );
  }

  // Update conversation with response
  updateConversationResponse(response: string): void {
    if (this.currentContext) {
      sqlite.updateConversationResponse(
        this.currentContext.conversationId,
        response,
      );
    }
  }

  // Log an event
  logEvent(
    action: 'created' | 'revised' | 'superseded' | 'archived',
    entityType: 'node' | 'edge',
    entityId: string,
    summary?: string,
    details?: Record<string, unknown>,
  ): number {
    return sqlite.logEvent(
      action,
      entityType,
      entityId,
      this.currentContext?.conversationId ?? null,
      summary ?? null,
      details ?? null,
    );
  }

  // Tool call tracking (for entity linking)
  private currentToolCallId: number | null = null;

  setCurrentToolCall(toolCallId: number): void {
    this.currentToolCallId = toolCallId;
  }

  getCurrentToolCall(): number | null {
    return this.currentToolCallId;
  }

  clearCurrentToolCall(): void {
    this.currentToolCallId = null;
  }
}
