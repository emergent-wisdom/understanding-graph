import { sqlite } from '@emergent-wisdom/understanding-graph-core';
import { Router } from 'express';

export const databaseRouter = Router();

// Get database statistics (comprehensive graph analytics)
databaseRouter.get('/db/stats', (_req, res, next) => {
  try {
    const stats = sqlite.getDatabaseStats();
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get all table schemas
databaseRouter.get('/db/schema', (_req, res, next) => {
  try {
    const tables = sqlite.getAllTableSchemas();
    res.json({ tables });
  } catch (error) {
    next(error);
  }
});

// Get single table schema
databaseRouter.get('/db/tables/:tableName/schema', (req, res, next) => {
  try {
    const schema = sqlite.getTableSchema(req.params.tableName);
    if (!schema) {
      return res.status(404).json({ error: 'Table not found' });
    }
    res.json(schema);
  } catch (error) {
    next(error);
  }
});

// Get table rows with pagination
databaseRouter.get('/db/tables/:tableName/rows', (req, res, next) => {
  try {
    const { limit, offset, orderBy, orderDir, search } = req.query;

    const result = sqlite.getTableRows(req.params.tableName, {
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
      orderBy: orderBy as string | undefined,
      orderDir: (orderDir as 'asc' | 'desc') || 'desc',
      search: search as string | undefined,
    });

    if (!result) {
      return res.status(404).json({ error: 'Table not found' });
    }

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get single row by primary key
databaseRouter.get('/db/tables/:tableName/rows/:pkValue', (req, res, next) => {
  try {
    const row = sqlite.getTableRow(req.params.tableName, req.params.pkValue);
    if (!row) {
      return res.status(404).json({ error: 'Row not found' });
    }
    res.json(row);
  } catch (error) {
    next(error);
  }
});
