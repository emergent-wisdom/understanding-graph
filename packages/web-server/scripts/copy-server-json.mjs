import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(scriptDir, '../../../server.json');
const destination = path.resolve(scriptDir, '../dist/server.json');

fs.copyFileSync(source, destination);
