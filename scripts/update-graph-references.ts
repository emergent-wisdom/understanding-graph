#!/usr/bin/env npx ts-node
/**
 * Update Graph References Script
 *
 * Updates all APL references in the graph to use new SEMA hashes.
 * Uses the hash-mapping.json created during reminting.
 */

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

// Paths
const MAPPING_PATH = path.join(__dirname, '../projects/hash-mapping.json');
const APL_DB_PATH = path.join(__dirname, '../projects/apl/store.db');

interface HashMapping {
  oldHash: string;
  newHash: string;
  oldStub: string;
  newStub: string;
  oldId: string;
  newId: string;
  handle: string | null;
}

function main() {
  console.log('=== Updating Graph References ===\n');

  // Load mapping
  if (!fs.existsSync(MAPPING_PATH)) {
    console.error(`Mapping file not found: ${MAPPING_PATH}`);
    process.exit(1);
  }

  const mappings: HashMapping[] = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf-8'));
  console.log(`Loaded ${mappings.length} hash mappings`);

  // Open database
  if (!fs.existsSync(APL_DB_PATH)) {
    console.error(`APL database not found: ${APL_DB_PATH}`);
    process.exit(1);
  }

  const db = new Database(APL_DB_PATH);

  // Build replacement map
  const replacements: Array<{ from: string; to: string }> = [];

  // Replace "apl:" with "sema:" in URI scheme
  replacements.push({ from: 'apl:', to: 'sema:' });
  replacements.push({ from: 'APL:', to: 'Sema:' });
  replacements.push({ from: 'APL ', to: 'Sema ' });
  replacements.push({ from: ' APL', to: ' Sema' });

  // Replace old hashes with new
  for (const m of mappings) {
    // Full hash replacement
    replacements.push({ from: m.oldHash, to: m.newHash });
    // Stub replacement (only if unique enough - 4 chars might collide with text)
    // Skip stub replacement as it's too aggressive
  }

  console.log(`\nPrepared ${replacements.length} replacement rules`);

  // Update nodes table
  console.log('\n--- Updating nodes.understanding ---');
  const nodeCount = updateColumn(db, 'nodes', 'understanding', replacements);

  // Update nodes.prose (if exists)
  console.log('\n--- Updating nodes.prose ---');
  const proseCount = updateColumn(db, 'nodes', 'prose', replacements);

  // Update nodes.summary
  console.log('\n--- Updating nodes.summary ---');
  const summaryCount = updateColumn(db, 'nodes', 'summary', replacements);

  // Update nodes.text (node title)
  console.log('\n--- Updating nodes.text ---');
  const textCount = updateColumn(db, 'nodes', 'text', replacements);

  // Update documents table if exists
  console.log('\n--- Updating documents ---');
  let docCount = 0;
  try {
    docCount = updateColumn(db, 'documents', 'content', replacements);
  } catch {
    console.log('  No documents table or content column');
  }

  // Update edges.why
  console.log('\n--- Updating edges.why ---');
  const edgeCount = updateColumn(db, 'edges', 'why', replacements);

  db.close();

  console.log('\n=== Summary ===');
  console.log(`Nodes updated: ${nodeCount + proseCount + summaryCount + textCount}`);
  console.log(`Documents updated: ${docCount}`);
  console.log(`Edges updated: ${edgeCount}`);
  console.log('\nDone. APL project now references SEMA hashes.');
}

function updateColumn(
  db: Database.Database,
  table: string,
  column: string,
  replacements: Array<{ from: string; to: string }>
): number {
  let totalUpdated = 0;

  // Check if column exists
  try {
    db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get();
  } catch {
    console.log(`  Column ${column} not found in ${table}`);
    return 0;
  }

  // Get all rows with content
  const rows = db.prepare(`SELECT id, ${column} FROM ${table} WHERE ${column} IS NOT NULL`).all() as Array<{
    id: string;
    [key: string]: string;
  }>;

  const updateStmt = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`);

  for (const row of rows) {
    let content = row[column];
    let changed = false;

    for (const { from, to } of replacements) {
      if (content.includes(from)) {
        content = content.split(from).join(to);
        changed = true;
      }
    }

    if (changed) {
      updateStmt.run(content, row.id);
      totalUpdated++;
    }
  }

  console.log(`  Updated ${totalUpdated} rows in ${table}.${column}`);
  return totalUpdated;
}

main();
