import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guidanceModeFromEnv } from '@emergent-wisdom/understanding-graph-mcp-server';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (3 levels up from dist/index.js)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import {
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import express from 'express';
import { createApiSerializationMiddleware } from './api-serialization.js';
import { createBrowserOriginGuard } from './browser-origin.js';
import { resolveServerJsonPath } from './mcp-discovery.js';
import { createMcpGatewayRouter, MCP_JSON_BODY_LIMIT } from './mcp-gateway.js';
import { createRestMutationFirewall } from './mutation-firewall.js';
import { conversationRouter } from './routes/conversations.js';
import { databaseRouter } from './routes/database.js';
import { graphRouter } from './routes/graph.js';
import { createMessagesRouter, MESSAGES_WIDGET } from './routes/messages.js';
import { projectRouter, resolveProjectPath } from './routes/projects.js';
import { createWorkerAuthMiddleware } from './worker-auth.js';

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '127.0.0.1';
// Match the CLI contract: a relative PROJECT_DIR (including the default) is
// resolved from the directory where the process was launched. Never derive
// writable graph storage from __dirname: in an npm install that points inside
// node_modules and can make otherwise independent installs share package data.
const PROJECT_DIR = path.resolve(
  process.cwd(),
  process.env.PROJECT_DIR || 'projects',
);
const workerAuth = createWorkerAuthMiddleware({
  host: HOST,
  token: process.env.UG_WORKER_TOKEN,
});

// Middleware
// A non-loopback worker endpoint is an explicit, authenticated deployment
// mode. Authenticate before parsing potentially large API request bodies.
app.use(['/api', '/admin'], workerAuth);
app.use(createBrowserOriginGuard(HOST));
app.use('/api/mcp', express.json({ limit: MCP_JSON_BODY_LIMIT }));
app.use(express.json());

// Static files never touch process-global graph state and stay outside the API
// queue. Every /api request enters the queue before project selection below
// and keeps its lease until the response finishes or the client disconnects.
app.use('/api', createApiSerializationMiddleware());

// Serve static files from client directory. By default, look in the
// sibling packages/frontend/dist directory (works for local dev and
// workspace installs). When this package is installed standalone from
// npm, the root `understanding-graph` CLI passes UG_FRONTEND_DIR so
// the web server can find the frontend bundle shipped in the root
// package.
const FRONTEND_DIR =
  process.env.UG_FRONTEND_DIR || path.join(__dirname, '../../frontend/dist');
// index:false so directory requests fall through to the SPA catch-all below,
// which injects the message panel. Without this, express.static answers "/"
// directly and the panel never reaches the page.
app.use(express.static(FRONTEND_DIR, { index: false }));

// A fresh data directory has no privileged starter project.
app.locals.projectId = null;
app.locals.projectDir = PROJECT_DIR;

// Project middleware - extract project from an API request and switch database.
// Keeping this under /api ensures SPA and discovery requests cannot mutate the
// process-global active project outside the serialization lease above.
app.use('/api', (req, res, next) => {
  const headerProject = req.headers['x-project-id'];
  const queryProject = req.query.project;
  const requestedProject =
    typeof headerProject === 'string' && headerProject
      ? headerProject
      : typeof queryProject === 'string' && queryProject
        ? queryProject
        : '';
  const projectId = requestedProject || app.locals.projectId || '';

  // Validate projectId to prevent path traversal
  if (projectId && !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  if (projectId) {
    const projectPath = resolveProjectPath(PROJECT_DIR, projectId);
    const projectExists =
      projectPath !== null &&
      fs.existsSync(projectPath) &&
      fs.existsSync(path.join(projectPath, 'store.db'));

    // Never fall through to the process-global current database when a caller
    // explicitly asks for an unknown project. Doing so exposes the previous
    // project's data under the requested project's label.
    if (requestedProject && !projectExists) {
      return res.status(404).json({
        error: 'Project not found',
        project: requestedProject,
      });
    }

    if (!projectExists || !projectPath) {
      app.locals.projectId = null;
      sqlite.clearCurrentProject();
      resetGraphStore();
      req.projectId = '';
      return next();
    }

    if (sqlite.getCurrentProjectId() !== projectId) {
      sqlite.initDatabase(projectPath);
      sqlite.setCurrentProject(projectId);
      resetGraphStore();
    }
    if (requestedProject) {
      app.locals.projectId = projectId;
    }
  }

  req.projectId = projectId;
  next();
});

// The human write path, mounted BEFORE the firewall. It is the one
// deliberate exception: narrow by construction (it can only create a
// message), so a person can speak to an agent working asynchronously
// without reopening arbitrary REST mutation.
app.use('/api', createMessagesRouter(PROJECT_DIR));
app.get('/messages', (_req, res) => res.redirect('/api/messages-ui'));

// Block REST mutations - all writes should go through MCP. Set
// ALLOW_REST_MUTATIONS=true only for deliberate local testing without MCP.
app.use(createRestMutationFirewall());

// Routes
app.use(
  '/api/mcp',
  createMcpGatewayRouter({
    projectDir: PROJECT_DIR,
    guidanceMode: guidanceModeFromEnv(process.env),
  }),
);
app.use('/api/projects', projectRouter);
app.use('/api', (req, res, next) => {
  if (!req.projectId) {
    return res.status(409).json({
      error: 'No active project',
      code: 'PROJECT_REQUIRED',
      hint: 'Create or load a project before using graph endpoints.',
    });
  }
  next();
});
app.use('/api', graphRouter);
app.use('/api', databaseRouter);
app.use('/api', conversationRouter);

// MCP Registry discovery: production builds copy server.json beside this
// entry point. Source development falls back to the repository root, and
// deployments may explicitly provide a record path.
const serverJsonPath = resolveServerJsonPath(
  __dirname,
  process.env.UG_SERVER_JSON,
);
app.get('/.well-known/mcp/server.json', (_req, res) => {
  if (serverJsonPath) {
    res.setHeader('Content-Type', 'application/json');
    return res.sendFile(serverJsonPath);
  }
  res.status(404).json({ error: 'server.json not found' });
});

// Catch-all for SPA. The message panel is injected here rather than built
// into the React app so the frontend bundle needs no rebuild to gain it, and
// so it stays available even when serving a prebuilt frontend from npm.
app.get('*', (_req, res) => {
  const indexPath = path.join(FRONTEND_DIR, 'index.html');
  try {
    const html = fs.readFileSync(indexPath, 'utf8');
    return res
      .type('html')
      .send(
        html.includes('</body>')
          ? html.replace('</body>', `${MESSAGES_WIDGET}</body>`)
          : html + MESSAGES_WIDGET,
      );
  } catch {
    return res.sendFile(indexPath);
  }
});

// Error handler
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  },
);

// Start server
function start() {
  try {
    fs.mkdirSync(PROJECT_DIR, { recursive: true });
    const populated = fs
      .readdirSync(PROJECT_DIR, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          fs.existsSync(path.join(PROJECT_DIR, entry.name, 'store.db')),
      )
      .map((entry) => entry.name)
      .sort();
    const requestedProject = process.env.DEFAULT_PROJECT;
    const activeProject = requestedProject || populated[0];

    if (activeProject) {
      if (!/^[a-zA-Z0-9_-]+$/.test(activeProject)) {
        throw new Error(
          `Invalid DEFAULT_PROJECT: "${activeProject}". Use only letters, numbers, underscores, and hyphens.`,
        );
      }
      const activePath = path.join(PROJECT_DIR, activeProject);
      if (requestedProject && !fs.existsSync(activePath)) {
        fs.mkdirSync(activePath, { recursive: true });
      }
      sqlite.initDatabase(activePath);
      sqlite.setCurrentProject(activeProject);
      app.locals.projectId = activeProject;
      console.log(`Loaded project: ${activeProject}`);
    } else {
      app.locals.projectId = null;
      console.log(
        'No projects found. The UI will remain empty until an MCP client creates one.',
      );
    }
  } catch (e) {
    console.log('Failed to load project:', e);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Understanding Graph running on http://${HOST}:${PORT}`);
    console.log(`Project directory: ${PROJECT_DIR}`);
    console.log(`Frontend directory: ${FRONTEND_DIR}`);
    console.log(`Frontend exists: ${fs.existsSync(FRONTEND_DIR)}`);
  });
}

start();

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  sqlite.closeDatabase();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Extend Express types
declare global {
  namespace Express {
    interface Request {
      projectId: string;
    }
  }
}
