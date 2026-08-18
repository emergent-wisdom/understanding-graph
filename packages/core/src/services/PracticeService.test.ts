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

describe('the reading shows whether anything changed since last time', () => {
  it('reports no movement on a first reading', () => {
    initializeGraph();
    sqlite.saveConversation('c_practice', 'session');
    for (let i = 0; i < 4; i++) {
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

    // Nothing to compare against yet, so no movement clause is invented.
    const value = diagnostic('re_entry')?.value ?? '';
    expect(value).toContain('writes per re-entry');
    expect(value).not.toContain('since you last read this');
  });

  it('states movement once the diagnostic has been read before', () => {
    initializeGraph();
    sqlite.saveConversation('c_practice', 'session');
    const call = (toolName: string) =>
      sqlite.logToolCall({ sessionId: 'c_practice', toolName, arguments: {} });

    call('graph_batch');
    call('graph_understand');
    call('graph_practice'); // first reading
    call('graph_batch');
    call('graph_batch');
    call('graph_practice'); // second reading

    // A number that is fresh every time cannot show that nothing changed, so
    // ignoring it leaves no trace. The direction is not asserted here because
    // tool_calls timestamps have second resolution and a fast test can land
    // several rows in one second; what must hold is that the comparison is
    // made and stated at all.
    const value = diagnostic('re_entry')?.value ?? '';
    expect(
      value,
      'The reading gave a bare number with no indication of whether it had ' +
        'moved. An unchanged number then reads exactly like a fresh one, and ' +
        'ignoring the diagnostic becomes invisible.',
    ).toContain('since you last read this');
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

describe('the unexpressed list names what it is made of', () => {
  /**
   * This figure has a floor that is not zero, and the floor is legible only
   * from the composition. A verdict scoring a prediction is ABOUT the work
   * rather than in it, and no artifact can express it. Measured on a real
   * project the count fell from eight to five and all five were verdicts — the
   * point at which the right move is to stop. An agent reading only the number
   * would keep going and start forcing method-talk into the artifact.
   */
  it('groups the residue by trigger, commonest first', () => {
    const store = initializeGraph();

    // The artifact diagnostics are gated on the graph holding an artifact at
    // all, which is right: "the artifact has not caught up" means nothing
    // where there is no artifact.
    store.createDocumentNode({
      title: 'city_dwelling.py',
      content: '# a module',
      level: 'document',
      isDocRoot: true,
    });

    for (const n of [1, 2]) {
      store.createNode({
        title: `Verdict: clause ${n} held under the wider test`,
        trigger: 'evaluation',
        why: 'Scores a prediction against what the run actually showed',
        understanding:
          'The wider city reproduced the movement, so the claim survives.',
      });
    }
    store.createNode({
      title: 'City shape sets the price of integration',
      trigger: 'model',
      why: 'Records a finding about the thing being modelled',
      understanding:
        'Holding households fixed and changing only geometry moves the price.',
    });

    const value = diagnostic('understanding_ahead_of_artifact')?.value ?? '';

    // The count alone was all this ever reported, and it cannot distinguish a
    // residue that should be acted on from one that should be left alone.
    expect(value).toContain('3 decision(s)');
    expect(value).toMatch(/\(2 evaluation, 1 model\)/);
  });

  it('shows a pure-verdict residue as such, which is the signal to stop', () => {
    const store = initializeGraph();

    // The artifact diagnostics are gated on the graph holding an artifact at
    // all, which is right: "the artifact has not caught up" means nothing
    // where there is no artifact.
    store.createDocumentNode({
      title: 'city_dwelling.py',
      content: '# a module',
      level: 'document',
      isDocRoot: true,
    });

    for (const n of [1, 2, 3]) {
      store.createNode({
        title: `Verdict: prediction ${n} was refuted, which is the point of staking tight`,
        trigger: 'evaluation',
        why: 'Scores a prediction against what the run actually showed',
        understanding:
          'Refuted on the evidence, and the refutation is the useful part.',
      });
    }

    const value = diagnostic('understanding_ahead_of_artifact')?.value ?? '';
    expect(value).toMatch(/\(3 evaluation\)/);
    expect(value).not.toContain('model');
    // The reading has to tell the agent that this residue is not work.
    expect(diagnostic('understanding_ahead_of_artifact')?.reading).toContain(
      'verdicts scoring predictions',
    );
  });
});

describe('a reading that names one bad end names the other', () => {
  /**
   * A reading that names only ONE bad direction is an instruction to move the
   * other way without limit. `re_entry` warned that ten or more writes per
   * re-entry means the graph is being filled rather than used, and said
   * nothing about the floor — while the metric is writes PER re-entry, so it
   * falls just as fast by re-entering more, which costs nothing and proves
   * nothing. `self_correction` warned that near zero means nothing was ever
   * revised, and said nothing about a graph so churned that nothing settles.
   *
   * The list is explicit rather than derived because one-sidedness is not a
   * defect by itself: no graph suffers from scoring too many of its
   * predictions, so `scored_predictions` is correctly one-sided. Whether both
   * ends can be bad is a judgement about the metric that no code here can
   * infer, and hedging every reading would teach the reader to skip them.
   */
  const TWO_SIDED: Array<{ key: string; low: RegExp; high: RegExp }> = [
    {
      key: 're_entry',
      high: /ten or more/i,
      low: /re-entering more|reading more/i,
    },
    {
      key: 'self_correction',
      high: /large share|most edges/i,
      low: /near zero/i,
    },
    // Already two-sided before any of this, and the template the other two
    // were rewritten against. Pinned so it cannot quietly lose an end.
    { key: 'refusals', high: /high share/i, low: /run with none/i },
  ];

  it('names both ends wherever both ends can be bad', () => {
    const store = initializeGraph();
    store.createNode({
      title: 'Something to make the graph non-empty',
      trigger: 'foundation',
      why: 'Anchors a graph that has been worked at all',
      understanding: 'Otherwise several diagnostics correctly report absence.',
    });
    // re_entry and refusals are computed from tool_calls. Without these rows
    // both report 'not recorded' and the loop below skips them — which it did
    // on the first run of this test, leaving it green while asserting on one
    // key out of three.
    sqlite.saveConversation('c_two_sided', 'session');
    for (let i = 0; i < 4; i++) {
      sqlite.logToolCall({
        sessionId: 'c_two_sided',
        toolName: 'graph_batch',
        arguments: {},
      });
    }
    sqlite.logToolCall({
      sessionId: 'c_two_sided',
      toolName: 'graph_batch',
      arguments: {},
      error: 'Concept would be unreachable. Entire batch rolled back.',
    });
    sqlite.logToolCall({
      sessionId: 'c_two_sided',
      toolName: 'graph_understand',
      arguments: {},
    });
    const checked: string[] = [];
    const skipped: string[] = [];
    for (const { key, low, high } of TWO_SIDED) {
      const d = assessPractice().worked.find((x) => x.key === key);
      expect(d, `${key} is not reported at all`).toBeDefined();
      const reading = String(d?.reading);
      if (/cannot be assessed/i.test(reading)) {
        skipped.push(key);
        continue;
      }
      checked.push(key);
      expect(reading, `${key} does not name its high end`).toMatch(high);
      expect(reading, `${key} does not name its low end`).toMatch(low);
    }
    console.log(`two-sided CHECKED: [${checked}]  SKIPPED: [${skipped}]`);
    // A skip-everything run would pass while asserting nothing, which is the
    // failure this whole file keeps rediscovering.
    expect(
      checked.length,
      'every key was skipped; this test asserted nothing',
    ).toBe(TWO_SIDED.length);
  });
});

describe('edge_vocabulary reports a generic share when there is one', () => {
  /**
   * This reading had never fired. Both projects dogfooding the tool sat at
   * 0% generic for its whole life, which is evidence about how those graphs
   * were written and not evidence that the diagnostic works — a reading nobody
   * has exercised is one nobody has checked, and 0% is exactly what a broken
   * counter would also report.
   *
   * `relates` is still a legal, deliberate choice: EDGE_TYPE_REQUIRED refuses
   * an ABSENT type, and its refusal message offers `relates` explicitly for a
   * connection with no better name. So a non-zero share is a state real graphs
   * can reach, and the arithmetic behind the warning should be pinned.
   */
  function twoConcepts(store: ReturnType<typeof initializeGraph>) {
    const a = store.createNode({
      title: 'A grounding concept',
      trigger: 'foundation',
      why: 'Anchors the pair an edge connects',
      understanding: 'Something the other concept can point at.',
    });
    const b = store.createNode({
      title: 'A second concept',
      trigger: 'analysis',
      why: 'Draws out what the first one implies',
      understanding: 'Follows from the first.',
    });
    return [a, b] as const;
  }

  it('counts an explicit relates edge as generic', () => {
    const store = initializeGraph();
    const [a, b] = twoConcepts(store);

    // Three typed, one deliberately generic.
    for (const type of ['learned_from', 'refines', 'questions', 'relates']) {
      store.createEdge({
        fromId: b.id,
        toId: a.id,
        type,
        why: `Following this reaches the first concept, as a ${type} relation.`,
      });
    }

    const value = diagnostic('edge_vocabulary')?.value;
    console.log(`edge_vocabulary exercised at: ${value}`);
    // The case this diagnostic exists for, reached for the first time.
    expect(value).toBe('25% generic');
    expect(diagnostic('edge_vocabulary')?.reading).toContain('decorative');
  });

  it('still reports 0% when every edge is typed', () => {
    const store = initializeGraph();
    const [a, b] = twoConcepts(store);
    for (const type of ['learned_from', 'refines']) {
      store.createEdge({
        fromId: b.id,
        toId: a.id,
        type,
        why: `Following this reaches the first concept, as a ${type} relation.`,
      });
    }
    // Pins that 0% means measured-and-none, not counter-never-ran — the two
    // were indistinguishable for this diagnostic's entire life until now.
    expect(diagnostic('edge_vocabulary')?.value).toBe('0% generic');
  });

  it('says there are no edges rather than reporting 0%', () => {
    initializeGraph();
    expect(diagnostic('edge_vocabulary')?.value).toBe('no edges yet');
  });
});

describe('the diagnostics that had never seen their own bad state', () => {
  /**
   * Found by mutation, not by reading: forcing each diagnostic to its
   * reassuring value regardless of input and running the whole suite. Three
   * survived untouched — the suite could not tell a working diagnostic from
   * one that had been replaced by a constant.
   *
   * `store_durability` was the instructive one. Its helper `isEphemeralPath`
   * is exhaustively tested, and two tests here do name the diagnostic — but
   * both are branch-agnostic by construction: one asserts the value matches
   * /^(EPHEMERAL|durable): \//, a disjunction true either way, and the other
   * is an if/else asserting something different depending on which branch it
   * lands in. Coverage of a helper is not coverage of its use, and a test that
   * asserts across the branches passes whichever one runs. This is the hazard
   * that cost two hundred nodes.
   */
  it('flags an ephemeral store as EPHEMERAL, without accepting either answer', () => {
    initializeGraph();
    const d = diagnostic('store_durability');
    // The fixture builds under os.tmpdir(): /var/folders/... on macOS, /tmp on
    // Linux, both ephemeral. Asserted outright so a platform where that stops
    // holding fails loudly instead of passing through a disjunction.
    console.log(`store_durability in fixture: ${d?.value}`);
    expect(d?.value.startsWith('EPHEMERAL')).toBe(true);
    expect(d?.reading).toContain('silently recreate an empty database');
  });

  it('reports a stale expresses edge pointing at an overturned decision', () => {
    const store = initializeGraph();

    const decision = store.createNode({
      title: 'Mixing costs nothing at all',
      trigger: 'model',
      why: 'Records what the first run appeared to show',
      understanding:
        'Segregation halved while access cost held, so mixing looked free.',
    });
    const unit = store.createDocumentNode({
      title: 'city_dwelling.py',
      content: '# a module built on that claim',
      level: 'document',
      isDocRoot: true,
    });
    store.createEdge({
      fromId: unit.id,
      toId: decision.id,
      type: 'expresses',
      why: 'Following this reaches the claim this module was written around.',
    });

    expect(diagnostic('artifact_ahead_of_understanding')?.value).toBe(
      'nothing expresses a retired decision',
    );

    // Now retire the decision the artifact is built on. The code did not
    // change, so nothing else in the system can notice this.
    const verdict = store.createNode({
      title: 'The free result was an artifact of a small city',
      trigger: 'evaluation',
      why: 'Reports the wider test and what it settled',
      understanding:
        'On six blocks the trade-off reappears, so the result was the demo.',
    });
    store.createEdge({
      fromId: verdict.id,
      toId: decision.id,
      type: 'invalidates',
      why: 'Following this reaches the claim the wider test retired.',
    });

    expect(diagnostic('artifact_ahead_of_understanding')?.value).toBe(
      '1 unit(s) still express a decision that was overturned',
    );
    expect(diagnostic('artifact_ahead_of_understanding')?.reading).toContain(
      'no longer believes',
    );
  });

  it('reports attribution that was present early and is gone now', () => {
    initializeGraph();

    // Ten commits, oldest first, attributed for the first five only. Explicit
    // timestamps because the comparison is first-five against last-five and
    // same-millisecond ordering would decide the result by accident.
    for (let i = 0; i < 10; i++) {
      sqlite.createCommit(
        `commit ${i}`,
        [],
        [],
        i < 5 ? 'loop-session' : undefined,
        `2026-08-1${i === 9 ? 9 : i}T12:00:0${i}.000Z`,
      );
    }

    const d = diagnostic('practice_drift');
    console.log(`practice_drift with attribution dropped: ${d?.value}`);
    expect(d?.value).toBe('attribution 100% early against 0% lately');
  });

  it('does not call it drift when the practice held throughout', () => {
    initializeGraph();
    for (let i = 0; i < 10; i++) {
      sqlite.createCommit(
        `commit ${i}`,
        [],
        [],
        'loop-session',
        `2026-08-1${i === 9 ? 9 : i}T12:00:0${i}.000Z`,
      );
    }
    expect(diagnostic('practice_drift')?.value).toBe(
      'attribution 100% early against 100% lately',
    );
  });
});
