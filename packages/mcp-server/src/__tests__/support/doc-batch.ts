import type { ContextManager } from '../../context-manager.js';
import { handleToolCall } from '../../tools/index.js';

/**
 * Document mutations, routed through the only path that will remain.
 *
 * graph_batch is where the invariants live: orphan prevention and its
 * post-execution sweep, duplicate detection, cross-mode checks, atomic
 * rollback, and the commit that gives every node and edge its provenance. A
 * mutation reachable outside it skips all of that — measured on doc_create
 * called standalone, the node is written, no commit row exists, and the node's
 * commit_id is empty.
 *
 * The document tests were written before that was settled and mutate by
 * calling the handlers directly, which is why closing the gap costs a port
 * rather than a one-line edit: the suite guarding the feature is written in
 * the idiom the fix forbids. These helpers exist so each file changes at its
 * call sites rather than throughout.
 *
 * Two behaviours differ from a direct call and the tests must account for
 * both. A batch reports refusal by returning success:false and rolling back
 * where a direct call threw, and it states the constraint in its own words —
 * usually more usefully, naming the remedy as well as the violation.
 */
export interface BatchResult {
  success: boolean;
  message?: string;
  error?: string;
  results?: Array<Record<string, unknown>>;
}

export type DocOperation = {
  tool: string;
  params: Record<string, unknown>;
};

/** Run operations through graph_batch and return the batch's own verdict. */
export async function docBatch(
  contextManager: ContextManager,
  mode: string,
  operations: DocOperation[],
  commitMessage = 'Document operation under test',
): Promise<BatchResult> {
  return (await handleToolCall(
    'graph_batch',
    {
      agent_name: 'test-agent',
      commit_message: commitMessage,
      operations,
    },
    contextManager,
    mode as never,
  )) as BatchResult;
}

/**
 * Run one operation that is expected to succeed, and return its result payload.
 *
 * Throws with the batch's message when refused, so a setup step that stops
 * working reports why instead of failing later as a missing id.
 */
export async function docOp<T = Record<string, unknown>>(
  contextManager: ContextManager,
  mode: string,
  tool: string,
  params: Record<string, unknown>,
  commitMessage?: string,
): Promise<T> {
  const result = await docBatch(
    contextManager,
    mode,
    [{ tool, params }],
    commitMessage ?? `Run ${tool} under test`,
  );
  if (!result.success) {
    throw new Error(
      `${tool} was refused by graph_batch: ${result.message ?? result.error}`,
    );
  }
  return (result.results?.[0] ?? {}) as T;
}

/**
 * handleToolCall's own shape, routed through graph_batch.
 *
 * Files with many scattered success-path calls port by swapping the function
 * name and nothing else, which keeps their existing result type casts intact
 * and keeps the diff readable as "same call, checked path".
 */
export async function docCall(
  tool: string,
  params: Record<string, unknown>,
  contextManager: ContextManager,
  mode = 'full',
): Promise<unknown> {
  return docOp(contextManager, mode, tool, params, `Run ${tool} under test`);
}
