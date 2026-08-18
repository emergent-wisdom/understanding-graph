#!/usr/bin/env node
import { createRequire } from 'node:module';
import {
  isEphemeralPath,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ContextManager } from './context-manager.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { SerialTaskQueue } from './serial-task-queue.js';
import {
  getToolDefinitions,
  handleToolCall,
  TOOL_MODES,
  type ToolMode,
} from './tools/index.js';

// Read the package version dynamically so serverInfo.version always matches
// the shipped package, not a hardcoded string that can drift out of sync.
const require = createRequire(import.meta.url);
const PACKAGE_VERSION: string = (
  require('../package.json') as { version: string }
).version;

// Tool mode from environment (default: full). Fail closed to a known surface
// instead of accepting an arbitrary string that silently produces a hybrid.
const configuredToolMode = process.env.TOOL_MODE || 'full';
if (!TOOL_MODES.includes(configuredToolMode as ToolMode)) {
  throw new Error(
    `Invalid TOOL_MODE "${configuredToolMode}". Choose one of: ${TOOL_MODES.join(', ')}`,
  );
}
const TOOL_MODE = configuredToolMode as ToolMode;

// Auto-log tool calls wrapper with two-phase logging for entity linking
async function handleToolCallWithLogging(
  name: string,
  args: Record<string, unknown>,
  contextManager: ContextManager,
): Promise<unknown> {
  // Simple pass-through - commits are tracked via graph_batch commit_message
  return handleToolCall(name, args, contextManager, TOOL_MODE);
}

/**
 * Say so, loudly, when the graph is being written somewhere the OS will delete.
 *
 * This tool's entire claim is that it is a persistent medium rather than a
 * scratch buffer, and it will run happily for days against a temp directory
 * without mentioning it. That happened: two projects and roughly two hundred
 * nodes were written under /private/tmp across two days, and a routine cleanup
 * removed them between sessions. The next call re-initialised an empty
 * database at the same path, so the directory looked intact and held nothing.
 *
 * The default is cwd/projects and is fine. The hazard is an explicit
 * PROJECT_DIR set to somewhere convenient at the start of what was expected to
 * be a short piece of work — which is precisely when nobody is thinking about
 * durability. One line at startup is the whole fix, and there was nothing.
 */

export { isEphemeralPath };

function warnIfEphemeral(projectDir: string): void {
  if (!isEphemeralPath(projectDir)) return;
  console.error(
    `WARNING: the graph is being stored under a temporary directory (${projectDir}). ` +
      'The operating system deletes these without notice, and a later run will ' +
      'silently recreate an empty database at the same path. Set PROJECT_DIR to ' +
      'a durable location before doing work you intend to keep.',
  );
}

class UnderstandingGraphServer {
  private server: Server;
  private contextManager: ContextManager;
  private toolCallQueue = new SerialTaskQueue();

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
      return this.toolCallQueue.run(async () => {
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
                type: 'text' as const,
                text:
                  typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: 'text' as const,
                text: `Error: ${message}`,
              },
            ],
            isError: true,
          };
        }
      });
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
    warnIfEphemeral(projectDir);

    // Load all project databases into memory for cross-project queries.
    // initAllDatabases only loads dirs that already contain store.db, so a
    // freshly-init'ed project (mkdir without a db) won't be picked up here.
    sqlite.initAllDatabases(projectDir);
    let loadedProjects = sqlite.getLoadedProjectIds();

    // Project activation is deliberately conditional.
    //
    // Auto-activating a project unconditionally removed the only forcing
    // function that made an agent CHOOSE where its work belongs: with a
    // project already live, `graph_understand` succeeds immediately and
    // everything lands in `default`, so unrelated work accumulates in one
    // store and retrieval gets noisier over time. The guidance to call
    // project_list() sits ~350 lines into the contract and does not survive
    // that convenience.
    //
    // But we must not reintroduce the original bug either: on a fresh
    // install the first call crashed with "no active project", making
    // project_switch a hidden prerequisite.
    //
    // So: activate when there is no real choice to make (explicit
    // DEFAULT_PROJECT, or zero/one project on disk), and stay unset when
    // several projects exist — there the "No active project" error is the
    // correct behavior, because it names the decision and how to make it.
    const explicitDefault = Boolean(process.env.DEFAULT_PROJECT);
    const defaultProject = process.env.DEFAULT_PROJECT || 'default';
    const shouldAutoActivate = explicitDefault || loadedProjects.length <= 1;

    if (!shouldAutoActivate) {
      console.error(
        `Multiple projects present (${loadedProjects.join(', ')}). ` +
          'Not auto-activating one — call project_switch to choose where ' +
          'this work belongs.',
      );
    } else if (!loadedProjects.includes(defaultProject)) {
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
    if (shouldAutoActivate) {
      try {
        await this.contextManager.switchProject(defaultProject);
      } catch (e) {
        console.error(
          `Failed to set ContextManager active project to ${defaultProject}:`,
          e,
        );
      }
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
