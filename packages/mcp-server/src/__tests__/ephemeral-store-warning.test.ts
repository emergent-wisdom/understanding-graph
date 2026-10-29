import { describe, expect, it } from 'vitest';
import { isEphemeralPath } from '../index.js';

/**
 * Explicit project roots in operating-system temporary directories must be
 * announced as ephemeral. Durable roots and paths merely containing a similar
 * substring must not trigger the warning. Bare roots without a trailing slash
 * need the same classification as their descendants.
 */
describe('an ephemeral store is announced as one', () => {
  it.each([
    ['/tmp/ug-run/projects'],
    ['/private/tmp/ug-run-2.ABC123/projects'],
    ['/var/folders/xx/T/ug/projects'],
    ['/private/tmp/projects'],
  ])('treats %s as ephemeral', (dir) => {
    expect(
      isEphemeralPath(dir),
      `${dir} is deleted by the OS without notice and must be flagged.`,
    ).toBe(true);
  });

  it.each([
    ['/Users/someone/.understanding-graph/projects'],
    ['/Users/someone/work/repo/projects'],
    ['/opt/graphs/projects'],
    // The guard must not fire on a durable path that merely contains the
    // substring: matching anywhere rather than at the root would warn on
    // ordinary directories and train the reader to ignore the warning.
    ['/Users/someone/tmp-notes/projects'],
    ['/Users/someone/var/folders/projects'],
  ])('leaves %s alone', (dir) => {
    expect(isEphemeralPath(dir)).toBe(false);
  });

  it('matches a directory given without its trailing slash', () => {
    // Classify the root itself as well as paths beneath it.
    expect(isEphemeralPath('/private/tmp')).toBe(true);
    expect(isEphemeralPath('/tmp')).toBe(true);
  });
});
