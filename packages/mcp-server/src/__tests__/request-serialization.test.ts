import { describe, expect, it } from 'vitest';
import { SerialTaskQueue } from '../serial-task-queue.js';

describe('MCP CallTool request serialization', () => {
  it('does not start a second request while the first request is awaiting', async () => {
    const queue = new SerialTaskQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = queue.run(async () => {
      events.push('first:start');
      markFirstStarted();
      await firstGate;
      events.push('first:end');
      return 'first';
    });

    await firstStarted;
    const second = queue.run(async () => {
      events.push('second:start');
      return 'second';
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      'first',
      'second',
    ]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('continues after a request fails', async () => {
    const queue = new SerialTaskQueue();
    const failed = queue.run(async () => {
      throw new Error('expected failure');
    });
    const recovered = queue.run(async () => 'recovered');

    await expect(failed).rejects.toThrow('expected failure');
    await expect(recovered).resolves.toBe('recovered');
  });
});
