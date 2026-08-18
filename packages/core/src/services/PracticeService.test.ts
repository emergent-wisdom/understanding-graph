import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';
import { assessPractice } from './PracticeService.js';

/**
 * The diagnostics have to survive the failure they were built to detect.
 *
 * A statistic that is not computed does not merely go unreported — it makes
 * the thing read as healthy, which is how a graph with five of six passages
 * connected to no thinking reported 0.0% fragmentation and 75/100. So the
 * property under test here is not "the numbers are right" but "an absence
 * says absent". Every diagnostic with no data must say so rather than report
 * a zero, because zero is a measurement and silence is not.
 *
 * The re-entry case is the sharp one and it has already failed once for real:
 * getRecentToolCalls is gated behind reserved-thinking visibility, so the
 * diagnostic answered "not recorded" while twenty-eight rows sat in the table.
 * The read/write ratio was invisible in exactly the mode where it matters.
 */
const PROJECT_ID = 'practice-diagnostics';

function initializeGraph() {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-practice-'),
  );
  const projectsDirectory = path.join(tempDirectory, 'projects');
  fs.mkdirSync(projectsDirectory, { recursive: true });
  sqlite.initAllDatabases(projectsDirectory);
  sqlite.initDatabase(path.join(projectsDirectory, PROJECT_ID));
  sqlite.setCurrentProject(PROJECT_ID);
  resetGraphStore();
  return getGraphStore();
}

afterEach(() => {
  sqlite.closeAllDatabases();
  resetGraphStore();
});

function diagnostic(key: string) {
  return assessPractice().worked.find((d) => d.key === key);
}

describe('an absence reports absent, never zero', () => {
  it('says the re-entry ratio is unrecorded rather than reporting no re-entry', () => {
    initializeGraph();

    const reEntry = diagnostic('re_entry');
    expect(reEntry?.value).toBe('not recorded');
    expect(
      reEntry?.reading,
      'An unrecorded ratio must not read as a measured zero. Silence and ' +
        'absence are identical in a number, and reporting zero re-entries on ' +
        'a project that never recorded any is the failure this exists to find.',
    ).toContain('not zero');
  });

  it('reports the ratio once calls exist, in ordinary visibility', () => {
    initializeGraph();
    // The counts must be readable WITHOUT reserved-thinking visibility. The
    // full row accessor is gated, correctly — a row can carry arguments and
    // results — but a tool name and a count leak nothing, and gating them made
    // the read/write ratio unreportable in the only mode agents run in.
    sqlite.saveConversation('c_practice', 'session');
    for (let i = 0; i < 6; i++) {
      sqlite.logToolCall({
        sessionId: 'c_practice',
        toolName: 'graph_batch',
        arguments: {},
      });
    }
    sqlite.logToolCall({
      sessionId: 'c_practice',
      toolName: 'graph_understand',
      arguments: {},
    });

    expect(diagnostic('re_entry')?.value).toBe('6.0 writes per re-entry');
  });

  it('distinguishes writes with no re-entry from nothing recorded at all', () => {
    initializeGraph();
    sqlite.saveConversation('c_practice', 'session');
    sqlite.logToolCall({
      sessionId: 'c_practice',
      toolName: 'graph_batch',
      arguments: {},
    });

    // Both states are bad, and they call for different responses: one says
    // go and re-enter, the other says the instrument is not plugged in.
    expect(diagnostic('re_entry')?.value).toBe('1 writes, no re-entry');
  });
});

describe('the agent is told where its graph lives', () => {
  it('reports the store as durable when it is outside the temp directories', () => {
    initializeGraph();
    const store = diagnostic('store_durability');
    // initializeGraph builds under os.tmpdir(), which on macOS is
    // /var/folders/... — an ephemeral path. That is the point: the fixture
    // itself sits somewhere the OS clears, so the flag has something real to
    // catch rather than a string invented for the test.
    expect(store?.value).toMatch(/^(EPHEMERAL|durable): \//);
  });

  it('names the hazard rather than only labelling it', () => {
    initializeGraph();
    const store = diagnostic('store_durability');
    if (store?.value.startsWith('EPHEMERAL')) {
      // The startup warning for this goes to stderr, which an MCP client does
      // not surface to the model — it protects a human reading logs, not the
      // agent whose work is at risk. So the reading has to say what happens,
      // not just that something is wrong.
      expect(store.reading).toContain('silently recreate an empty database');
    } else {
      expect(store?.reading).toContain('not a backup');
    }
  });
});

describe('a guarantee that is not running says so', () => {
  it('reports whether duplicate detection is actually active', () => {
    initializeGraph();
    const dup = diagnostic('duplicate_detection');

    // graph_batch is described as enforcing orphan prevention, duplicate
    // detection, atomic rollback and commit provenance. Three always run. The
    // fourth is guarded by EmbeddingService.isModelLoaded(), so it runs only
    // when the embedding model happens to be loaded in-process and is skipped
    // silently otherwise — a near-duplicate concept was written to a real
    // project without a murmur while that guarantee was being asserted in
    // writing. The condition is reasonable; the silence is not.
    expect(['active', 'NOT RUNNING']).toContain(dup?.value);
    if (dup?.value === 'NOT RUNNING') {
      expect(
        dup.reading,
        'An inactive guard must say what it is failing to stop, not merely ' +
          'that it is off.',
      ).toContain('recorded twice');
    } else {
      expect(dup?.reading).toContain('refused before they are written');
    }
  });
});

describe('a refused write is not a write', () => {
  it('excludes refused batches from the write count and reports them', () => {
    initializeGraph();
    sqlite.saveConversation('c_practice', 'session');

    // graph_batch reports a rejected write by RETURNING success:false and
    // rolling back, so it never throws. The recorder logged those as completed
    // calls, which both inflated the write count and hid the single most
    // informative thing an agent does — the tool saying no.
    for (let i = 0; i < 4; i++) {
      sqlite.logToolCall({
        sessionId: 'c_practice',
        toolName: 'graph_batch',
        arguments: {},
      });
    }
    for (let i = 0; i < 2; i++) {
      sqlite.logToolCall({
        sessionId: 'c_practice',
        toolName: 'graph_batch',
        arguments: {},
        error: 'Concept would be unreachable. Entire batch rolled back.',
      });
    }
    sqlite.logToolCall({
      sessionId: 'c_practice',
      toolName: 'graph_understand',
      arguments: {},
    });

    expect(
      diagnostic('re_entry')?.value,
      'Four writes landed and two were rolled back, so the ratio is 4 to 1. ' +
        'Counting the refused pair credits work the tool undid.',
    ).toBe('4.0 writes per re-entry');
    expect(diagnostic('refusals')?.value).toBe(
      '2 of 7 calls were refused (29%)',
    );
  });

  it('reports refusals as unrecorded rather than none when nothing is logged', () => {
    initializeGraph();
    expect(diagnostic('refusals')?.value).toBe('not recorded');
    expect(diagnostic('refusals')?.reading).toContain('not zero');
  });
});

describe('what the diagnostics see in a graph that was worked', () => {
  it('counts a prediction as scored only when a verdict lands on it', () => {
    const store = initializeGraph();

    const staked = store.createNode({
      title: 'The essay measures the store, not the medium',
      trigger: 'prediction',
      why: 'Stakes a falsifiable claim before the evidence is read',
      understanding: 'Predicting the passage judges composition, not change.',
    });
    const abandoned = store.createNode({
      title: 'A claim nobody ever came back to',
      trigger: 'prediction',
      why: 'Stakes a claim whose verdict is never recorded',
      understanding: 'Made, and then quietly left alone.',
    });
    const verdict = store.createNode({
      title: 'The prediction was refuted by the closest material there is',
      trigger: 'surprise',
      why: 'Records the verdict on the prediction as stated',
      understanding: 'The passage says the opposite in its first sentence.',
    });
    store.createEdge({
      fromId: verdict.id,
      toId: staked.id,
      type: 'invalidates',
      why: 'Following this reaches the claim overturned and what overturned it.',
    });

    expect(diagnostic('scored_predictions')?.value).toBe(
      '1 of 2 predictions carry a verdict',
    );
    expect(abandoned.id).toBeTruthy();
  });

  it('reports prose with no thinking attached, which orphan checks cannot see', () => {
    const store = initializeGraph();

    const concept = store.createNode({
      title: 'Wrapping is a refusal to terraform the planet',
      trigger: 'foundation',
      why: 'Anchors the premise a passage renders',
      understanding: 'The smaller boundary is the whole design.',
    });
    const root = store.createDocumentNode({
      title: 'story.md',
      content: '# The Opening Cost',
      level: 'document',
      isDocRoot: true,
    });
    const grounded = store.createDocumentNode({
      title: 'The reframe',
      content: 'Vesna had been asked to terraform a planet.',
      level: 'paragraph',
      parentId: root.id,
    });
    store.createDocumentNode({
      title: 'First planting',
      content: 'The first field went in at Utopia.',
      level: 'paragraph',
      parentId: root.id,
      afterId: grounded.id,
    });
    store.createEdge({
      fromId: grounded.id,
      toId: concept.id,
      type: 'expresses',
      why: 'Following this reaches the premise the passage renders.',
    });

    // Passages are born holding `contains` and `next`, so the ungrounded ones
    // are connected by every structural measure and still carry no thought.
    const grounding = diagnostic('prose_grounding');
    expect(grounding?.value).toContain('of 3 passages carry thinking');
    expect(grounding?.value).not.toContain('3 of 3');
  });

  it('offers no total, because a single score becomes a target', () => {
    initializeGraph();
    const report = assessPractice();

    expect(report).not.toHaveProperty('score');
    expect(report.note).toContain('proxy');
    // Each figure must carry what it is computed from, so the proxy can be
    // judged rather than trusted.
    for (const d of report.worked) {
      expect(d.basis, `${d.key} has no stated basis`).toBeTruthy();
      expect(d.reading, `${d.key} has no reading`).toBeTruthy();
    }
  });
});
