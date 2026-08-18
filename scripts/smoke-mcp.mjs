import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'understanding-graph-mcp-smoke-'),
);
const child = spawn(process.execPath, ['bin/cli.js', 'mcp'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
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

  const response = await waitForInitialize();
  if (response.result?.serverInfo?.name !== 'understanding-graph') {
    throw new Error(`Unexpected MCP initialize response: ${JSON.stringify(response)}`);
  }
  console.log(
    `MCP initialize smoke passed (${response.result.serverInfo.name} ${response.result.serverInfo.version}).`,
  );
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

function waitForInitialize() {
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
          if (message.id === 1) {
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
            `MCP process exited before initialize (code=${code}, signal=${signal}).\n${stderr}`,
          ),
        );
      }
    });
    responseTimeout = setTimeout(() => {
      if (!inspect()) {
        finish(
          reject,
          new Error(`Timed out waiting for MCP initialize.\n${stderr}`),
        );
      }
    }, 9_000);
  });
}
