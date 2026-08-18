import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkerAuthMiddleware, isLoopbackHost } from './worker-auth.js';

let server: Server | undefined;

afterEach(async () => {
  if (!server) return;
  const activeServer = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) => (error ? reject(error) : resolve()));
  });
});

async function startProbe(host: string, token?: string): Promise<string> {
  const app = express();
  const auth = createWorkerAuthMiddleware({ host, token });
  app.use(['/api', '/admin'], auth);
  app.get('/api/probe', (_req, res) => res.json({ ok: true }));
  app.get('/admin/probe', (_req, res) => res.json({ ok: true }));
  app.get('/public', (_req, res) => res.json({ ok: true }));

  server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1');
    listeningServer.once('error', reject);
    listeningServer.once('listening', () => resolve(listeningServer));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('worker endpoint authentication', () => {
  it.each([
    'localhost',
    '127.0.0.1',
    '127.24.3.2',
    '::1',
    '[::1]',
    '::ffff:127.0.0.1',
  ])('recognizes loopback host %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true);
  });

  it.each(['0.0.0.0', '::', '192.168.1.20', 'worker.internal'])(
    'requires authentication for non-loopback host %s',
    (host) => {
      expect(isLoopbackHost(host)).toBe(false);
      expect(() => createWorkerAuthMiddleware({ host })).toThrow(
        /UG_WORKER_TOKEN is required/,
      );
    },
  );

  it('leaves the loopback API unchanged when no token is configured', async () => {
    const baseUrl = await startProbe('127.0.0.1');
    expect((await fetch(`${baseUrl}/api/probe`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/admin/probe`)).status).toBe(200);
  });

  it('protects API and admin routes while leaving public assets reachable', async () => {
    const baseUrl = await startProbe('0.0.0.0', 'correct worker secret');

    expect((await fetch(`${baseUrl}/api/probe`)).status).toBe(401);
    expect(
      (
        await fetch(`${baseUrl}/api/probe`, {
          headers: { authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(401);
    expect((await fetch(`${baseUrl}/admin/probe`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/public`)).status).toBe(200);

    for (const pathname of ['/api/probe', '/admin/probe']) {
      const response = await fetch(`${baseUrl}${pathname}`, {
        headers: { authorization: 'Bearer correct worker secret' },
      });
      expect(response.status).toBe(200);
    }
  });
});
