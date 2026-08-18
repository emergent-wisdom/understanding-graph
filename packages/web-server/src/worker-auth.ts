import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { RequestHandler } from 'express';

function normalizedHost(host: string): string {
  const normalized = host.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

/** True only for an address that cannot accept a non-local connection. */
export function isLoopbackHost(host: string): boolean {
  const normalized = normalizedHost(host);
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  return normalized === '::ffff:127.0.0.1';
}

function tokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

function tokensMatch(expected: string, presented: string): boolean {
  return timingSafeEqual(tokenDigest(expected), tokenDigest(presented));
}

/**
 * Protect the sidecar's API/admin surface when it is deliberately exposed
 * beyond loopback. Local development keeps its existing no-token behavior.
 */
export function createWorkerAuthMiddleware({
  host,
  token,
}: {
  host: string;
  token?: string;
}): RequestHandler {
  if (isLoopbackHost(host)) {
    return (_req, _res, next) => next();
  }

  if (!token || token.trim().length === 0) {
    throw new Error(
      `UG_WORKER_TOKEN is required when HOST binds beyond loopback (${host}).`,
    );
  }

  return (req, res, next) => {
    const authorization = req.get('authorization') || '';
    const presented = authorization.toLowerCase().startsWith('bearer ')
      ? authorization.slice(7)
      : '';
    if (tokensMatch(token, presented)) {
      next();
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'WWW-Authenticate',
      'Bearer realm="understanding-graph-worker"',
    );
    res.status(401).json({ error: 'WORKER_AUTH_REQUIRED' });
  };
}
