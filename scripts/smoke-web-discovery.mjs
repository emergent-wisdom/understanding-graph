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
const projectDirectory = path.join(temporaryDirectory, 'projects');
const port = await reservePort();
const child = spawn(process.execPath, [webEntry], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    PROJECT_DIR: projectDirectory,
    ALLOW_REST_MUTATIONS: 'true',
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
    throw new Error(
      'Discovery response differs from the canonical server.json.',
    );
  }
  if (
    actual.name !== 'io.github.emergent-wisdom/understanding-graph' ||
    actual.version !== expected.version
  ) {
    throw new Error(`Unexpected discovery identity: ${JSON.stringify(actual)}`);
  }

  const projectsResponse = await fetch(`http://127.0.0.1:${port}/api/projects`);
  if (
    !projectsResponse.ok ||
    JSON.stringify(await projectsResponse.json()) !== '[]'
  ) {
    throw new Error('Fresh web startup did not expose an empty project list.');
  }
  const currentResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects/current`,
  );
  if (currentResponse.status !== 404) {
    throw new Error(
      `Fresh web startup reported a current project (HTTP ${currentResponse.status}).`,
    );
  }
  const projectEntries = fs.readdirSync(projectDirectory);
  if (projectEntries.length !== 0) {
    throw new Error(
      `Fresh web startup created project data: ${JSON.stringify(projectEntries)}`,
    );
  }

  const graphWithoutProject = await fetch(
    `http://127.0.0.1:${port}/api/graph`,
  );
  if (graphWithoutProject.status !== 409) {
    throw new Error(
      `Empty graph endpoint did not require a project (HTTP ${graphWithoutProject.status}).`,
    );
  }

  const createResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Isolation Check' }),
    },
  );
  if (createResponse.status !== 201) {
    throw new Error(`Could not create smoke project (${createResponse.status}).`);
  }
  const loadResponse = await fetch(
    `http://127.0.0.1:${port}/api/projects/isolation-check/load`,
    { method: 'POST' },
  );
  if (!loadResponse.ok) {
    throw new Error(`Could not load smoke project (${loadResponse.status}).`);
  }
  const unknownProjectResponse = await fetch(
    `http://127.0.0.1:${port}/api/graph`,
    { headers: { 'x-project-id': 'does-not-exist' } },
  );
  if (unknownProjectResponse.status !== 404) {
    throw new Error(
      `Unknown project did not fail closed (HTTP ${unknownProjectResponse.status}).`,
    );
  }

  console.log(
    `Web discovery and empty-store smoke passed (${actual.name} ${actual.version}).`,
  );
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
