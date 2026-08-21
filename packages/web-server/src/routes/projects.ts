import fs from 'node:fs';
import path from 'node:path';
import {
  resetGraphStore,
  sqlite,
} from '@emergent-wisdom/understanding-graph-core';
import { Router } from 'express';

export const projectRouter = Router();

const PROJECT_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function resolveProjectPath(
  projectDirectory: string,
  projectId: string,
): string | null {
  if (!PROJECT_ID_RE.test(projectId)) return null;
  const projectRoot = path.resolve(projectDirectory);
  const projectPath = path.resolve(projectRoot, projectId);
  const relativePath = path.relative(projectRoot, projectPath);
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    return null;
  }

  if (fs.existsSync(projectPath)) {
    const realRoot = fs.realpathSync(projectRoot);
    const realProject = fs.realpathSync(projectPath);
    const realRelative = path.relative(realRoot, realProject);
    if (
      !realRelative ||
      realRelative === '..' ||
      realRelative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelative)
    ) {
      return null;
    }
  }

  return projectPath;
}

// List all projects
projectRouter.get('/', (req, res, next) => {
  try {
    const projectDir = req.app.locals.projectDir;

    if (!fs.existsSync(projectDir)) {
      return res.json([]);
    }

    const projects = fs
      .readdirSync(projectDir)
      .filter((name) => {
        const projectPath = resolveProjectPath(projectDir, name);
        return projectPath !== null && fs.statSync(projectPath).isDirectory();
      })
      .map((name) => {
        const metaPath = path.join(projectDir, name, 'meta.json');
        let meta = { name, goal: '' };
        if (fs.existsSync(metaPath)) {
          try {
            meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
          } catch {}
        }
        return {
          id: name,
          name: meta.name || name,
          goal: meta.goal || '',
        };
      });

    res.json(projects);
  } catch (error) {
    next(error);
  }
});

// Create new project
projectRouter.post('/', (req, res, next) => {
  try {
    const { name, goal } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    // Generate ID from name
    const id = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const projectDir = req.app.locals.projectDir;
    const projectPath = resolveProjectPath(projectDir, id);
    if (!projectPath) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    if (fs.existsSync(projectPath)) {
      return res.status(400).json({ error: 'Project already exists' });
    }

    // Create project directory
    fs.mkdirSync(projectPath, { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'documents'), { recursive: true });
    fs.mkdirSync(path.join(projectPath, 'generated'), { recursive: true });

    // Write meta.json
    const meta = { name, goal: goal || '' };
    fs.writeFileSync(
      path.join(projectPath, 'meta.json'),
      JSON.stringify(meta, null, 2),
    );

    // Initialize SQLite database (includes nodes/edges tables)
    sqlite.initDatabase(projectPath);

    res.status(201).json({ id, name, goal: goal || '' });
  } catch (error) {
    next(error);
  }
});

// Load/switch to a project
projectRouter.post('/:id/load', (req, res, next) => {
  try {
    const { id } = req.params;
    const projectDir = req.app.locals.projectDir;
    const projectPath = resolveProjectPath(projectDir, id);
    if (!projectPath) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Initialize SQLite for this project and set it as current
    sqlite.initDatabase(projectPath);
    sqlite.setCurrentProject(id);

    // Reset GraphStore to reload from new project
    resetGraphStore();

    // Update current project
    req.app.locals.projectId = id;

    // Read meta
    const metaPath = path.join(projectPath, 'meta.json');
    let meta = { name: id, goal: '' };
    if (fs.existsSync(metaPath)) {
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
    }

    res.json({ id, name: meta.name, goal: meta.goal, loaded: true });
  } catch (error) {
    next(error);
  }
});

// Flush any WAL pages before a trusted host snapshots the project directory.
// The host must keep its cross-project request lock for the checkpoint and the
// entire archive creation; this endpoint alone is not a backup boundary.
projectRouter.post('/:id/checkpoint', (req, res, next) => {
  try {
    const { id } = req.params;
    if (!resolveProjectPath(req.app.locals.projectDir, id)) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }
    if (!sqlite.isProjectLoaded(id)) {
      return res.status(404).json({ error: 'Project not loaded' });
    }

    sqlite.setCurrentProject(id);
    sqlite.getDb(id).pragma('wal_checkpoint(TRUNCATE)');
    res.json({ id, checkpointed: true });
  } catch (error) {
    next(error);
  }
});

// Delete one project store. The web server is bound to loopback in hosted
// deployments; authorization for this internal operation belongs to the
// calling application. Closing SQLite before removing the directory avoids
// deleting files underneath a live database connection.
projectRouter.delete('/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const projectPath = resolveProjectPath(req.app.locals.projectDir, id);
    if (!projectPath) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    const coreWasCurrent = sqlite.getCurrentProjectId() === id;
    const appWasCurrent = req.app.locals.projectId === id;
    sqlite.closeProjectDatabase(id);

    if (coreWasCurrent || appWasCurrent) {
      resetGraphStore();

      const remainingIds = sqlite.getLoadedProjectIds();
      const existingCurrent = sqlite.getCurrentProjectId();
      const appCurrent = req.app.locals.projectId;
      const fallbackId =
        existingCurrent ||
        (typeof appCurrent === 'string' &&
        appCurrent !== id &&
        remainingIds.includes(appCurrent)
          ? appCurrent
          : [...remainingIds].sort()[0]);

      if (fallbackId) {
        sqlite.setCurrentProject(fallbackId);
        req.app.locals.projectId = fallbackId;
      } else {
        req.app.locals.projectId = null;
      }
    }

    fs.rmSync(projectPath, { recursive: true, force: true });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

// Get current project
projectRouter.get('/current', (req, res) => {
  const id = req.app.locals.projectId;
  if (typeof id !== 'string' || !id) {
    return res.status(404).json({ error: 'No project loaded' });
  }
  const projectDir = req.app.locals.projectDir;
  const projectPath = resolveProjectPath(projectDir, id);
  if (!projectPath) {
    return res.status(400).json({ error: 'Invalid project ID' });
  }

  let meta = { name: id, goal: '' };
  const metaPath = path.join(projectPath, 'meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    } catch {}
  }

  res.json({ id, name: meta.name, goal: meta.goal });
});

// Get project export files list
projectRouter.get('/:id/export', (req, res, next) => {
  try {
    const { id } = req.params;
    const projectDir = req.app.locals.projectDir;
    const projectPath = resolveProjectPath(projectDir, id);
    if (!projectPath) {
      return res.status(400).json({ error: 'Invalid project ID' });
    }

    if (!fs.existsSync(projectPath)) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const files: string[] = [];

    // List generated files
    const generatedPath = path.join(projectPath, 'generated');
    if (fs.existsSync(generatedPath)) {
      const generatedFiles = fs
        .readdirSync(generatedPath)
        .map((f) => `generated/${f}`);
      files.push(...generatedFiles);
    }

    // Include graph.json if exists
    const graphPath = path.join(projectPath, 'graph.json');
    if (fs.existsSync(graphPath)) {
      files.push('graph.json');
    }

    res.json({ projectId: id, files });
  } catch (error) {
    next(error);
  }
});
