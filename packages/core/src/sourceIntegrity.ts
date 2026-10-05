import { AsyncLocalStorage } from 'node:async_hooks';
import { listTextSources } from './database/sqlite.js';
import { getGraphStore } from './services/GraphStore.js';
import { isReservedThinkingNode } from './visibility.js';

/**
 * Passages committed by source_read are the record of what a source said.
 * Interpretations link to them (learned_from, contextualizes, ...); they do
 * not rewrite, move, split, merge, replace or rename them, and nothing else
 * is inserted into the source document between them.
 *
 * Only server code that owns the source chain (source_read and the dedicated
 * synthetic thinking tools) enters this scope. Nothing an agent supplies can.
 */
const sourceChainWrites = new AsyncLocalStorage<true>();

export function withSourceChainWrites<T>(operation: () => T): T {
  return sourceChainWrites.run(true, operation);
}

export function sourceChainWritesAllowed(): boolean {
  return sourceChainWrites.getStore() === true;
}

function sourceRootIds(): Set<string> {
  return new Set(
    listTextSources()
      .map((source) => source.rootNodeId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );
}

/**
 * True for a source root and for anything in its document: the passages read
 * from the source and any thinking block appended into that chain.
 */
export function isInsideSourceDocument(nodeId: string): boolean {
  const roots = sourceRootIds();
  if (roots.size === 0) return false;
  if (roots.has(nodeId)) return true;
  const path = getGraphStore().getDocumentPath(nodeId);
  return Boolean(path && path.length > 0 && roots.has(path[0].id));
}

/**
 * True for a source root or a passage read from the source. Thinking blocks in
 * the same chain are governed by the synthetic thinking tools instead.
 */
export function isSourceDocumentNode(nodeId: string): boolean {
  const node = getGraphStore().getNode(nodeId);
  if (!node || isReservedThinkingNode(node)) return false;
  return isInsideSourceDocument(nodeId);
}

export const SOURCE_PASSAGE_IMMUTABLE = 'SOURCE_PASSAGE_IMMUTABLE';

export function sourcePassageImmutableMessage(tool: string): string {
  return `${tool} cannot change a source document. Passages read from a source are the record of what it said: link your interpretation to the passage (for example with learned_from) instead of changing it, and keep new material outside the source document.`;
}
