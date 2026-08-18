/**
 * In-process capability for the dedicated document macros that temporarily
 * detach and rebuild a validated contains/next chain inside one graph_batch.
 * MCP/JSON callers cannot manufacture a Symbol value, so generic edge tools
 * remain unable to mutate document structure.
 */
export const ATOMIC_DOCUMENT_REWIRE = Symbol('atomic-document-rewire');

export function hasAtomicDocumentRewireCapability(
  args: Record<string, unknown>,
): boolean {
  return args.__atomicDocumentRewire === ATOMIC_DOCUMENT_REWIRE;
}
