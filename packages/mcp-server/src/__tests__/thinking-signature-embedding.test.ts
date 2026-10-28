import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  EmbeddingService,
  getGraphStore,
  resetGraphStore,
  sqlite,
  THINKING_IDENTITY_PREAMBLE,
  withReservedThinkingVisibility,
} from '@emergent-wisdom/understanding-graph-core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContextManager } from '../context-manager.js';
import { handleToolCall } from '../tools/index.js';

let directory: string;
let context: ContextManager;
let embeddedSignatures: string[];

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ug-thinking-embedding-'));
  const projects = path.join(directory, 'projects');
  fs.mkdirSync(path.join(projects, 'neutral'), { recursive: true });
  context = new ContextManager();
  context.setProjectDir(projects);
  sqlite.initAllDatabases(projects);
  sqlite.initDatabase(path.join(projects, 'neutral'));
  sqlite.setCurrentProject('neutral');
  await context.switchProject('neutral');
  embeddedSignatures = [];
  vi.spyOn(EmbeddingService, 'isModelLoaded').mockReturnValue(true);
  vi.spyOn(EmbeddingService, 'generateEmbedding').mockResolvedValue(new Float32Array([1, 0]));
  vi.spyOn(getGraphStore(), 'generateAndStoreEmbedding').mockImplementation(async (id) => {
    const node = getGraphStore().getNode(id)!;
    if (node.trigger === 'thinking') embeddedSignatures.push(node.understanding || '');
    sqlite.getDb().prepare('UPDATE nodes SET embedding = ? WHERE id = ?')
      .run(EmbeddingService.embeddingToBuffer(new Float32Array([1, 0])), id);
    getGraphStore().invalidateCache();
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  sqlite.closeAllDatabases();
  resetGraphStore();
  fs.rmSync(directory, { recursive: true, force: true });
});

async function append() {
  const source = await handleToolCall('source_load', {
    title: 'Neutral fixture', content: 'A garden gate remains open.', sourceType: 'article',
  }, context, 'synthetic_reader') as {sourceId: string};
  const passage = await handleToolCall('source_read', {
    sourceId: source.sourceId, chars: 100, commit_message: 'Read neutral passage',
  }, context, 'synthetic_reader') as {contentNodeId: string};
  const result = await handleToolCall('doc_append_thinking', {
    sourceId: source.sourceId, title: 'Trust and an open gate',
    thought: `${THINKING_IDENTITY_PREAMBLE} The open gate suggests trust rather than certainty.`,
    agentId: 'creator', synthesizes_nodes: [passage.contentNodeId],
    commit_message: 'Reflect on neutral passage',
  }, context, 'synthetic_reader') as {success: boolean; thinkingNodeId: string};
  expect(result.success).toBe(true);
  return result.thinkingNodeId;
}

function node(id: string) {
  return withReservedThinkingVisibility(true, () => getGraphStore().getNode(id)!);
}

it('keeps auto-signed thoughts in semantic retrieval using their final signature fields', async () => {
  const id = await append();
  expect(node(id).embedding).toBeTruthy();
  expect(JSON.parse(embeddedSignatures.at(-1)!).signatures[0].agentId).toBe('creator');
  const result = await handleToolCall('graph_semantic_search', {query: 'trust', limit: 100},
    context, 'synthetic_reader') as {searchMode: string; results: {id: string}[]};
  expect(result.searchMode).toBe('semantic');
  expect(result.results.some((match) => match.id === id)).toBe(true);
});

it('refreshes embeddings after a second signer changes the semantic field', async () => {
  const id = await append();
  const result = await handleToolCall('doc_sign_thinking', {
    thinkingId: id, agentId: 'reviewer', contribution: 'Examined trust',
  }, context, 'synthetic_reader') as {success: boolean};
  expect(result.success).toBe(true);
  expect(node(id).embedding).toBeTruthy();
  expect(JSON.parse(embeddedSignatures.at(-1)!).signatures.map((s: {agentId: string}) => s.agentId))
    .toEqual(['creator', 'reviewer']);
});

it('keeps signatures usable without loading the optional embedding model', async () => {
  vi.mocked(EmbeddingService.isModelLoaded).mockReturnValue(false);
  const id = await append();
  expect(JSON.parse(node(id).understanding!).signatures[0].agentId).toBe('creator');
  const beforeSigning = embeddedSignatures.length;
  const result = await handleToolCall('doc_sign_thinking', {
    thinkingId: id, agentId: 'reviewer', contribution: 'Reviewed without embeddings',
  }, context, 'synthetic_reader') as {success: boolean};
  expect(result.success).toBe(true);
  expect(embeddedSignatures).toHaveLength(beforeSigning);
  expect(embeddedSignatures.filter((value) => value.includes('Created this thinking'))).toEqual([]);
});

it('preserves successful signature writes when optional embedding generation reports failure', async () => {
  vi.mocked(getGraphStore().generateAndStoreEmbedding).mockResolvedValue(false);
  const id = await append();
  expect(node(id).embedding).toBeFalsy();
  const result = await handleToolCall('doc_sign_thinking', {
    thinkingId: id, agentId: 'reviewer', contribution: 'Reviewed during model failure',
  }, context, 'synthetic_reader') as {success: boolean};
  expect(result.success).toBe(true);
  expect(JSON.parse(node(id).understanding!).signatures).toHaveLength(2);
  expect(node(id).embedding).toBeFalsy();
});
