import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../tools/index.js';

describe('MCP server smoke tests', () => {
  it('exposes tools in full mode', () => {
    const tools = getToolDefinitions('full');
    expect(tools.length).toBeGreaterThan(50);
  });

  it('exposes a strict subset in reading mode', () => {
    const reading = getToolDefinitions('reading');
    const full = getToolDefinitions('full');
    expect(reading.length).toBeGreaterThan(0);
    expect(reading.length).toBeLessThan(full.length);
  });

  it('every tool has a name and description', () => {
    for (const tool of getToolDefinitions('full')) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
    }
  });
});
