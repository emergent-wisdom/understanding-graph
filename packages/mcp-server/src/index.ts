#!/usr/bin/env node
import { createRequire } from 'node:module';
import {
  EmbeddingService,
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

// Tool mode from environment (default: general). Fail closed to a known surface
// instead of accepting an arbitrary string that silently produces a hybrid.
const configuredToolMode = process.env.TOOL_MODE || 'general';
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

/**
 * Whether to warm the embedding model in the background at startup.
 *
 * Duplicate detection needs the model loaded in-process, and for most of this
 * tool's life nothing loaded it: the model is lazy, only explicit embedding
 * calls warmed it, and a session that never made one wrote its whole graph
 * unchecked while graph_batch's description asserted the check was running.
 * Measured cost of closing that gap: a cached load is ~205 ms and per-node
 * embedding ~3 ms, so warming is nearly free — EXCEPT the first ever run on a
 * machine, which downloads ~23 MB into node_modules. That is why this warms in
 * the background and never blocks a write, and why it can be declined:
 * embeddings remain an optional peer dependency, and setting
 * DISABLE_EMBEDDING_WARMUP=1 restores the old lazy behaviour exactly.
 */
export function embeddingWarmupEnabled(
  env: Record<string, string | undefined>,
): boolean {
  const flag = (env.DISABLE_EMBEDDING_WARMUP ?? '').trim().toLowerCase();
  return !(flag === '1' || flag === 'true');
}

function warmEmbeddingsInBackground(): void {
  EmbeddingService.preloadModel()
    .then(() => {
      console.error('[EmbeddingService] Warm: duplicate detection is active.');
    })
    .catch((error: unknown) => {
      // Optional dependency, optional feature: a failed warmup must never
      // take the server down, and the diagnostic already reports the cold
      // state honestly. One line so a human reading logs knows why.
      const reason = error instanceof Error ? error.message : String(error);
      console.error(
        `[EmbeddingService] Warmup failed; duplicate detection stays off (${reason.slice(0, 200)})`,
      );
    });
}

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

    // The host owns PROJECT_DIR. A fresh install stays empty until an agent or
    // user deliberately names a project with project_switch. Re-open the sole
    // existing project automatically; with several, require a choice. An
    // explicit DEFAULT_PROJECT remains an opt-in request to load or create it.
    const explicitDefault = Boolean(process.env.DEFAULT_PROJECT);
    const selectedProject = explicitDefault
      ? process.env.DEFAULT_PROJECT
      : loadedProjects.length === 1
        ? loadedProjects[0]
        : undefined;

    // initAllDatabases opens each store in turn, and initDatabase selects the
    // store it opens. With zero or several projects that implementation detail
    // must not become an implicit choice: keep every database available for
    // discovery while requiring project_switch before graph work begins.
    if (!selectedProject) {
      sqlite.clearCurrentProject();
    }

    if (selectedProject && !/^[a-zA-Z0-9_-]+$/.test(selectedProject)) {
      throw new Error(
        `Invalid DEFAULT_PROJECT: "${selectedProject}". Use only letters, numbers, underscores, and hyphens.`,
      );
    }

    if (!selectedProject && loadedProjects.length > 1) {
      console.error(
        `Multiple projects present (${loadedProjects.join(', ')}). ` +
          'Not auto-activating one — call project_switch to choose where ' +
          'this work belongs.',
      );
    } else if (selectedProject && !loadedProjects.includes(selectedProject)) {
      const selectedPath = `${projectDir}/${selectedProject}`;
      try {
        sqlite.initDatabase(selectedPath);
        loadedProjects = sqlite.getLoadedProjectIds();
        console.error(
          `Created explicitly requested project: ${selectedProject} at ${selectedPath}`,
        );
      } catch (e) {
        console.error(
          `Failed to load requested project at ${selectedPath}:`,
          e,
        );
      }
    } else if (selectedProject) {
      // Already loaded — just make sure it's the current project so the
      // first tool call has a target.
      try {
        sqlite.setCurrentProject(selectedProject);
      } catch {
        // setCurrentProject throws if not loaded; we already checked, so
        // any failure here is benign.
      }
    }

    // Keep ContextManager and SQLite on the same selected project.
    if (selectedProject) {
      try {
        await this.contextManager.switchProject(selectedProject);
      } catch (e) {
        console.error(
          `Failed to set ContextManager active project to ${selectedProject}:`,
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

    // After the transport is up, so a slow (or first-ever, ~23 MB) model load
    // never delays readiness. Fire-and-forget on purpose.
    if (embeddingWarmupEnabled(process.env)) {
      warmEmbeddingsInBackground();
    }
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
