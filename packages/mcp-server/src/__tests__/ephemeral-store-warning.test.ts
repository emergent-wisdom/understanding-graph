import { describe, expect, it } from 'vitest';
import { isEphemeralPath } from '../index.js';

/**
 * A graph written to a temp directory is a scratch buffer wearing a medium's
 * interface, and the tool said nothing about it.
 *
 * This is not hypothetical. Two projects holding roughly two hundred nodes
 * were written under /private/tmp across two days of real work. A routine OS
 * cleanup removed them between sessions, and the next call re-initialised an
 * empty database at the same path — so the directory looked intact, reported
 * itself loaded, and held nothing. Nothing in two days of startup output
 * mentioned that the store was ephemeral.
 *
 * The default, cwd/projects, is fine. The hazard is an explicit PROJECT_DIR
 * pointed somewhere convenient at the start of what was expected to be a short
 * piece of work, which is exactly when durability is not on anyone's mind.
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
    // The real failure was configured as a bare path with no trailing slash,
    // so a prefix test written against "/private/tmp/" alone would have missed
    // the exact case that lost the data.
    expect(isEphemeralPath('/private/tmp')).toBe(true);
    expect(isEphemeralPath('/tmp')).toBe(true);
  });
});
