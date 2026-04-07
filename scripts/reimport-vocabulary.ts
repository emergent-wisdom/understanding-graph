/**
 * Reimport APL vocabulary from backup JSON into SQLite
 *
 * Run with: npx tsx scripts/reimport-vocabulary.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initAplDatabase,
  savePattern,
  mintWord,
  shortHash,
} from '../packages/core/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectsDir = path.join(__dirname, '..', 'projects');
const backupPath = path.join(projectsDir, 'apl', 'vocabulary-backup.json');

async function main() {
  console.log('Initializing APL database...');
  initAplDatabase(projectsDir);

  console.log('Loading backup from:', backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf-8'));

  console.log(`Found ${backup.patterns.length} patterns to reimport\n`);

  for (const p of backup.patterns) {
    try {
      // Mint the pattern (this computes the hash)
      const card = mintWord({
        handle: p.handle,
        gloss: p.gloss,
        description: p.description,
        invariants: p.invariants,
      });

      const stub = shortHash(card.pattern.hash.canonical);

      // Save to SQLite
      savePattern({
        id: card.pattern.id,
        handle: card.pattern.handle,
        gloss: card.pattern.gloss,
        description: card.pattern.description,
        invariants: card.pattern.invariants,
        hash: card.pattern.hash.canonical,
        stub,
      });

      console.log(`✓ Imported: ${p.handle}#${stub}`);
    } catch (e) {
      // Pattern may already exist
      console.log(`- Skipped (exists): ${p.handle}#${p.stub}`);
    }
  }

  console.log('\nDone! Vocabulary reimported to SQLite.');
  console.log('Database location:', path.join(projectsDir, 'vocabulary.db'));
}

main().catch(console.error);
