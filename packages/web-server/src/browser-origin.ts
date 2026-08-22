import type { RequestHandler } from 'express';
import { isLoopbackHost } from './worker-auth.js';

function requestProtocol(
  protocol: string,
  forwardedProtocol: string | undefined,
): string {
  return (forwardedProtocol?.split(',')[0]?.trim() || protocol).replace(
    /:$/,
    '',
  );
}

export function isSameRequestOrigin(
  origin: string,
  host: string,
  protocol: string,
): boolean {
  try {
    const parsed = new URL(origin);
    return parsed.host === host && parsed.protocol === `${protocol}:`;
  } catch {
    return false;
  }
}

/**
 * Keep the loopback web server from becoming a cross-site write primitive.
 * CLI/MCP clients normally send neither browser header and remain unaffected.
 */
export function createBrowserOriginGuard(serverHost: string): RequestHandler {
  return (req, res, next) => {
    const requestHost = req.get('host') || '';
    const hostName = requestHost.startsWith('[')
      ? requestHost.slice(1, requestHost.indexOf(']'))
      : requestHost.split(':')[0];
    if (isLoopbackHost(serverHost) && !isLoopbackHost(hostName)) {
      res.status(403).json({ error: 'Untrusted Host header' });
      return;
    }

    if (req.get('sec-fetch-site') === 'cross-site') {
      res.status(403).json({ error: 'Cross-site browser request rejected' });
      return;
    }

    const origin = req.get('origin');
    const protocol = requestProtocol(
      req.protocol,
      req.get('x-forwarded-proto'),
    );
    if (origin && !isSameRequestOrigin(origin, requestHost, protocol)) {
      res.status(403).json({ error: 'Cross-origin browser request rejected' });
      return;
    }

    next();
  };
}
