import type { RequestHandler } from 'express';

const MUTATION_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

const MUTATION_BLOCKED_PATHS = [
  '/api/graph/nodes',
  '/api/graph/edges',
  '/api/graph/documents',
  '/api/graph/batch',
  '/api/conversations',
  '/api/quotes',
];

function isAllowedOperationalMutation(path: string): boolean {
  return (
    path.includes('/embeddings/backfill') ||
    path.includes('/temporal/access') ||
    (path.includes('/documents/') &&
      (path.includes('/generate') || path.includes('/watch')))
  );
}

export function isRestMutationBlocked(
  method: string,
  path: string,
  allowRestMutations = false,
): boolean {
  if (allowRestMutations || !MUTATION_METHODS.has(method.toUpperCase())) {
    return false;
  }

  const isBlockedPath = MUTATION_BLOCKED_PATHS.some(
    (blockedPath) => path.startsWith(blockedPath) && !path.includes('/archive'),
  );
  return isBlockedPath && !isAllowedOperationalMutation(path);
}

export function createRestMutationFirewall(
  allowRestMutations = process.env.ALLOW_REST_MUTATIONS === 'true',
): RequestHandler {
  return (req, res, next) => {
    if (!isRestMutationBlocked(req.method, req.path, allowRestMutations)) {
      next();
      return;
    }

    res.status(405).json({
      error: 'REST mutations are disabled',
      message:
        'Use MCP tools (mcp__understanding-graph__*) to modify the graph. The REST API is read-only.',
      hint: 'See CLAUDE.md for API usage guidelines',
    });
  };
}
