import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (3 levels up from dist/index.js)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { sqlite } from '@understanding-graph/core';
import cors from 'cors';
import express from 'express';
import { conversationRouter } from './routes/conversations.js';
import { databaseRouter } from './routes/database.js';
import { graphRouter } from './routes/graph.js';
import { projectRouter } from './routes/projects.js';

const app = express();
const PORT = process.env.PORT || 3000;
// Default to root projects folder (3 levels up from src/index.ts -> packages/web-server/src)
const PROJECT_DIR =
  process.env.PROJECT_DIR || path.resolve(__dirname, '../../../projects');

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from client directory
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Store current project in app.locals
app.locals.projectId = 'default';
app.locals.projectDir = PROJECT_DIR;

// Project middleware - extract project from request and switch database
app.use((req, res, next) => {
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

  // Switch database to the requested project
  const projectPath = path.join(PROJECT_DIR, projectId);
  if (
    fs.existsSync(projectPath) &&
    fs.existsSync(path.join(projectPath, 'store.db'))
  ) {
    sqlite.initDatabase(projectPath);
    sqlite.setCurrentProject(projectId);
  }

  next();
});

// Block REST mutations - all writes should go through MCP
// This prevents agents from bypassing the MCP API
// Set ALLOW_REST_MUTATIONS=true for testing without MCP
const ALLOW_REST_MUTATIONS = process.env.ALLOW_REST_MUTATIONS === 'true';
const MUTATION_BLOCKED_PATHS = [
  '/api/graph/nodes',
  '/api/graph/edges',
  '/api/graph/documents',
  '/api/conversations',
  '/api/quotes',
];

app.use((req, res, next) => {
  const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method);
  const isBlockedPath = MUTATION_BLOCKED_PATHS.some(
    (p) => req.path.startsWith(p) && !req.path.includes('/archive'),
  );

  // Allow embeddings backfill, temporal access, and document generation (they're operational, not content mutations)
  const isAllowedMutation =
    req.path.includes('/embeddings/backfill') ||
    req.path.includes('/temporal/access') ||
    (req.path.includes('/documents/') &&
      (req.path.includes('/generate') || req.path.includes('/watch')));

  if (
    isMutation &&
    isBlockedPath &&
    !isAllowedMutation &&
    !ALLOW_REST_MUTATIONS
  ) {
    return res.status(405).json({
      error: 'REST mutations are disabled',
      message:
        'Use MCP tools (mcp__understanding-graph__*) to modify the graph. The REST API is read-only.',
      hint: 'See CLAUDE.md for API usage guidelines',
    });
  }

  next();
});

// Routes
app.use('/api/projects', projectRouter);
app.use('/api', graphRouter);
app.use('/api', databaseRouter);
app.use('/api', conversationRouter);

// Catch-all for SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../../frontend/dist/index.html'));
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
    // Ensure default project exists (bootstrap if wiped)
    if (!fs.existsSync(projectPath)) {
      console.log(
        `Default project not found. Bootstrapping at: ${projectPath}`,
      );
      fs.mkdirSync(projectPath, { recursive: true });
    }

    sqlite.initDatabase(projectPath);
    sqlite.setCurrentProject(defaultProject);
    app.locals.projectId = defaultProject;
    console.log(`Loaded default project: ${defaultProject}`);
  } catch (e) {
    console.log('Failed to load/bootstrap default project:', e);
  }

  app.listen(PORT, () => {
    console.log(
      `Understanding Graph v2 Web Server running on http://localhost:${PORT}`,
    );
    console.log(`Project directory: ${PROJECT_DIR}`);
  });
}

start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  sqlite.closeDatabase();
  process.exit(0);
});

// Extend Express types
declare global {
  namespace Express {
    interface Request {
      projectId: string;
    }
  }
}
