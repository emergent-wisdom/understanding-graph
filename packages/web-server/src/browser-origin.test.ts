import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createBrowserOriginGuard,
  isSameRequestOrigin,
} from './browser-origin.js';

let server: Server | undefined;
let baseUrl: string;

beforeEach(async () => {
  const app = express();
  app.use(createBrowserOriginGuard('127.0.0.1'));
  app.all('/probe', (_req, res) => res.json({ ok: true }));
  server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1');
    listeningServer.once('error', reject);
    listeningServer.once('listening', () => resolve(listeningServer));
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  if (!server) return;
  const activeServer = server;
  server = undefined;
  await new Promise<void>((resolve, reject) => {
    activeServer.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('browser origin guard', () => {
  it('allows non-browser clients and same-origin browser requests', async () => {
    expect((await fetch(`${baseUrl}/probe`)).status).toBe(200);
    expect(
      (
        await fetch(`${baseUrl}/probe`, {
          headers: { origin: baseUrl, 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(200);
  });

  it('rejects cross-site browser reads and writes', async () => {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(`${baseUrl}/probe`, {
        method,
        headers: {
          origin: 'https://malicious.example',
          'sec-fetch-site': 'cross-site',
        },
      });
      expect(response.status).toBe(403);
    }
  });

  it('compares origin, host, and scheme exactly', () => {
    expect(
      isSameRequestOrigin('http://127.0.0.1:3030', '127.0.0.1:3030', 'http'),
    ).toBe(true);
    expect(
      isSameRequestOrigin('https://127.0.0.1:3030', '127.0.0.1:3030', 'http'),
    ).toBe(false);
    expect(isSameRequestOrigin('not a URL', '127.0.0.1:3030', 'http')).toBe(
      false,
    );
  });
});
