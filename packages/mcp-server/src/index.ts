#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { sqlite } from '@understanding-graph/core';
import { ContextManager } from './context-manager.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import {
  getToolDefinitions,
  handleToolCall,
  type ToolMode,
} from './tools/index.js';

// Read the package version dynamically so serverInfo.version always matches
// the shipped package, not a hardcoded string that can drift out of sync.
const require = createRequire(import.meta.url);
const PACKAGE_VERSION: string = (
  require('../package.json') as { version: string }
).version;

// Tool mode from environment (default: full)
const TOOL_MODE = (process.env.TOOL_MODE || 'full') as ToolMode;

// Auto-log tool calls wrapper with two-phase logging for entity linking
async function handleToolCallWithLogging(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  // Simple pass-through - commits are tracked via graph_batch commit_message
  return handleToolCall(name, args, contextManager);
}

class UnderstandingGraphServer {
  private server: Server;
  private contextManager: ContextManager;

  constructor() {
    this.server = new Server(
      {
        name: 'understanding-graph',
        version: PACKAGE_VERSION,
      },
      {
        capabilities: {
          tools: {},
        },
        instructions: SERVER_INSTRUCTIONS,
      },
    );

    this.contextManager = new ContextManager();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: getToolDefinitions(TOOL_MODE),
      };
    });

    // Handle tool calls (with auto-logging)
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await handleToolCallWithLogging(
          name,
          args || {},
          this.contextManager,
        );
        return {
          content: [
            {
              type: 'text',
              text:
                typeof result === 'string'
                  ? result
                  : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      await this.stop();
      process.exit(0);
    });

    // Zombie Prevention: Exit if stdin closes (Parent Python process died)
    // process.stdin.on('close', async () => {
    //   console.error('Stdin closed, exiting...');
    //   await this.stop();
    //   process.exit(0);
    // });

    // process.stdin.on('end', async () => {
    //   console.error('Stdin ended, exiting...');
    //   await this.stop();
    //   process.exit(0);
    // });
  }

  async start(): Promise<void> {
    // Initialize context manager with project directory
    const projectDir = process.env.PROJECT_DIR || `${process.cwd()}/projects`;
    this.contextManager.setProjectDir(projectDir);

    // Load all project databases into memory for cross-project queries.
    // initAllDatabases only loads dirs that already contain store.db, so a
    // freshly-init'ed project (mkdir without a db) won't be picked up here.
    sqlite.initAllDatabases(projectDir);
    let loadedProjects = sqlite.getLoadedProjectIds();

    // Bootstrap a default project so the very first user call doesn't crash
    // with "no active project". This mirrors the web-server's behavior.
    // Without this, calling project_switch was a hidden prerequisite for any
    // mutation, even immediately after `understanding-graph init`.
    const defaultProject = process.env.DEFAULT_PROJECT || 'default';
    if (!loadedProjects.includes(defaultProject)) {
      const defaultPath = `${projectDir}/${defaultProject}`;
      try {
        sqlite.initDatabase(defaultPath);
        loadedProjects = sqlite.getLoadedProjectIds();
        console.error(
          `Bootstrapped default project: ${defaultProject} at ${defaultPath}`,
        );
      } catch (e) {
        console.error(
          `Failed to bootstrap default project at ${defaultPath}:`,
          e,
        );
      }
    } else {
      // Already loaded — just make sure it's the current project so the
      // first tool call has a target.
      try {
        sqlite.setCurrentProject(defaultProject);
      } catch {
        // setCurrentProject throws if not loaded; we already checked, so
        // any failure here is benign.
      }
    }

    // CRITICAL: also tell ContextManager about the active project, otherwise
    // its currentContext stays null and getCurrentProjectId() returns the
    // literal string 'default' regardless of what DEFAULT_PROJECT was set
    // to. The two project-state machines (sqlite's currentProjectId and
    // ContextManager's currentContext.projectId) need to agree at startup,
    // not just after the first project_switch call. Without this, every
    // tool call routed through contextManager.getCurrentProjectId() lands
    // in 'default' even when the agent set DEFAULT_PROJECT=foo or when
    // initAllDatabases loaded a non-default project as the only one
    // present.
    try {
      await this.contextManager.switchProject(defaultProject);
    } catch (e) {
      console.error(
        `Failed to set ContextManager active project to ${defaultProject}:`,
        e,
      );
    }

    // List available projects on startup
    const projects = this.contextManager.listProjects();
    if (projects.length > 0) {
      console.error(`Available projects: ${projects.join(', ')}`);
      console.error(`Loaded ${loadedProjects.length} database(s) into memory`);
    } else {
      console.error('No projects found. Use project_switch to create one.');
    }

    // Start MCP server
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error('Understanding Graph MCP Server v2 running (SQLite-only)');
  }

  async stop(): Promise<void> {
    sqlite.closeAllDatabases();
    console.error('Understanding Graph MCP Server stopped');
  }
}

// Start server
const server = new UnderstandingGraphServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
