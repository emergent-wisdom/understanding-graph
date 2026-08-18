import fs from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {
  getGraphStore,
  listTextSources,
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLOUD_SAFE_TOOL_NAMES,
  createMcpGatewayRouter,
  MCP_JSON_BODY_LIMIT,
} from './mcp-gateway.js';

const PROJECT_ID = 'graph-a';

let server: Server | undefined;
let temporaryDirectory: string;
let baseUrl: string;

beforeEach(async () => {
  temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-mcp-gateway-'),
  );
  const projectPath = path.join(temporaryDirectory, PROJECT_ID);
  sqlite.initDatabase(projectPath);
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();

  const app = express();
  app.use('/api/mcp', express.json({ limit: MCP_JSON_BODY_LIMIT }));
  app.use(express.json());
  app.use((req, _res, next) => {
    req.projectId = PROJECT_ID;
    next();
  });
  app.use(
    '/api/mcp',
    createMcpGatewayRouter({ projectDir: temporaryDirectory }),
  );

  server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1');
    listeningServer.once('error', reject);
    listeningServer.once('listening', () => resolve(listeningServer));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  if (server) {
    const activeServer = server;
    await new Promise<void>((resolve, reject) => {
      activeServer.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  }
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe('graph-scoped cloud MCP gateway', () => {
  it('advertises a general ordinary surface without project, watcher, or synthetic thinking capabilities', async () => {
    const response = await fetch(`${baseUrl}/api/mcp/tools`);
    expect(response.status).toBe(200);
    const catalog = (await response.json()) as {
      instructions: string;
      tools: Array<{
        name: string;
        description?: string;
        inputSchema: {
          properties?: Record<string, unknown>;
        };
      }>;
    };
    const names = new Set(catalog.tools.map((tool) => tool.name));

    expect(catalog.instructions).toContain(
      'active medium for **recursive, emergent understanding**',
    );
    expect(catalog.instructions).toContain(
      'already bound to one authorized graph',
    );
    expect(catalog.instructions).not.toContain('project_switch');
    expect(catalog.instructions).not.toContain('project_list');
    expect(names.has('graph_understand')).toBe(true);
    expect(names.has('doc_create')).toBe(false);
    expect(names.has('doc_get_tree')).toBe(true);
    expect(names.has('graph_batch')).toBe(true);
    expect(names.has('source_load')).toBe(true);
    expect(names.has('source_read')).toBe(true);
    expect(names.has('graph_discover_grounded')).toBe(true);
    expect(names.has('solver_spawn')).toBe(false);
    expect(names.has('source_delete')).toBe(false);
    expect(names.has('graph_purge')).toBe(false);
    expect(names.has('doc_revise')).toBe(false);
    expect(names.has('doc_merge')).toBe(false);
    expect(names.has('doc_to_concept')).toBe(false);
    expect(names.has('doc_link_concept')).toBe(false);
    expect(names.has('doc_weave')).toBe(false);
    expect(names.has('doc_generate')).toBe(false);
    expect(names.has('doc_generate_all')).toBe(false);

    const batch = catalog.tools.find((tool) => tool.name === 'graph_batch');
    const operationNames =
      (
        batch?.inputSchema.properties?.operations as {
          items?: {
            properties?: { tool?: { enum?: string[] } };
          };
        }
      )?.items?.properties?.tool?.enum || [];
    expect(operationNames).toContain('doc_create');
    expect(operationNames).toContain('doc_revise');
    expect(operationNames).toContain('doc_merge');
    expect(operationNames).toContain('doc_to_concept');
    expect(operationNames).toContain('doc_link_concept');
    expect(operationNames).toContain('doc_weave');
    expect(operationNames).toContain('doc_create_passages');

    expect(names.has('project_switch')).toBe(false);
    expect(names.has('project_list')).toBe(false);
    expect(names.has('doc_watch_start')).toBe(false);
    expect(names.has('doc_watch_stop')).toBe(false);
    expect(names.has('doc_insert_thinking')).toBe(false);
    expect(names.has('doc_append_thinking')).toBe(false);
    expect(names.has('translate_thinking')).toBe(false);
    expect([...names].sort()).toEqual([...CLOUD_SAFE_TOOL_NAMES].sort());

    const findByTrigger = catalog.tools.find(
      (tool) => tool.name === 'graph_find_by_trigger',
    );
    const triggerValues = (
      findByTrigger?.inputSchema.properties?.trigger as {
        enum?: string[];
      }
    )?.enum;
    expect(triggerValues).not.toContain('thinking');

    for (const tool of catalog.tools) {
      expect(tool.inputSchema.properties).not.toHaveProperty('project');
      expect(tool.inputSchema.properties).not.toHaveProperty('projectId');
      expect(tool.inputSchema.properties).not.toHaveProperty('project_id');
    }
    expect(batch?.inputSchema.properties).not.toHaveProperty('author');

    const sourceLoad = catalog.tools.find(
      (tool) => tool.name === 'source_load',
    );
    expect(sourceLoad?.inputSchema.properties).not.toHaveProperty('filePath');
    expect(sourceLoad?.description).toContain('provide content directly');
  });

  it('rejects server filesystem paths before source_load can persist anything', async () => {
    const secretPath = path.join(temporaryDirectory, 'sidecar-secret.txt');
    fs.writeFileSync(secretPath, 'SIDE_CAR_SECRET_MUST_NOT_BE_READ');

    const response = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'source_load',
        arguments: {
          title: 'Attempted server path read',
          filePath: secretPath,
        },
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'MCP_CLOUD_ARGUMENT_NOT_ALLOWED',
    });
    expect(listTextSources(PROJECT_ID)).toEqual([]);
  });

  it('accepts a bounded source larger than the Express default body limit', async () => {
    const content = `A long hosted source.\n${'evidence '.repeat(20_000)}`;
    expect(Buffer.byteLength(content)).toBeGreaterThan(100_000);

    const response = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'source_load',
        arguments: {
          title: 'A paper-sized hosted source',
          sourceType: 'paper',
          content,
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.not.toMatchObject({ isError: true });
    expect(listTextSources(PROJECT_ID)).toHaveLength(1);
  });

  it('rejects an MCP body beyond the explicit hosted limit', async () => {
    const response = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'source_load',
        arguments: {
          title: 'An unbounded source',
          sourceType: 'paper',
          content: 'x'.repeat(2_200_000),
        },
      }),
    });

    expect(response.status).toBe(413);
    expect(listTextSources(PROJECT_ID)).toEqual([]);
  });

  it('writes an addressable document tree through graph_batch and records a server-owned author', async () => {
    const response = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'graph_batch',
        arguments: {
          commit_message: 'Create an addressable opening scene',
          agent_name: 'cloud-test-agent',
          author: '@cloud-user',
          operations: [
            {
              tool: 'doc_create',
              params: {
                title: 'Cloud Story',
                content: 'A graph-native draft.',
                fileType: 'markdown',
                isDocRoot: true,
                level: 'document',
              },
            },
            {
              tool: 'doc_create_passages',
              params: {
                parentId: '$0.id',
                title: 'Opening',
                passages: [
                  {
                    title: 'The signal arrives',
                    content: 'At midnight, the ocean began answering in light.',
                    level: 'paragraph',
                  },
                  {
                    title: 'The answer changes the watcher',
                    content: 'Mara understood that it had learned her name.',
                    level: 'paragraph',
                  },
                ],
              },
            },
          ],
        },
      }),
    });

    expect(response.status).toBe(200);
    const mcpResult = (await response.json()) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(mcpResult.isError).not.toBe(true);
    const payload = JSON.parse(mcpResult.content[0].text) as {
      success: boolean;
    };
    expect(payload).toMatchObject({ success: true });

    const nodes = getGraphStore().getAll().nodes;
    expect(nodes.map((node) => node.title)).toEqual(
      expect.arrayContaining([
        'Cloud Story',
        'Opening',
        'The signal arrives',
        'The answer changes the watcher',
      ]),
    );
    expect(sqlite.getRecentCommits(1)[0]).toMatchObject({
      message: 'Create an addressable opening scene',
      agentName: 'cloud-test-agent',
      author: '@cloud-user',
    });
  });

  it('forwards a trusted author into source_read internal commits', async () => {
    const loaded = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'source_load',
        arguments: {
          title: 'Hosted research passage',
          content: 'A bounded passage whose provenance must name the user.',
          sourceType: 'article',
        },
      }),
    });
    expect(loaded.status).toBe(200);
    const sourceId = listTextSources(PROJECT_ID)[0]?.id;
    expect(sourceId).toBeTruthy();

    const read = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'source_read',
        arguments: {
          sourceId,
          chars: 200,
          commit_message: 'Read the first hosted research passage',
          author: '@cloud-reader',
        },
      }),
    });
    expect(read.status).toBe(200);
    await expect(read.json()).resolves.not.toMatchObject({ isError: true });
    expect(sqlite.getRecentCommits(1)[0]).toMatchObject({
      message: 'Read the first hosted research passage',
      agentName: 'source_reader',
      author: '@cloud-reader',
    });
  });

  it('rejects top-level and nested project overrides', async () => {
    const topLevel = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'graph_understand',
        arguments: { query: 'look elsewhere', project: 'graph-b' },
      }),
    });
    expect(topLevel.status).toBe(400);
    await expect(topLevel.json()).resolves.toMatchObject({
      error: 'MCP_PROJECT_OVERRIDE_NOT_ALLOWED',
    });

    const nested = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'graph_batch',
        arguments: {
          commit_message: 'try to escape the graph scope',
          operations: [
            {
              tool: 'doc_create',
              params: {
                title: 'Wrong graph',
                isDocRoot: true,
                project: 'graph-b',
              },
            },
          ],
        },
      }),
    });
    expect(nested.status).toBe(400);
    await expect(nested.json()).resolves.toMatchObject({
      error: 'MCP_PROJECT_OVERRIDE_NOT_ALLOWED',
    });
    expect(getGraphStore().getAll().nodes).toEqual([]);
  });

  it('keeps reserved synthetic thinking writes out of the ordinary cloud mode', async () => {
    const response = await fetch(`${baseUrl}/api/mcp/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'graph_batch',
        arguments: {
          commit_message: 'This reserved write must fail',
          operations: [
            {
              tool: 'doc_create',
              params: {
                title: 'Synthetic inner voice',
                content: 'Reserved content',
                fileType: 'thinking',
                isDocRoot: true,
              },
            },
          ],
        },
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ isError: true });
    expect(getGraphStore().getAll().nodes).toEqual([]);
  });
});
