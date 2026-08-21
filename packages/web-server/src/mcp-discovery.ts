import fs from 'node:fs';
import path from 'node:path';

export function resolveServerJsonPath(
  moduleDir: string,
  configuredPath?: string,
): string | null {
  const candidates = [
    configuredPath,
    path.join(moduleDir, 'server.json'),
    path.resolve(moduleDir, '../../../server.json'),
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return null;
}
