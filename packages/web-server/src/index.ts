import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (3 levels up from dist/index.js)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { sqlite } from '@emergent-wisdom/understanding-graph-core';
import cors from 'cors';
import express from 'express';
import { createApiSerializationMiddleware } from './api-serialization.js';
import { createMcpGatewayRouter, MCP_JSON_BODY_LIMIT } from './mcp-gateway.js';
import { createRestMutationFirewall } from './mutation-firewall.js';
import { conversationRouter } from './routes/conversations.js';
import { databaseRouter } from './routes/database.js';
import { graphRouter } from './routes/graph.js';
import { createMessagesRouter, MESSAGES_WIDGET } from './routes/messages.js';
import { projectRouter } from './routes/projects.js';
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
app.use(cors());
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

// Store current project in app.locals
app.locals.projectId = 'default';
app.locals.projectDir = PROJECT_DIR;

// Project middleware - extract project from an API request and switch database.
// Keeping this under /api ensures SPA and discovery requests cannot mutate the
// process-global active project outside the serialization lease above.
app.use('/api', (req, res, next) => {
  // Allow project override via header or query param
  const projectId =
    (req.headers['x-project-id'] as string) ||
    (req.query.project as string) ||
    app.locals.projectId;
  req.projectId = projectId;

  // Validate projectId to prevent path traversal
  if (projectId && !/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  // Switch database to the requested project (skip if already active)
  if (projectId !== app.locals.projectId) {
    const projectPath = path.join(PROJECT_DIR, projectId);
    if (
      fs.existsSync(projectPath) &&
      fs.existsSync(path.join(projectPath, 'store.db'))
    ) {
      sqlite.initDatabase(projectPath);
      sqlite.setCurrentProject(projectId);
      app.locals.projectId = projectId;
    }
  }

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
app.use('/api/mcp', createMcpGatewayRouter({ projectDir: PROJECT_DIR }));
app.use('/api/projects', projectRouter);
app.use('/api', graphRouter);
app.use('/api', databaseRouter);
app.use('/api', conversationRouter);

// MCP Registry discovery: serve the package's server.json at the 2026
// well-known path so agents can auto-discover understanding-graph.
// server.json lives at the repo root (4 levels up from dist/index.js:
// dist/index.js -> dist -> web-server -> packages -> repo root).
const packageRoot = path.resolve(__dirname, '../../..');
const serverJsonPath = path.join(packageRoot, 'server.json');
app.get('/.well-known/mcp/server.json', (_req, res) => {
  if (fs.existsSync(serverJsonPath)) {
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
  // Initialize default project on startup
  const defaultProject = process.env.DEFAULT_PROJECT || 'default';
  const projectPath = path.join(PROJECT_DIR, defaultProject);

  try {
    // The viewer always opens on something. Unlike the MCP server — which
    // deliberately declines to pick when an agent must choose where its work
    // belongs — a human here is reading, not writing (REST mutations are
    // firewalled), so an empty screen is only ever a failure.
    //
    // The trap is bootstrapping an empty `default` while real projects sit
    // next to it: the UI then shows a blank canvas over a populated store,
    // which reads as "the tool is broken". Prefer a project with data.
    let activeProject = defaultProject;
    let activePath = projectPath;

    if (!fs.existsSync(path.join(projectPath, 'store.db'))) {
      const populated = fs
        .readdirSync(PROJECT_DIR, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            fs.existsSync(path.join(PROJECT_DIR, d.name, 'store.db')),
        )
        .map((d) => d.name)
        .sort();

      if (populated.length > 0) {
        activeProject = populated[0];
        activePath = path.join(PROJECT_DIR, activeProject);
        console.log(
          `No "${defaultProject}" store found; opening "${activeProject}" ` +
            `(${populated.length} project(s) with data).`,
        );
      } else if (!fs.existsSync(projectPath)) {
        console.log(
          `Default project not found. Bootstrapping at: ${projectPath}`,
        );
        fs.mkdirSync(projectPath, { recursive: true });
      }
    }

    sqlite.initDatabase(activePath);
    sqlite.setCurrentProject(activeProject);
    app.locals.projectId = activeProject;
    console.log(`Loaded project: ${activeProject}`);
  } catch (e) {
    console.log('Failed to load/bootstrap project:', e);
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
