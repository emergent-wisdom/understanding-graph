#!/usr/bin/env node
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
        version: '1.0.0',
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

    // Load all project databases into memory for cross-project queries
    sqlite.initAllDatabases(projectDir);
    const loadedProjects = sqlite.getLoadedProjectIds();

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
