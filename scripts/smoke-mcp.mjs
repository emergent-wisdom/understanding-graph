import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cliPath = path.resolve(process.env.UG_CLI_PATH || 'bin/cli.js');
const packageRoot = path.resolve(process.env.UG_PACKAGE_ROOT || process.cwd());
const requireFromPackage = createRequire(path.join(packageRoot, 'package.json'));
const libraryPath = requireFromPackage.resolve(
  '@emergent-wisdom/understanding-graph-mcp-server',
);
const { getToolDefinitions } = await import(pathToFileURL(libraryPath).href);
const expectedToolNames = getToolDefinitions('general')
  .map((tool) => tool.name)
  .sort();
const { TOOL_MODE: _discardedToolMode, ...cleanEnvironment } = process.env;

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'understanding-graph-mcp-smoke-'),
);
const child = spawn(process.execPath, [cliPath, 'mcp'], {
  cwd: process.cwd(),
  env: {
    ...cleanEnvironment,
    PROJECT_DIR: path.join(temporaryDirectory, 'projects'),
  },
  stdio: ['pipe', 'pipe', 'pipe'],
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

const timeout = setTimeout(() => {
  child.kill('SIGKILL');
}, 10_000);

try {
  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'release-smoke', version: '1.0.0' },
      },
    })}\n`,
  );

  const response = await waitForResponse(1);
  if (response.result?.serverInfo?.name !== 'understanding-graph') {
    throw new Error(`Unexpected MCP initialize response: ${JSON.stringify(response)}`);
  }

  child.stdin.write(
    `${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`,
  );
  const toolsResponse = await waitForResponse(2);
  const actualToolNames = toolsResponse.result?.tools
    ?.map((tool) => tool.name)
    .sort();
  if (JSON.stringify(actualToolNames) !== JSON.stringify(expectedToolNames)) {
    throw new Error(
      `Default MCP catalog differs from general mode.\nExpected: ${JSON.stringify(expectedToolNames)}\nActual: ${JSON.stringify(actualToolNames)}`,
    );
  }
  console.log(
    `MCP initialize and general catalog smoke passed (${response.result.serverInfo.name} ${response.result.serverInfo.version}, ${actualToolNames.length} tools).`,
  );
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function waitForResponse(id) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let responseTimeout;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(responseTimeout);
      callback(value);
    };
    const inspect = () => {
      for (const line of stdout.split('\n')) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id === id) {
            finish(resolve, message);
            return true;
          }
        } catch {
          // Wait for a complete line.
        }
      }
      return false;
    };

    child.stdout.on('data', () => inspect());
    child.once('error', (error) => finish(reject, error));
    child.once('exit', (code, signal) => {
      if (!inspect()) {
        finish(
          reject,
          new Error(
            `MCP process exited before response ${id} (code=${code}, signal=${signal}).\n${stderr}`,
          ),
        );
      }
    });
    responseTimeout = setTimeout(() => {
      if (!inspect()) {
        finish(
          reject,
          new Error(`Timed out waiting for MCP response ${id}.\n${stderr}`),
        );
      }
    }, 9_000);
  });
}
