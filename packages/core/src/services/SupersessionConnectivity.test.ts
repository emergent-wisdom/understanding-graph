import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as sqlite from '../database/sqlite.js';
import { analyzeGraph } from './AnalysisService.js';
import { getGraphStore, resetGraphStore } from './GraphStore.js';

/**
 * Superseding a node must not orphan the nodes still pointing at it.
 *
 * The collapsed view (showEvolution false) hides superseded nodes. Their
 * incident edges were then dropped for failing the endpoint check, so a live
 * node whose only edge landed on a superseded one was reported isolated.
 *
 * Measured on a real graph before this was fixed: graph_analyze reported one
 * isolated node while graph_score, which hides nothing, reported 100%
 * connectivity on the same graph at the same moment. The node was not isolated
 * — its single `validates` edge pointed at a node that had been superseded an
 * hour earlier.
 *
 * That makes the defect worse than a wrong number. Revising a position is the
 * behaviour this tool exists to encourage, and it was repaid with a phantom
 * defect in the statistic meant to find genuinely unconnected work. An agent
 * acting on that report would go looking for a gap that does not exist, and
 * the honest response to seeing it repeatedly would be to supersede less.
 *
 * Redirection is what supersession already means: if C replaces B, then in a
 * view without B an edge onto B is an edge onto C.
 */
const PROJECT_ID = 'supersession-connectivity';

function initializeGraph() {
  const tempDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'understanding-graph-supersession-'),
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

describe('supersession does not orphan the nodes pointing at it', () => {
  it('keeps a node connected when its only edge lands on a superseded node', () => {
    const store = initializeGraph();

    const superseded = store.createNode({
      title: 'Delivery decides medium from store',
      trigger: 'model',
      why: 'States the position that a later node replaces',
      understanding: 'An early formulation of the delivery test.',
    });
    const replacement = store.createNode({
      title: 'The delivery test, better phrased',
      trigger: 'model',
      why: 'Replaces the earlier formulation with a sharper one',
      understanding: 'The same test, stated so it can actually be applied.',
    });
    const dependent = store.createNode({
      title: 'This project is a store by its own test',
      trigger: 'tension',
      why: 'Applies the test to the project that produced it',
      understanding:
        'Applying the delivery test here is uncomfortable, and the answer is unflattering.',
    });

    store.createEdge({
      fromId: replacement.id,
      toId: superseded.id,
      type: 'supersedes',
      why: 'Following this reaches the earlier phrasing this one replaces.',
    });
    // The only edge this node has, and it lands on the superseded node.
    store.createEdge({
      fromId: dependent.id,
      toId: superseded.id,
      type: 'validates',
      why: 'Following this reaches the test being applied and the case that upholds it.',
    });

    const analysis = analyzeGraph(PROJECT_ID, { showEvolution: false });

    expect(
      analysis.isolatedNodes.map((n) => n.id),
      'A node whose single edge pointed at a superseded node was reported ' +
        'isolated. It is connected; the edge was dropped because its target ' +
        'is hidden in the collapsed view.',
    ).not.toContain(dependent.id);
    expect(analysis.stats.isolatedCount).toBe(0);
  });

  it('reports a genuinely unconnected node, so the measure still bites', () => {
    const store = initializeGraph();

    const connectedA = store.createNode({
      title: 'A grounded claim',
      trigger: 'analysis',
      why: 'Anchors the connected pair',
      understanding: 'Something with a relation to something else.',
    });
    const connectedB = store.createNode({
      title: 'What follows from it',
      trigger: 'consequence',
      why: 'Draws out what the grounded claim implies',
      understanding: 'The consequence of the claim above.',
    });
    const alone = store.createNode({
      title: 'A claim with nothing attached',
      trigger: 'question',
      why: 'Exists to be found by the isolation check',
      understanding: 'Genuinely unconnected, and should be reported as such.',
    });

    store.createEdge({
      fromId: connectedB.id,
      toId: connectedA.id,
      type: 'learned_from',
      why: 'Following this reaches the claim the consequence was drawn from.',
    });

    // Guard against "fixing" isolation reporting by never reporting anything.
    const analysis = analyzeGraph(PROJECT_ID, { showEvolution: false });
    expect(analysis.isolatedNodes.map((n) => n.id)).toContain(alone.id);
    expect(analysis.stats.isolatedCount).toBe(1);
  });

  it('follows a chain of supersessions to the node that survives', () => {
    const store = initializeGraph();

    // B superseded by C, C superseded by D: an edge onto B must reach D, not
    // stop at the intermediate hop that is also hidden.
    const first = store.createNode({
      title: 'First formulation',
      trigger: 'model',
      why: 'Opens a chain of revisions',
      understanding: 'The original claim.',
    });
    const second = store.createNode({
      title: 'Second formulation',
      trigger: 'model',
      why: 'Revises the first and is itself revised',
      understanding: 'A better claim that is still not the final one.',
    });
    const third = store.createNode({
      title: 'Third formulation',
      trigger: 'model',
      why: 'The formulation that survives the chain',
      understanding: 'The claim as it currently stands.',
    });
    const dependent = store.createNode({
      title: 'A node attached to the original',
      trigger: 'tension',
      why: 'Points at the oldest link in the chain',
      understanding: 'Attached to the first formulation and never re-pointed.',
    });

    store.createEdge({
      fromId: second.id,
      toId: first.id,
      type: 'supersedes',
      why: 'Following this reaches the first formulation this replaces.',
    });
    store.createEdge({
      fromId: third.id,
      toId: second.id,
      type: 'supersedes',
      why: 'Following this reaches the second formulation this replaces.',
    });
    store.createEdge({
      fromId: dependent.id,
      toId: first.id,
      type: 'questions',
      why: 'Following this reaches the original claim this puts in doubt.',
    });

    const analysis = analyzeGraph(PROJECT_ID, { showEvolution: false });
    expect(analysis.stats.isolatedCount).toBe(0);
    expect(analysis.isolatedNodes.map((n) => n.id)).not.toContain(dependent.id);
  });
});
