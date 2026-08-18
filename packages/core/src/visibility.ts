import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Read visibility for graph artifacts that are reserved for synthetic
 * Reader/CMP production. Access fails closed unless a caller explicitly enters
 * the synthetic Reader scope.
 */
export interface GraphVisibility {
  includeReservedThinking: boolean;
}

type MaybePromise<T> = T | Promise<T>;

const visibilityStorage = new AsyncLocalStorage<GraphVisibility>();

/**
 * Run a complete operation with one stable graph visibility. AsyncLocalStorage
 * keeps nested async work (including graph_batch recursion) in the same mode.
 */
export function withGraphVisibility<T>(
  visibility: GraphVisibility,
  operation: () => MaybePromise<T>,
): MaybePromise<T> {
  return visibilityStorage.run(visibility, operation);
}

/**
 * Convenience wrapper used by mode-aware integrations such as the MCP server.
 */
export function withReservedThinkingVisibility<T>(
  includeReservedThinking: boolean,
  operation: () => MaybePromise<T>,
): MaybePromise<T> {
  return withGraphVisibility({ includeReservedThinking }, operation);
}

/**
 * Fail closed: only an explicit synthetic Reader/CMP scope may expose reserved
 * artifacts. This also protects direct core consumers and unscoped web routes.
 */
export function reservedThinkingVisible(): boolean {
  return visibilityStorage.getStore()?.includeReservedThinking ?? false;
}

/**
 * Recognize both current GraphNodeData and raw/legacy SQLite row shapes.
 */
export function isReservedThinkingNode(
  node:
    | {
        trigger?: unknown;
        fileType?: unknown;
        file_type?: unknown;
      }
    | null
    | undefined,
): boolean {
  if (!node) return false;
  const trigger = typeof node.trigger === 'string' ? node.trigger : '';
  const fileTypes = [node.fileType, node.file_type].filter(
    (value): value is string => typeof value === 'string',
  );
  return (
    trigger.trim().toLowerCase() === 'thinking' ||
    fileTypes.some((fileType) => fileType.trim().toLowerCase() === 'thinking')
  );
}

export function graphNodeVisible(
  node:
    | {
        trigger?: unknown;
        fileType?: unknown;
        file_type?: unknown;
      }
    | null
    | undefined,
): boolean {
  return reservedThinkingVisible() || !isReservedThinkingNode(node);
}
