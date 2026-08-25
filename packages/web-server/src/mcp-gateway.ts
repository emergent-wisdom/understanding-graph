import {
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import {
  ContextManager,
  type GuidanceMode,
  getServerInstructions,
  getToolDefinitions,
  handleToolCall,
  PROJECT_SELECTION_INSTRUCTIONS,
  SerialTaskQueue,
  UNDERSTANDING_PROTOCOL_ID,
} from '@emergent-wisdom/understanding-graph-mcp-server';
import { Router } from 'express';

// Large enough for ordinary papers and chapters supplied to source_load, yet
// deliberately bounded so the hosted sidecar cannot be used as an unbounded
// request buffer. The public Undergraph proxy applies its own tighter abuse
// controls before traffic reaches this process.
export const MCP_JSON_BODY_LIMIT = '2mb';

// A hosted graph may carry research, code, prose, or several of them over its
// lifetime. Advertise the union of the focused ordinary workflows, while the
// graph-scoped gateway continues to remove project/admin capabilities. Calls
// dispatch through ordinary `full` so shared batch primitives are not silently
// constrained by whichever focused catalog happened to list graph_batch first.
const CLOUD_CATALOG_MODES = [
  'reading',
  'research',
  'coding',
  'collaborative_coding',
  'writing',
] as const;
const CLOUD_DISPATCH_MODE = 'full' as const;

function cloudInstructions(guidanceMode: GuidanceMode): string {
  return [
    'CLOUD GRAPH SCOPE: This connection is already bound to one authorized graph. Do not list, select, create, or switch projects. Use the advertised tools only.',
    '',
    ...getServerInstructions(guidanceMode)
      .replace(PROJECT_SELECTION_INSTRUCTIONS, '')
      .split('\n')
      .filter(
        (line) =>
          !line.includes('project_list') &&
          !line.includes('project_switch') &&
          !line.includes('solver_claim_task'),
      ),
  ].join('\n');
}

// Cloud exposure is an explicit capability list, not the complement of a small
// denylist. New local/admin/solver tools must be reviewed before they can reach
// a hosted graph token.
export const CLOUD_SAFE_TOOL_NAMES = [
  'graph_understand',
  'graph_find_by_trigger',
  'graph_context',
  'graph_context_region',
  'graph_skeleton',
  'graph_path',
  'graph_analyze',
  'graph_updates',
  'graph_history',
  'graph_similar',
  'graph_semantic_search',
  'graph_suggest_next',
  'graph_practice',
  'graph_thermostat',
  'graph_batch',
  'graph_bisociate',
  'graph_discover',
  'graph_discover_grounded',
  'graph_random',
  'source_load',
  'source_read',
  'source_position',
  'source_list',
  'source_export',
  'doc_list_roots',
  'doc_get_tree',
  'doc_get_children',
  'doc_get_chain',
  'doc_flatten',
  'doc_get_concepts',
  'doc_get_path',
  'doc_navigate',
  'doc_read',
  'node_get_metadata',
] as const;
const cloudSafeToolNames = new Set<string>(CLOUD_SAFE_TOOL_NAMES);

const PROJECT_ARGUMENT_KEYS = ['project', 'projectId', 'project_id'] as const;
const CLOUD_FORBIDDEN_ARGUMENTS = new Map<string, readonly string[]>([
  ['source_load', ['filePath']],
]);

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.hasOwn(object, key);
}

function hasProjectOverride(name: string, args: JsonObject): boolean {
  if (PROJECT_ARGUMENT_KEYS.some((key) => hasOwn(args, key))) return true;

  if (name !== 'graph_batch' || !Array.isArray(args.operations)) return false;
  return args.operations.some((operation) => {
    if (!isJsonObject(operation) || !isJsonObject(operation.params)) {
      return false;
    }
    return PROJECT_ARGUMENT_KEYS.some((key) =>
      hasOwn(operation.params as JsonObject, key),
    );
  });
}

function hasForbiddenCloudArgument(name: string, args: JsonObject): boolean {
  return (CLOUD_FORBIDDEN_ARGUMENTS.get(name) || []).some((key) =>
    hasOwn(args, key),
  );
}

/**
 * Return the union of focused ordinary workflow tools, projected for a graph-
 * scoped cloud capability. The local project selector and server-owned author
 * field are intentionally absent from what an agent can choose.
 */
export function getCloudToolDefinitions() {
  const toolsByName = new Map(
    CLOUD_CATALOG_MODES.flatMap((mode) => getToolDefinitions(mode)).map(
      (tool) => [tool.name, tool] as const,
    ),
  );

  return [...toolsByName.values()]
    .filter((tool) => cloudSafeToolNames.has(tool.name))
    .map((tool) => {
      const projected = structuredClone(tool);
      const schema = projected.inputSchema as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      if (schema.properties) {
        for (const key of PROJECT_ARGUMENT_KEYS) {
          delete schema.properties[key];
        }
        if (projected.name === 'graph_batch') {
          // The authenticated Undergraph proxy supplies this value.
          delete schema.properties.author;
        }
        if (projected.name === 'source_load') {
          // Hosted clients may stage supplied text, but must never ask the
          // sidecar process to read an arbitrary path from its filesystem.
          delete schema.properties.filePath;
          projected.description =
            'Load supplied text for chronological reading when sequence matters: books, papers, articles, transcripts, or similar texts. Hosted clients must provide content directly; server filesystem paths are unavailable.';
        }
      }
      if (schema.required) {
        schema.required = schema.required.filter(
          (key) =>
            !PROJECT_ARGUMENT_KEYS.includes(
              key as (typeof PROJECT_ARGUMENT_KEYS)[number],
            ) && !(projected.name === 'graph_batch' && key === 'author'),
        );
      }
      return projected;
    });
}

function toMcpResult(result: unknown) {
  const serialized =
    typeof result === 'string'
      ? result
      : (JSON.stringify(result, null, 2) ?? String(result));
  return { content: [{ type: 'text' as const, text: serialized }] };
}

function redactCloudResult(name: string, result: unknown): unknown {
  if (!isJsonObject(result)) return result;
  const redacted = structuredClone(result);
  if (name === 'graph_practice') {
    const worked = redacted.worked;
    if (!Array.isArray(worked)) return redacted;

    for (const item of worked) {
      if (!isJsonObject(item) || item.key !== 'store_durability') continue;
      item.value = 'server-managed (path withheld)';
      item.reading =
        'Hosted storage durability is managed by the service; local filesystem diagnostics are withheld.';
    }
  }

  if (name === 'graph_batch' && Array.isArray(redacted.regeneratedDocuments)) {
    for (const document of redacted.regeneratedDocuments) {
      if (!isJsonObject(document) || typeof document.outputPath !== 'string')
        continue;
      document.outputPath = '[server path redacted]';
    }
  }
  return redacted;
}

export interface McpGatewayOptions {
  projectDir: string;
  guidanceMode?: GuidanceMode;
}

/**
 * HTTP transport for the graph-scoped cloud MCP bridge.
 *
 * Authentication and graph authorization remain the responsibility of the
 * caller that mounts/proxies this router. Every call is rebound to the
 * authorized req.projectId inside one process-wide queue before dispatch.
 */
export function createMcpGatewayRouter({
  projectDir,
  guidanceMode = 'guided',
}: McpGatewayOptions) {
  const router = Router();
  const queue = new SerialTaskQueue();
  const contextManager = new ContextManager();
  const tools = getCloudToolDefinitions();
  const allowedToolNames = new Set(tools.map((tool) => tool.name));

  contextManager.setProjectDir(projectDir);

  router.get('/tools', (_req, res) => {
    res.json({
      protocol: UNDERSTANDING_PROTOCOL_ID,
      instructions: cloudInstructions(guidanceMode),
      tools,
    });
  });

  router.post('/call', async (req, res) => {
    if (!isJsonObject(req.body)) {
      return res.status(400).json({
        error: 'INVALID_MCP_CALL',
        message: 'Request body must be a JSON object.',
      });
    }

    const name = req.body.name;
    const rawArgs = req.body.arguments ?? {};
    if (typeof name !== 'string' || name.length === 0) {
      return res.status(400).json({
        error: 'INVALID_MCP_CALL',
        message: 'name must be a non-empty tool name.',
      });
    }
    if (!isJsonObject(rawArgs)) {
      return res.status(400).json({
        error: 'INVALID_MCP_CALL',
        message: 'arguments must be a JSON object.',
      });
    }
    if (!allowedToolNames.has(name)) {
      return res.status(404).json({
        error: 'MCP_TOOL_NOT_AVAILABLE',
        message: `Tool "${name}" is not available through the graph-scoped cloud gateway.`,
      });
    }
    if (hasProjectOverride(name, rawArgs)) {
      return res.status(400).json({
        error: 'MCP_PROJECT_OVERRIDE_NOT_ALLOWED',
        message:
          'This MCP connection is already bound to one graph. Tool arguments cannot select another project.',
      });
    }
    if (hasForbiddenCloudArgument(name, rawArgs)) {
      return res.status(400).json({
        error: 'MCP_CLOUD_ARGUMENT_NOT_ALLOWED',
        message:
          'This hosted MCP connection cannot ask the graph service to read server filesystem paths. Supply source content directly.',
      });
    }
    if (!req.projectId) {
      return res.status(400).json({
        error: 'MCP_PROJECT_REQUIRED',
        message: 'The authenticated request is not bound to a graph project.',
      });
    }

    return queue.run(async () => {
      try {
        const context = await contextManager.getContext(req.projectId, false);
        // The core store is process-global. Reassert the authorized project on
        // every queued call even when ContextManager already has a context,
        // because read-only REST traffic may have selected another database.
        sqlite.setCurrentProject(context.projectId);
        resetGraphStore();

        const result = await handleToolCall(
          name,
          rawArgs,
          contextManager,
          CLOUD_DISPATCH_MODE,
          false,
          guidanceMode,
        );
        return res.json(toMcpResult(redactCloudResult(name, result)));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.json({
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true,
        });
      }
    });
  });

  return router;
}
