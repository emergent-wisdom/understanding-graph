import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const packageRoot = path.resolve(process.env.UG_PACKAGE_ROOT || process.cwd());
const webEntry = path.resolve(
  process.env.UG_WEB_ENTRY || 'packages/web-server/dist/index.js',
);
const canonicalPath = path.resolve(
  process.env.UG_SERVER_JSON_PATH || path.join(packageRoot, 'server.json'),
);
const bundledPath = path.join(path.dirname(webEntry), 'server.json');
const canonicalText = fs.readFileSync(canonicalPath, 'utf8');
const bundledText = fs.readFileSync(bundledPath, 'utf8');

if (bundledText !== canonicalText) {
  throw new Error('Built web server contains a stale MCP discovery record.');
}

const expected = JSON.parse(canonicalText);
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'understanding-graph-web-smoke-'),
);
const port = await reservePort();
const child = spawn(process.execPath, [webEntry], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    PROJECT_DIR: path.join(temporaryDirectory, 'projects'),
    UG_FRONTEND_DIR: path.resolve(
      process.env.UG_FRONTEND_DIR ||
        path.join(packageRoot, 'packages/frontend/dist'),
    ),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

try {
  const response = await waitForDiscovery(port);
  if (!response.ok) {
    throw new Error(`Discovery returned HTTP ${response.status}.`);
  }

  const actual = await response.json();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Discovery response differs from the canonical server.json.');
  }
  if (
    actual.name !== 'io.github.emergent-wisdom/understanding-graph' ||
    actual.version !== '0.1.28'
  ) {
    throw new Error(`Unexpected discovery identity: ${JSON.stringify(actual)}`);
  }

  console.log(`Web discovery smoke passed (${actual.name} ${actual.version}).`);
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a loopback port.'));
        return;
      }
      const { port: availablePort } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(availablePort);
      });
    });
  });
}

async function waitForDiscovery(serverPort) {
  const deadline = Date.now() + 10_000;
  const url = `http://127.0.0.1:${serverPort}/.well-known/mcp/server.json`;

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Web server exited before discovery was ready.\n${stdout}\n${stderr}`,
      );
    }
    try {
      return await fetch(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Timed out waiting for web discovery.\n${stdout}\n${stderr}`);
}
